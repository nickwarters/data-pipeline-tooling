"""Gold for the ``sharepoint_cases`` feed: the current Case, its Detail Tables,
and six aggregates.

Silver is an append-only history of *observations* across every declared Case
list. Gold reduces that three ways. Every table is rebuilt whole with
``Refresh()`` on every poll, so a re-drive converges rather than accumulating.
Every table's declared grain is in ``docs/data-dictionary-sharepoint-cases.md``.

Every Case-counting aggregate carries a common floor grain, ``BASE_DIMENSIONS``
below (brand x case type x assigned reviewer, plus the table's day column where
the table is daily): any report rolls up from that floor, and extra dimensions
beyond it are per-metric (status, age bucket). The two Detail-Table aggregates
below count a different thing (answer/appeal rows, not Cases) and sit outside
that family.

The Detail Tables, named in ``DETAIL_TABLES`` (derived from ``GOLD_TABLES`` and
``DETAIL_GRAIN``), hold the child rows of the Cases' *winning* observation.
Two of the six aggregates -- ``answer_remediation_current`` and
``appeal_outcomes_current`` -- reduce from a Detail Table (``answer`` and
``appeal`` respectively) rather than from ``case_current``, per
``DETAIL_AGGREGATES`` below.

**One instant decides everything.** ``as_of`` is the candidate SharePoint window
end -- the value the run is about to commit as its watermark -- and never
``utcnow()``: a re-drive of the same window must produce **identical data**.
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
from framework.run import hop, read, transform, validate, write
from framework.transform import (
    DeriveKey,
    DropColumns,
    FlattenJsonObject,
    JoinWith,
    Stamp,
)
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
    "case_age_from_assigned_buckets_current",
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

# The amended_outcome blob, flattened onto the case_current row -- it is 1:1
# with the Case, so it wants columns, not a Detail Table. Every name carries an
# amended_ prefix so none can be read as the scalar outcome / effective_outcome
# columns beside them. amended_outcome_id holds an OutcomeOption *id*
# (poor-with-harm), not display wording; amended_reason is an Amendment Reason
# key with no OneOf, because Case Types may declare extraAmendmentReasons in
# frontend config this pipeline cannot see (the same argument that left
# general_key unruled); amended_at stays ISO text -- text inside a blob stays
# text, as every Detail Table's blob timestamp does; amended_from_appeal_id
# joins the gold appeal table's appeal_id, and is present iff the amendment came
# from agreeing an Appeal (amended_reason is then absent). amended_by is a bare
# account login, not the claims login the Person columns hold.
AMENDED_OUTCOME_FIELDS = {
    "outcome": "amended_outcome_id",
    "reason": "amended_reason",
    "justification": "amended_justification",
    "amendedBy": "amended_by",
    "amendedAt": "amended_at",
    "fromAppealId": "amended_from_appeal_id",
}

# The four blob columns whose data now lives in a Detail Table, dropped from
# case_current rather than republished: a consumer reading the same data two
# ways -- an unnormalised text blob beside the typed table built from it -- is
# exactly the duplication the normalisation removes, and the blob is the arm no
# schema enforcement, value rule or grain validation can say anything about.
# The fifth blob, amended_outcome, is consumed by its flatten below. Silver
# keeps all five as landed text: it is the faithful observation history, and
# the only place a malformed blob is recoverable.
DETAIL_BLOB_COLUMNS = ("answers", "conversation", "appeals", "details")

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

# No source reachable from this feed carries brand yet -- there is no join path
# to pipelines.ref_lookup, where it exists today. Every Case-counting aggregate
# still carries the column, filled with this literal, so the grain's shape does
# not change the day a brand source lands; only this fill does.
UNKNOWN_BRAND = "(unknown)"

# The floor grain every Case-counting aggregate carries, so any report rolls up
# from a common base; a table's extra dimensions beyond these are per-metric
# (status, age bucket). Brand leads: it is the widest roll-up, then Case Type,
# then who is holding the Case.
BASE_DIMENSIONS = ("brand", "case_type", "assigned_reviewer_name")

# The grain of ``case_counts_current``, in the order it groups and sorts by.
COUNT_DIMENSIONS = (*BASE_DIMENSIONS, "status")

# The grain of ``case_throughput_daily``; the day column leads, since it is
# the extra dimension a daily table adds to the base grain.
THROUGHPUT_DIMENSIONS = ("terminal_date", *BASE_DIMENSIONS, "terminal_status")

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
    """Count current Cases by the base grain and status."""
    # ``status`` is declared non-null in silver and a null there is a schema
    # breach, not a reporting gap, so only the Person and brand columns fill.
    frame = dataset.to_pandas().assign(brand=UNKNOWN_BRAND)
    return _counted(
        frame,
        COUNT_DIMENSIONS,
        fills={"assigned_reviewer_name": UNASSIGNED},
        measure="case_count",
    )


def _age_in_days(stamp: pd.Timestamp | None, as_of_day: dt.date) -> int | None:
    """Whole local calendar days from ``stamp`` to ``as_of_day``, or ``None``.

    ``stamp`` is whichever column ``age_buckets``'s ``age_from`` names --
    ``created`` or ``assigned_at``. Both ends are converted to a **local**
    calendar date first. Taking ``.date()`` off a UTC instant would pass on a
    UTC box and be a day out for a UK operator in British Summer Time -- the
    exact confusion ``tools.observability.timestamps`` exists to settle.
    """
    if stamp is None or stamp is pd.NaT or pd.isna(stamp):
        return None
    return (as_of_day - local_date(stamp)).days


def _age_bucket(age_days: int | None) -> tuple[str, int]:
    """The bucket ``age_days`` falls in, as ``(label, sort order)``.

    A negative age means the stamp ``age_days`` was measured from is after the
    window this run is reporting as of, which cannot happen for either stamp
    ``age_buckets`` supports (``created <= Modified < as_of``; an Assigned At
    stamp is written no later than that same window). So it is corruption, and
    it is bucketed as ``unknown`` where someone will see it rather than
    clamped to zero where nobody will.
    """
    if age_days is None or age_days < 0:
        return UNKNOWN_AGE_BUCKET
    for order, (upper, label) in enumerate(AGE_BUCKETS):
        if upper is None or age_days < upper:
            return (label, order)
    raise AssertionError("the last bucket is open-ended")  # pragma: no cover


def age_buckets(
    dataset: Dataset, *, as_of: dt.datetime, age_from: str = "created"
) -> Dataset:
    """Count current Cases by the base grain, age bucket, and status.

    ``age_from`` names the stamp column the age is measured from: ``created``
    for the age-since-created profile, or ``assigned_at`` for the twin
    age-since-assigned one. A missing ``created`` is corruption -- every
    landed Case has one -- whereas a missing ``assigned_at`` is an ordinary
    never-assigned state, so ``unknown`` means two different things depending
    on ``age_from``.
    """
    frame = dataset.to_pandas()
    as_of_day = local_date(as_of)
    stamp = pd.to_datetime(frame[age_from], utc=True, format="ISO8601", errors="coerce")
    buckets = [_age_bucket(_age_in_days(value, as_of_day)) for value in stamp]
    # See UNASSIGNED above: without this fill, groupby would drop unassigned
    # Cases from the total.
    counted = (
        frame.assign(
            brand=UNKNOWN_BRAND,
            assigned_reviewer_name=frame["assigned_reviewer_name"].where(
                frame["assigned_reviewer_name"].notna(), UNASSIGNED
            ),
            age_bucket=pd.Series(
                [label for label, _ in buckets], index=frame.index, dtype="object"
            ),
            age_bucket_order=pd.Series(
                [order for _, order in buckets], index=frame.index, dtype="int64"
            ),
        )
        .groupby([*BASE_DIMENSIONS, "age_bucket", "age_bucket_order", "status"])
        .size()
        .reset_index(name="case_count")
        .sort_values([*BASE_DIMENSIONS, "age_bucket_order", "status"], kind="stable")
    )
    return Dataset.from_pandas(counted.reset_index(drop=True))


def throughput(dataset: Dataset) -> Dataset:
    """Count current Cases by the base grain and the local date their terminal
    stamp falls on."""
    frame = dataset.to_pandas()
    terminal = frame[frame["status"].isin(TERMINAL_STATUSES.keys())]
    if terminal.empty:
        # Declared rather than derived, so a poll with nothing terminal in it
        # still refreshes the table in the shape a populated one has -- built
        # from THROUGHPUT_DIMENSIONS so it cannot desync from the populated path.
        return Dataset.from_pandas(
            pd.DataFrame(
                {
                    **{
                        column: pd.Series(dtype="object")
                        for column in THROUGHPUT_DIMENSIONS
                    },
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
    return _counted(
        terminal.assign(
            terminal_date=pd.Series(dates, index=terminal.index, dtype="object"),
            terminal_status=terminal["status"],
            brand=UNKNOWN_BRAND,
        ),
        THROUGHPUT_DIMENSIONS,
        fills={"assigned_reviewer_name": UNASSIGNED},
        measure="case_count",
    )


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


def case_current_hop(
    reader: Reader,
    writer: Writer,
    *,
    as_of: dt.datetime,
) -> Dataset:
    """The current-state hop. **Grain: one row per ``case_id``.**

    Reads the whole silver history across every list, derives the deterministic
    ``case_id``, reduces to the latest observation of each Case, stamps the
    run's ``as_of_utc``, and refreshes the table.

    ``UniqueValidator(CASE_ID_COLUMN)`` sits after the reduction, where it can
    never fire: ``drop_duplicates`` has just guaranteed what it checks. It is
    kept as a **tripwire** -- this is the one hop whose grain comes from a rule
    rather than from a ``groupby``, so the one a future change could get wrong.

    The ``amended_outcome`` blob is flattened **here, not at silver**:
    ``case_version`` is the rename and the type contract and nothing else, and
    keeps every blob as landed text -- the faithful observation history, and
    the only place a malformed blob is recoverable. So ``case_current`` derives
    the ``AMENDED_OUTCOME_FIELDS`` columns no silver row carries, exactly as
    the Detail Tables derive typed rows from the other four blobs -- this blob
    is 1:1 with the Case, so its normalised home is columns on the Case row
    rather than a one-row-per-Case table wearing a join. Flattened after the
    reduction, so only each Case's winning blob is ever parsed -- and a
    malformed blob in a *losing* observation cannot abort the rebuild.

    No raw blob column is republished: the flatten consumes
    ``amended_outcome``, and ``DETAIL_BLOB_COLUMNS`` are dropped -- see the
    comment there for why.
    """
    with hop(f"{FEED_NAME}:gold:{CURRENT_TABLE}"):
        data = read(reader)
        data = transform(
            DeriveKey(
                into=CASE_ID_COLUMN,
                namespace=FEED_NAME,
                natural_key=list(NATURAL_KEY),
            ),
            data,
            name="derive-key",
        )
        data = transform(latest_case_version, data, name="latest-version")
        # The flatten consumes amended_outcome (drop is the default); the other
        # four blobs are dropped explicitly -- see DETAIL_BLOB_COLUMNS.
        data = transform(
            FlattenJsonObject(column="amended_outcome", fields=AMENDED_OUTCOME_FIELDS),
            data,
            name="flatten-amended-outcome",
        )
        data = transform(
            DropColumns(list(DETAIL_BLOB_COLUMNS)), data, name="drop-blobs"
        )
        data = transform(
            Stamp(AS_OF_COLUMN, as_of.isoformat()), data, name="stamp-as-of"
        )
        validate(UniqueValidator(CASE_ID_COLUMN), data, name="unique-validate")
        return write(writer, data)


def gold_detail_hop(
    reader: Reader,
    writer: Writer,
    *,
    grain: Sequence[str],
    observations: Reader,
    as_of: dt.datetime,
    name: str,
) -> Dataset:
    """One Detail Table's gold hop. **Grain: one row per ``grain``.**

    Reduces a silver Detail Table's accumulated history to the child rows of
    the Cases' *winning* observation. It never orders and never breaks a tie --
    ``latest_case_version`` has already picked the winner, and a second
    ordering path here could disagree with it. **Precondition**: a
    Detail row's ``case_type`` must be the settled one, or the semi-join
    matches nothing and gold lands zero rows silently.
    """
    with hop(name):
        data = read(reader)
        data = transform(
            DeriveKey(
                into=CASE_ID_COLUMN,
                namespace=FEED_NAME,
                natural_key=list(NATURAL_KEY),
            ),
            data,
            name="derive-key",
        )
        data = transform(
            JoinWith(
                partial(winning_observations, observations),
                on=list(WINNER_COLUMNS),
                how="inner",
                name="winning-observations",
            ),
            data,
            name="latest-observation",
        )
        data = transform(
            Stamp(AS_OF_COLUMN, as_of.isoformat()), data, name="stamp-as-of"
        )
        validate(UniqueValidator(list(grain)), data, name="unique-validate")
        return write(writer, data)


# --- publication ------------------------------------------------------------


def publish_gold(med: Medallion, *, as_of: dt.datetime) -> None:
    """Rebuild every gold table from the accumulated silver history.

    ``case_current`` is published first and its dataset feeds the Detail
    Tables and the six aggregates, so silver is read once and each of them
    reduces exactly the current table's own rows. They commit independently,
    in order; a failure part-way leaves the earlier ones refreshed, which is
    safe because the caller has not advanced any watermark and the next run
    rebuilds everything. See ``docs/gold-accumulation.md`` for why each source
    is read from memory rather than re-read from disk.

    Each hop's steps read the ambient run context the runner makes active --
    which is where a dry run's write-nothing behaviour comes from, and why
    nothing here is passed a run log by hand.
    """
    # Only a dry run can have any of these silver tables missing; one probe up
    # front, rather than a per-table skip, so a partial silver history cannot
    # make gold silently under-publish.
    if any(
        med.silver.columns_of(table).columns() is None
        for table in (SILVER_TABLE, *DETAIL_TABLES)
    ):
        return

    current = case_current_hop(
        med.silver.reader(SILVER_TABLE),
        med.gold.writer(CURRENT_TABLE, Refresh()),
        as_of=as_of,
    )

    sources: dict[str, Dataset] = {CURRENT_TABLE: current}
    for table in DETAIL_TABLES:
        dataset = gold_detail_hop(
            med.silver.reader(table),
            med.gold.writer(table, Refresh()),
            grain=DETAIL_GRAIN[table],
            observations=DatasetReader(current),
            as_of=as_of,
            name=f"{FEED_NAME}:gold:{table}",
        )
        if table in DETAIL_AGGREGATES.values():
            sources[table] = dataset

    for table, step_name, reduce in (
        ("case_counts_current", "count-by-base-grain-and-status", case_counts),
        (
            "case_age_buckets_current",
            "bucket-by-age",
            partial(age_buckets, as_of=as_of),
        ),
        (
            "case_age_from_assigned_buckets_current",
            "bucket-by-age-from-assigned",
            partial(age_buckets, as_of=as_of, age_from="assigned_at"),
        ),
        ("case_throughput_daily", "count-by-terminal-date", throughput),
        (
            "answer_remediation_current",
            "count-by-remediation",
            answer_remediation,
        ),
        ("appeal_outcomes_current", "count-by-outcome", appeal_outcomes),
    ):
        source = sources[DETAIL_AGGREGATES.get(table, CURRENT_TABLE)]
        with hop(f"{FEED_NAME}:gold:{table}"):
            data = read(DatasetReader(source))
            data = transform(reduce, data, name=step_name)
            data = transform(
                Stamp(AS_OF_COLUMN, as_of.isoformat()), data, name="stamp-as-of"
            )
            write(med.gold.writer(table, Refresh()), data)
