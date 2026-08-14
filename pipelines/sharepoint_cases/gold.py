"""Gold for the ``sharepoint_cases`` feed: the current Case, its Detail Tables,
and five aggregates.

Silver is an append-only history of *observations* across every declared Case
list. Gold reduces that three ways. Every table is rebuilt whole with
``Refresh()`` on every poll, so a re-drive converges rather than accumulating.
Every table's declared grain is in ``docs/data-dictionary-sharepoint-cases.md``.

The Detail Tables, named in ``DETAIL_TABLES`` (derived from ``GOLD_TABLES`` and
``DETAIL_GRAIN``), hold the child rows of the Cases' *winning* observation.
Two of the five aggregates -- ``answer_remediation_current`` and
``appeal_outcomes_current`` -- reduce from a Detail Table (``answer`` and
``appeal`` respectively) rather than from ``case_current``, per
``DETAIL_AGGREGATES`` below.

**One instant decides everything.** ``as_of`` is the candidate SharePoint window
end -- the value the run is about to commit as its watermark -- and never
``utcnow()``: a re-drive of the same window must produce byte-identical gold.
Every table carries it as ``as_of_utc``. A *calendar date* (``terminal_date``,
the age arithmetic) is the **local** date of that instant, through
``tools.observability.timestamps``.

Every column is documented in ``docs/data-dictionary-sharepoint-cases.md``.
"""

from __future__ import annotations

import datetime as dt
import re
from functools import partial
from typing import Sequence

import pandas as pd

from framework.core import Dataset, Reader, UniqueValidator, Writer
from framework.io import DatasetReader, Refresh
from framework.run import Pipeline, RunLog
from framework.transform import DeriveKey, JoinWith, Stamp
from tools.medallion import Medallion
from tools.observability.timestamps import local_date

from .schema import FEED_NAME, NATURAL_KEY

# The silver table gold reduces, and the current-state table every aggregate is
# then reduced from.
SILVER_TABLE = "case_version"
CURRENT_TABLE = "case_current"

# Every gold table, in publication order.
GOLD_TABLES = (
    CURRENT_TABLE,
    "answer",
    "answer_capture",
    "answer_action",
    "general_answer",
    "conversation_message",
    "appeal",
    "case_detail",
    "case_counts_current",
    "case_age_buckets_current",
    "case_throughput_daily",
    "answer_remediation_current",
    "appeal_outcomes_current",
)

CASE_ID_COLUMN = "case_id"

# The grain of each Detail Table, declared for every one this feed may ever
# grow; DETAIL_TABLES below is the subset that actually publishes.
DETAIL_GRAIN: dict[str, tuple[str, ...]] = {
    "answer": (CASE_ID_COLUMN, "question_id"),
    "answer_capture": (CASE_ID_COLUMN, "question_id", "field_key"),
    "answer_action": (CASE_ID_COLUMN, "question_id", "action_id"),
    "general_answer": (CASE_ID_COLUMN, "general_key"),
    "conversation_message": (CASE_ID_COLUMN, "seq"),
    "appeal": (CASE_ID_COLUMN, "appeal_id"),
    "case_detail": (CASE_ID_COLUMN, "field_key"),
}

# The Detail Tables that actually publish today, derived from GOLD_TABLES so
# the two cannot drift apart.
DETAIL_TABLES: tuple[str, ...] = tuple(t for t in GOLD_TABLES if t in DETAIL_GRAIN)

# Aggregates that reduce from a Detail Table rather than case_current, named to
# the Detail Table each reduces.
DETAIL_AGGREGATES: dict[str, str] = {
    "answer_remediation_current": "answer",
    "appeal_outcomes_current": "appeal",
}

AS_OF_COLUMN = "as_of_utc"
# The pair a Detail row's semi-join keys on.
WINNER_COLUMNS = (CASE_ID_COLUMN, "source_observation_id")

# A Case whose review is over, and the source-written stamp that says when it
# ended. The source writes each stamp once, on the one transition into that
# state, so it is a business event rather than an artefact of when we polled.
TERMINAL_STATUSES = {"Completed": "completed_at", "Void": "voided_at"}

# Reporting fills, not source values. Both are literal keys rather than NULL so
# the grain of an aggregate has no hole in it: a NULL group key is a hole a
# reader may silently drop, losing rows from a total.
UNASSIGNED = "(unassigned)"
UNSTAMPED = "(unstamped)"
# The tri-state's real third state (see AnswerRow), not a fill for missing data.
UNDECIDED = "(undecided)"
UNRESOLVED = "(unresolved)"
UNSTATED = "(unstated)"

# The grain of ``case_counts_current``, in the order it groups and sorts by. The
# Assigned Reviewer leads: the question this table answers is "who is holding
# what", and the manager is the roll-up over that, not the other way round.
COUNT_DIMENSIONS = (
    "assigned_reviewer_name",
    "assigned_reviewer_manager_name",
    "status",
)

# The grain of ``answer_remediation_current``. ``case_type`` leads: question_ids
# are drawn from a per-Case-Type question bank, so grouping without it would sum
# two different questions as one.
ANSWER_REMEDIATION_DIMENSIONS = (
    "case_type",
    "question_id",
    "remediation_required",
    "remediation_status",
)

# The grain of ``appeal_outcomes_current``; ``case_type`` leads for the same
# reason as above.
APPEAL_OUTCOME_DIMENSIONS = ("case_type", "state", "resolution_verdict")

# ``(exclusive upper bound in days, label)``, tried in order; the last entry is
# the open-ended bucket and its bound is ignored. A bucket's sort order is its
# position here, so the order cannot be hand-numbered out of step with it.
AGE_BUCKETS = (
    (8, "0-7 days"),
    (15, "8-14 days"),
    (31, "15-30 days"),
    (61, "31-60 days"),
    (None, "61+ days"),
)
UNKNOWN_AGE_BUCKET = ("unknown", len(AGE_BUCKETS))

# ``"3"``, ``W/"3"``, ``"4,1"`` and ``"3.0"`` are all shapes this list's version
# column really holds; the separator is whichever of the two the source used.
_VERSION_SEPARATOR = re.compile(r"[.,]")

# The version an observation with no parseable one sorts at. Deliberately ``-1``
# and not NA: pandas sorts NA *last*, which would let a version-less observation
# beat a properly versioned one at the same ``Modified``.
_NO_VERSION = -1


# --- the current-state rule -------------------------------------------------


def _version_parts(value: object) -> tuple[int, int]:
    """One ``source_version`` as the ``(major, minor)`` pair it sorts on.

    The column holds an ETag (``'"3"'``, ``'W/"3"'``, ``'"4,1"'``), a dotted UI
    version (``'3.0'``), or the sha256 digest the Reader falls back to when the
    row carried no version. Only the first two order; the digest sorts at
    ``(-1, -1)``.

    Parsed rather than compared as *text*: ``"10"`` sorts before ``"9"``
    lexically, so a same-``Modified`` tie would resolve backwards.
    """
    if not isinstance(value, str):
        return (_NO_VERSION, _NO_VERSION)
    text = value.strip()
    if text.startswith("W/"):
        text = text[2:]
    parts = _VERSION_SEPARATOR.split(text.strip('"'))
    try:
        major = int(parts[0])
    except ValueError:
        return (_NO_VERSION, _NO_VERSION)
    try:
        minor = int(parts[1]) if len(parts) > 1 else 0
    except ValueError:
        minor = 0
    return (major, minor)


def latest_case_version(dataset: Dataset) -> Dataset:
    """Reduce an accumulated observation history to the latest row per Case.

    Sorted by ``case_id``, the ``Modified`` instant, the parsed version's major
    then minor part, and finally ``source_observation_id``; then the last row of
    each Case wins. Two versions of one item can share a ``Modified`` to the
    second, which is why the version breaks that tie; the observation id is a
    deterministic last resort and carries no meaning.

    ``source_modified_at`` is parsed **without** ``errors="coerce"``: silver
    declares it non-null and typed, and coercing would sort a bad row *last* and
    hand it the Case -- the NA trap ``_NO_VERSION`` also exists to avoid.
    """
    frame = dataset.to_pandas()
    parts = [_version_parts(value) for value in frame["source_version"]]
    ordered = frame.assign(
        _modified_at_utc=pd.to_datetime(
            frame["source_modified_at"], utc=True, format="ISO8601"
        ),
        _version_major=pd.Series(
            [major for major, _ in parts], index=frame.index, dtype="int64"
        ),
        _version_minor=pd.Series(
            [minor for _, minor in parts], index=frame.index, dtype="int64"
        ),
    ).sort_values(
        [
            CASE_ID_COLUMN,
            "_modified_at_utc",
            "_version_major",
            "_version_minor",
            "source_observation_id",
        ],
        kind="stable",
    )
    current = ordered.drop_duplicates(CASE_ID_COLUMN, keep="last").drop(
        columns=["_modified_at_utc", "_version_major", "_version_minor"]
    )
    return Dataset.from_pandas(current.reset_index(drop=True))


def winning_observations(observations: Reader) -> Dataset:
    """Gold ``case_current``, projected to ``WINNER_COLUMNS`` so the join is a
    semi-join. No ``drop_duplicates()``: ``UniqueValidator(CASE_ID_COLUMN)`` in
    ``case_current_builder`` already makes a duplicate winning pair impossible.
    """
    frame = observations.read().to_pandas()
    projected = frame.loc[:, list(WINNER_COLUMNS)].reset_index(drop=True)
    return Dataset.from_pandas(projected)


# --- the aggregates ---------------------------------------------------------


def case_counts(dataset: Dataset) -> Dataset:
    """Count current Cases by reviewer, that reviewer's manager, and status."""
    # Only the two Person columns are filled; ``status`` is declared non-null in
    # silver and a null there is a schema breach, not a reporting gap.
    return _counted(
        dataset.to_pandas(),
        COUNT_DIMENSIONS,
        fills={
            "assigned_reviewer_name": UNASSIGNED,
            "assigned_reviewer_manager_name": UNASSIGNED,
        },
        measure="case_count",
    )


def _age_in_days(created: pd.Timestamp | None, as_of_day: dt.date) -> int | None:
    """Whole local calendar days from ``created`` to ``as_of_day``, or ``None``.

    Both ends are converted to a **local** calendar date first. Taking ``.date()``
    off a UTC instant would pass on a UTC box and be a day out for a UK operator
    in British Summer Time -- the exact confusion ``tools.observability.
    timestamps`` exists to settle.
    """
    if created is None or created is pd.NaT or pd.isna(created):
        return None
    return (as_of_day - local_date(created)).days


def _age_bucket(age_days: int | None) -> tuple[str, int]:
    """The bucket ``age_days`` falls in, as ``(label, sort order)``.

    A negative age means the Case was created after the window this run is
    reporting as of, which cannot happen while ``created <= Modified < as_of``.
    So it is corruption, and it is bucketed as ``unknown`` where someone will see
    it rather than clamped to zero where nobody will.
    """
    if age_days is None or age_days < 0:
        return UNKNOWN_AGE_BUCKET
    for order, (upper, label) in enumerate(AGE_BUCKETS):
        if upper is None or age_days < upper:
            return (label, order)
    raise AssertionError("the last bucket is open-ended")  # pragma: no cover


def age_buckets(dataset: Dataset, *, as_of: dt.datetime) -> Dataset:
    """Count current Cases by age bucket and status."""
    frame = dataset.to_pandas()
    as_of_day = local_date(as_of)
    created = pd.to_datetime(
        frame["created"], utc=True, format="ISO8601", errors="coerce"
    )
    buckets = [_age_bucket(_age_in_days(value, as_of_day)) for value in created]
    counted = (
        frame.assign(
            age_bucket=pd.Series(
                [label for label, _ in buckets], index=frame.index, dtype="object"
            ),
            age_bucket_order=pd.Series(
                [order for _, order in buckets], index=frame.index, dtype="int64"
            ),
        )
        .groupby(["age_bucket", "age_bucket_order", "status"])
        .size()
        .reset_index(name="case_count")
        .sort_values(["age_bucket_order", "status"], kind="stable")
    )
    return Dataset.from_pandas(counted.reset_index(drop=True))


def throughput(dataset: Dataset) -> Dataset:
    """Count current Cases by the local date their terminal stamp falls on."""
    frame = dataset.to_pandas()
    terminal = frame[frame["status"].isin(TERMINAL_STATUSES.keys())]
    if terminal.empty:
        # Declared rather than derived, so a poll with nothing terminal in it
        # still refreshes the table in the shape a populated one has.
        return Dataset.from_pandas(
            pd.DataFrame(
                {
                    "terminal_date": pd.Series(dtype="object"),
                    "terminal_status": pd.Series(dtype="object"),
                    "case_count": pd.Series(dtype="int64"),
                }
            )
        )
    # One parse per terminal stamp column, not one per row: each row then takes
    # the stamp column its own status names.
    stamps = pd.Series(pd.NaT, index=terminal.index, dtype="datetime64[ns, UTC]")
    for status, column in TERMINAL_STATUSES.items():
        of_status = terminal["status"] == status
        stamps[of_status] = pd.to_datetime(
            terminal.loc[of_status, column],
            utc=True,
            format="ISO8601",
            errors="coerce",
        )
    # The instant -> local calendar date step stays per value: which zone is
    # local is the ``tools.observability.timestamps`` seam and it resolves per
    # instant, which no vectorised ``tz_convert`` expresses.
    dates = [
        UNSTAMPED if pd.isna(stamp) else local_date(stamp).isoformat()
        for stamp in stamps
    ]
    counted = (
        terminal.assign(
            terminal_date=pd.Series(dates, index=terminal.index, dtype="object"),
            terminal_status=terminal["status"],
        )
        .groupby(["terminal_date", "terminal_status"])
        .size()
        .reset_index(name="case_count")
        .sort_values(["terminal_date", "terminal_status"], kind="stable")
    )
    return Dataset.from_pandas(counted.reset_index(drop=True))


def _counted(
    frame: pd.DataFrame,
    dimensions: Sequence[str],
    *,
    fills: dict[str, str],
    measure: str,
) -> Dataset:
    """Group ``frame`` by ``dimensions`` into one row per combination, counted.

    ``.where``, not ``fillna``, so an all-null float64 ``fills`` column lands as
    ``object`` rather than staying float64 with the literal coerced to NaN.
    """
    filled = {
        column: frame[column].where(frame[column].notna(), literal)
        for column, literal in fills.items()
    }
    counted = (
        frame.assign(**filled)
        .groupby(list(dimensions))
        .size()
        .reset_index(name=measure)
        .sort_values(list(dimensions), kind="stable")
    )
    return Dataset.from_pandas(counted.reset_index(drop=True))


def answer_remediation(dataset: Dataset) -> Dataset:
    """Count the gold ``answer`` Detail Table by remediation decision and status."""
    frame = dataset.to_pandas()
    return _counted(
        frame,
        ANSWER_REMEDIATION_DIMENSIONS,
        fills={
            "remediation_required": UNDECIDED,
            "remediation_status": UNRESOLVED,
        },
        measure="answer_count",
    )


def appeal_outcomes(dataset: Dataset) -> Dataset:
    """Count the gold ``appeal`` Detail Table by state and resolution verdict."""
    frame = dataset.to_pandas()
    return _counted(
        frame,
        APPEAL_OUTCOME_DIMENSIONS,
        fills={"state": UNSTATED, "resolution_verdict": UNRESOLVED},
        measure="appeal_count",
    )


# --- the builders -----------------------------------------------------------


def case_current_builder(
    reader: Reader,
    writer: Writer,
    *,
    as_of: dt.datetime,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the current-state hop. **Grain: one row per ``case_id``.**

    Reads the whole silver history across every list, derives the deterministic
    ``case_id``, reduces to the latest observation of each Case, stamps the
    run's ``as_of_utc``, and refreshes the table.

    ``UniqueValidator(CASE_ID_COLUMN)`` sits after the reduction, where it can
    never fire: ``drop_duplicates`` has just guaranteed what it checks. It is
    kept as a **tripwire** -- this is the one hop whose grain comes from a rule
    rather than from a ``groupby``, so the one a future change could get wrong.
    """
    p = Pipeline(f"{FEED_NAME}:gold:{CURRENT_TABLE}", run_log=run_log)
    r = p.read(reader, name="read")
    keyed = p.transform(
        DeriveKey(
            into=CASE_ID_COLUMN,
            namespace=FEED_NAME,
            natural_key=list(NATURAL_KEY),
        ),
        r,
        name="derive-key",
    )
    latest = p.transform(latest_case_version, keyed, name="latest-version")
    stamped = p.transform(
        Stamp(AS_OF_COLUMN, as_of.isoformat()), latest, name="stamp-as-of"
    )
    validated = p.validate(
        UniqueValidator(CASE_ID_COLUMN), stamped, name="unique-validate"
    )
    p.write(writer, validated, name="write")
    return p


def gold_detail_builder(
    reader: Reader,
    writer: Writer,
    *,
    grain: Sequence[str],
    observations: Reader,
    as_of: dt.datetime,
    name: str,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build one Detail Table's gold hop. **Grain: one row per ``grain``.**

    Reduces a silver Detail Table's accumulated history to the child rows of
    the Cases' *winning* observation. It never orders and never breaks a tie --
    ``latest_case_version`` has already picked the winner, and a second
    ordering path here could disagree with it. **Precondition**: a
    Detail row's ``case_type`` must be the settled one, or the semi-join
    matches nothing and gold lands zero rows silently.
    """
    p = Pipeline(name, run_log=run_log)
    r = p.read(reader, name="read")
    keyed = p.transform(
        DeriveKey(
            into=CASE_ID_COLUMN,
            namespace=FEED_NAME,
            natural_key=list(NATURAL_KEY),
        ),
        r,
        name="derive-key",
    )
    current = p.transform(
        JoinWith(
            partial(winning_observations, observations),
            on=list(WINNER_COLUMNS),
            how="inner",
            name="winning-observations",
        ),
        keyed,
        name="latest-observation",
    )
    stamped = p.transform(
        Stamp(AS_OF_COLUMN, as_of.isoformat()), current, name="stamp-as-of"
    )
    validated = p.validate(
        UniqueValidator(list(grain)), stamped, name="unique-validate"
    )
    p.write(writer, validated, name="write")
    return p


# --- publication ------------------------------------------------------------


def publish_gold(
    med: Medallion,
    *,
    as_of: dt.datetime,
    describe: bool = False,
    run_log: RunLog | None = None,
) -> None:
    """Rebuild every gold table from the accumulated silver history.

    ``case_current`` is published first and its dataset feeds the Detail
    Tables and the five aggregates, so silver is read once and each of them
    reduces exactly the current table's own rows. They commit independently,
    in order; a failure part-way leaves the earlier ones refreshed, which is
    safe because the caller has not advanced any watermark and the next run
    rebuilds everything. See ``docs/gold-accumulation.md`` for why each source
    is read from memory rather than re-read from disk.

    Each hop runs as a bare ``p.run()``, so it inherits the ambient run context
    the runner makes active -- which is where a dry run's write-nothing
    behaviour comes from.
    """
    # Only a dry run can have any of these silver tables missing; one probe up
    # front, rather than a per-table skip, so a partial silver history cannot
    # make gold silently under-publish.
    if any(
        med.silver.columns_of(table).columns() is None
        for table in (SILVER_TABLE, *DETAIL_TABLES)
    ):
        return

    current_p = case_current_builder(
        med.silver.reader(SILVER_TABLE),
        med.gold.writer(CURRENT_TABLE, Refresh()),
        as_of=as_of,
        run_log=run_log,
    )
    if describe:
        print(current_p.describe())
    current = current_p.run()

    sources: dict[str, Dataset] = {CURRENT_TABLE: current}
    for table in DETAIL_TABLES:
        p = gold_detail_builder(
            med.silver.reader(table),
            med.gold.writer(table, Refresh()),
            grain=DETAIL_GRAIN[table],
            observations=DatasetReader(current),
            as_of=as_of,
            name=f"{FEED_NAME}:gold:{table}",
            run_log=run_log,
        )
        if describe:
            print(p.describe())
        dataset = p.run()
        if table in DETAIL_AGGREGATES.values():
            sources[table] = dataset

    for table, step, transform in (
        ("case_counts_current", "count-by-reviewer-and-status", case_counts),
        (
            "case_age_buckets_current",
            "bucket-by-age",
            partial(age_buckets, as_of=as_of),
        ),
        ("case_throughput_daily", "count-by-terminal-date", throughput),
        (
            "answer_remediation_current",
            "count-by-remediation",
            answer_remediation,
        ),
        ("appeal_outcomes_current", "count-by-outcome", appeal_outcomes),
    ):
        p = Pipeline(f"{FEED_NAME}:gold:{table}", run_log=run_log)
        source = sources[DETAIL_AGGREGATES.get(table, CURRENT_TABLE)]
        node = p.read(DatasetReader(source), name="read")
        node = p.transform(transform, node, name=step)
        node = p.transform(
            Stamp(AS_OF_COLUMN, as_of.isoformat()), node, name="stamp-as-of"
        )
        p.write(med.gold.writer(table, Refresh()), node, name="write")
        if describe:
            print(p.describe())
        p.run()
