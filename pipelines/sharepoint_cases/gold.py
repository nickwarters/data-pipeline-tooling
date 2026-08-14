"""Gold for the ``sharepoint_cases`` feed: the current Case, and three aggregates.

Silver is an append-only history of *observations* across every declared Case
list. Gold is the other shape: **one row per Case as it stands now**, over every
list, and three counts reduced from it. Every table is rebuilt whole with
``Refresh()`` on every poll, so a re-drive converges rather than accumulating.

Four tables, and their declared grain:

===========================  =================================================
``case_current``             one row per ``case_id`` -- the latest observation
``case_counts_current``      reviewer x that reviewer's manager x ``status``
``case_age_buckets_current`` ``age_bucket`` x ``status``
``case_throughput_daily``    ``terminal_date`` x ``terminal_status``
===========================  =================================================

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

import pandas as pd

from framework.core import Dataset, Reader, UniqueValidator, Writer
from framework.io import DatasetReader, Refresh
from framework.run import Pipeline, RunLog
from framework.transform import DeriveKey, Stamp
from tools.medallion import Medallion
from tools.observability.timestamps import local_date

from .schema import FEED_NAME, NATURAL_KEY

# The silver table gold reduces, and the current-state table every aggregate is
# then reduced from.
SILVER_TABLE = "case_version"
CURRENT_TABLE = "case_current"

# All four gold tables, in publication order.
GOLD_TABLES = (
    CURRENT_TABLE,
    "case_counts_current",
    "case_age_buckets_current",
    "case_throughput_daily",
)

CASE_ID_COLUMN = "case_id"
AS_OF_COLUMN = "as_of_utc"

# A Case whose review is over, and the source-written stamp that says when it
# ended. The source writes each stamp once, on the one transition into that
# state, so it is a business event rather than an artefact of when we polled.
TERMINAL_STATUSES = {"Completed": "completed_at", "Void": "voided_at"}

# Reporting fills, not source values. Both are literal keys rather than NULL so
# the grain of an aggregate has no hole in it: a NULL group key is a hole a
# reader may silently drop, losing rows from a total.
UNASSIGNED = "(unassigned)"
UNSTAMPED = "(unstamped)"

# The grain of ``case_counts_current``, in the order it groups and sorts by. The
# Assigned Reviewer leads: the question this table answers is "who is holding
# what", and the manager is the roll-up over that, not the other way round.
COUNT_DIMENSIONS = (
    "assigned_reviewer_name",
    "assigned_reviewer_manager_name",
    "status",
)

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


# --- the aggregates ---------------------------------------------------------


def case_counts(dataset: Dataset) -> Dataset:
    """Count current Cases by reviewer, that reviewer's manager, and status."""
    frame = dataset.to_pandas()
    # Only the two Person columns are filled; ``status`` is declared non-null in
    # silver and a null there is a schema breach, not a reporting gap.
    filled = {
        column: frame[column].where(frame[column].notna(), UNASSIGNED)
        for column in ("assigned_reviewer_name", "assigned_reviewer_manager_name")
    }
    counted = (
        frame.assign(**filled)
        .groupby(list(COUNT_DIMENSIONS))
        .size()
        .reset_index(name="case_count")
        .sort_values(list(COUNT_DIMENSIONS), kind="stable")
    )
    return Dataset.from_pandas(counted.reset_index(drop=True))


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


# --- publication ------------------------------------------------------------


def publish_gold(
    med: Medallion,
    *,
    as_of: dt.datetime,
    describe: bool = False,
    run_log: RunLog | None = None,
) -> None:
    """Rebuild all four gold tables from the accumulated silver history.

    ``case_current`` is published first and its dataset feeds the three
    aggregates, so silver is read once and every aggregate counts exactly the
    rows the current table holds. They commit independently, in order; a failure
    part-way leaves the earlier ones refreshed, which is safe because the caller
    has not advanced any watermark and the next run rebuilds all four.

    Each hop runs as a bare ``p.run()``, so it inherits the ambient run context
    the runner makes active -- which is where a dry run's write-nothing
    behaviour comes from.
    """
    # Only a dry run against a fresh base directory has no silver table: the
    # write was previewed rather than performed, so there is nothing to reduce.
    # A probe rather than a caught OperationalError, which would also swallow
    # "database is locked".
    if med.silver.columns_of(SILVER_TABLE).columns() is None:
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

    for table, step, transform in (
        ("case_counts_current", "count-by-reviewer-and-status", case_counts),
        (
            "case_age_buckets_current",
            "bucket-by-age",
            partial(age_buckets, as_of=as_of),
        ),
        ("case_throughput_daily", "count-by-terminal-date", throughput),
    ):
        p = Pipeline(f"{FEED_NAME}:gold:{table}", run_log=run_log)
        node = p.read(DatasetReader(current), name="read")
        node = p.transform(transform, node, name=step)
        node = p.transform(
            Stamp(AS_OF_COLUMN, as_of.isoformat()), node, name="stamp-as-of"
        )
        p.write(med.gold.writer(table, Refresh()), node, name="write")
        if describe:
            print(p.describe())
        p.run()
