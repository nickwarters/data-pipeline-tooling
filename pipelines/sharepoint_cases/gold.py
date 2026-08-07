"""Gold for the ``sharepoint_cases`` feed: the current Case, and three aggregates.

Silver is an append-only history of *observations* -- one row per (list item,
version) the poll ever saw, with overlapping windows re-presenting rows that did
not change. Gold is the other shape: **one row per Case as it stands now**, and
three counts reduced from it. Every table is rebuilt whole with ``Refresh()`` on
every poll, so a re-drive converges rather than accumulating.

Four tables, and their declared grain:

===========================  =================================================
``case_current``             one row per ``case_id`` -- the latest observation
``case_counts_current``      reviewer x that reviewer's manager x ``status``
``case_age_buckets_current`` ``age_bucket`` x ``status``
``case_throughput_daily``    ``terminal_date`` x ``terminal_status``
===========================  =================================================

Only the first has a live grain gate; see :func:`case_current_builder` for why
the three aggregates get none. Every grain is declared, in each builder's
docstring and in the data dictionary.

**One instant decides everything.** ``as_of`` is the candidate SharePoint window
end -- the value the run is about to commit as its watermark -- and never
``utcnow()``: a re-drive of the same window must produce byte-identical gold.
Every table carries it as ``as_of_utc``. Where a *calendar date* is needed
(``terminal_date``, the age arithmetic) the UTC instant is converted to the
**local** date through ``tools.observability.timestamps``, which is where this
repository settles instants-are-UTC / dates-are-local.
"""

from __future__ import annotations

import datetime as dt
import re
from collections.abc import Callable
from functools import partial

import pandas as pd

from framework.core import Dataset, Reader, UniqueValidator, Writer
from framework.io import DatasetReader, Refresh
from framework.run import Pipeline, RunLog
from framework.transform import DeriveKey, Stamp
from tools.medallion import Medallion
from tools.observability.timestamps import local_date

from .schema import FEED_NAME, LIST_NAME

# The silver table gold reduces, and the current-state table every aggregate is
# then reduced from. ``GOLD_TABLES`` -- all four, in publication order -- is
# derived from the aggregate list at the foot of this module, so it cannot drift
# from what :func:`publish_gold` actually writes.
SILVER_TABLE = "case_version"
CURRENT_TABLE = "case_current"

CASE_ID_COLUMN = "case_id"
AS_OF_COLUMN = "as_of_utc"

# A Case whose review is over, and the source-written stamp that says when it
# ended. See :func:`case_throughput_daily_builder` for why these two stamps are
# the business event and not an approximation of it.
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

    The column holds whichever of three shapes the observation carried: a
    SharePoint ETag (``'"3"'``, ``'W/"3"'``, ``'"4,1"'`` -- quotes included, as
    stored), a dotted UI version (``'3.0'``, ``'512.0'``), or -- when the row
    answered with no version at all -- the sha256 digest the Reader falls back
    to. Only the first two order; the digest is not a version and cannot pretend
    to be one, so it sorts at ``(-1, -1)``.

    Comparing these as *text* is the thing to avoid: ``"10"`` sorts before
    ``"9"`` lexically, so a same-``Modified`` tie would resolve backwards.
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

    The sort key, in order: ``case_id``, the ``Modified`` instant, the parsed
    version's major then minor part, and finally ``source_observation_id``. One
    stable sort, then ``drop_duplicates(keep="last")``.

    Why each tier exists. ``Modified`` is the source's own idea of when the item
    last changed, so it leads. It is not a tie-break on its own -- two versions
    of one item can share a ``Modified`` to the second, and the append-only
    silver keyed on ``source_observation_id`` keeps both -- so the parsed
    version decides that tie. ``source_observation_id`` is the last resort, and
    it is deterministic rather than meaningful: a sha256 of the list name, the
    item id and the version.

    **Be honest about the last tier.** Every observation whose version could not
    be parsed -- the digest fallback -- shares the same ``(-1, -1)`` bucket. Two
    of *those* at the same ``Modified`` are therefore separated entirely by
    ``source_observation_id``: the same input always picks the same winner, but
    which one it picks carries no meaning. That is a property of a source row
    that arrived without a version, not something this reduction can repair.

    Takes ``case_id`` as already derived (``DeriveKey`` runs above it), so this
    stays a pure reduction over columns rather than knowing how a Case is keyed.

    ``source_modified_at`` is parsed **without** ``errors="coerce"``, so an
    unparseable stamp raises here rather than becoming ``NaT``. Silver declares
    the column non-null and typed, so there is no honest way for one to arrive;
    coercing would sort the bad row *last* and hand it the Case, which is the
    same NA trap ``_NO_VERSION`` exists to avoid.
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


def _case_counts(dataset: Dataset) -> Dataset:
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


def _age_buckets(dataset: Dataset, *, as_of: dt.datetime) -> Dataset:
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


def _throughput(dataset: Dataset) -> Dataset:
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

    Reads the whole silver history, derives the deterministic ``case_id`` from
    the list item id, reduces to the latest observation of each Case, stamps the
    run's ``as_of_utc``, and refreshes the table.

    ``UniqueValidator(CASE_ID_COLUMN)`` sits after the reduction, where it can
    never fire: ``drop_duplicates`` has just guaranteed what it checks. It is
    kept anyway, and only here, as a **tripwire** -- the one place in this
    feed's gold where the grain is produced by a rule rather than by a
    ``groupby``, so the one place a future change to that rule could get it
    wrong. The three aggregate hops get no such gate, because there the check
    would be satisfied by construction with no rule to guard.

    Every silver column is republished, including the ``answers`` /
    ``conversation`` / ``details`` JSON blobs. They are the Case as it stands and
    a consumer has nowhere else to read them; the cost is that a poll rewrites
    them all, which is the price of ``Refresh()`` and cheap at this list's size.
    """
    p = Pipeline(f"{FEED_NAME}:gold:{CURRENT_TABLE}", run_log=run_log)
    r = p.read(reader, name="read")
    keyed = p.transform(
        DeriveKey(
            into=CASE_ID_COLUMN,
            namespace=LIST_NAME,
            natural_key=["source_item_id"],
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


def _aggregate_hop(
    reader: Reader,
    writer: Writer,
    *,
    table: str,
    transform: Callable[[Dataset], Dataset],
    step: str,
    as_of: dt.datetime,
    run_log: RunLog | None,
) -> Pipeline:
    """The wiring every aggregate hop shares: read, count, stamp, refresh.

    The three aggregates differ only in what they count, so only the table they
    publish, the transform that counts and the step's name are theirs. Each
    keeps its own builder, because the grain and the reasoning behind it are the
    part worth reading.
    """
    p = Pipeline(f"{FEED_NAME}:gold:{table}", run_log=run_log)
    r = p.read(reader, name="read")
    counted = p.transform(transform, r, name=step)
    stamped = p.transform(
        Stamp(AS_OF_COLUMN, as_of.isoformat()), counted, name="stamp-as-of"
    )
    p.write(writer, stamped, name="write")
    return p


def case_counts_current_builder(
    reader: Reader,
    writer: Writer,
    *,
    as_of: dt.datetime,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the current-count hop.
    **Grain: ``assigned_reviewer_name`` x ``assigned_reviewer_manager_name`` x
    ``status``.**

    The Assigned Reviewer leads, because the question is who is holding what.
    The manager is kept alongside rather than as a separate table: it is how the
    rows roll up, and a consumer that wants counts per manager sums this table
    instead of reading a second one that could disagree with it. Both are
    carried under silver's own column names.

    Neither is a team. The provisioned list has no team column, and what the
    review platform calls "my team" is exactly the set of Cases whose
    ``AssignedReviewerManagerId`` is the signed-in user. Naming a dimension
    ``owning_team`` would assert something that does not exist, and shortening
    the manager to ``reviewer_manager_name`` would invent a synonym for a row
    that also carries ``responsible_party_manager_name``.

    A Case with no Assigned Reviewer, or none recorded for that reviewer's
    manager, is counted under the literal ``"(unassigned)"``. That is a
    reporting fill and never a source value; it exists because a NULL group key
    is a hole in the grain that a reader may silently drop, which would make the
    table quietly fail to add up to the number of current Cases.
    """
    return _aggregate_hop(
        reader,
        writer,
        table="case_counts_current",
        transform=_case_counts,
        step="count-by-reviewer-and-status",
        as_of=as_of,
        run_log=run_log,
    )


def case_age_buckets_current_builder(
    reader: Reader,
    writer: Writer,
    *,
    as_of: dt.datetime,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the age-profile hop. **Grain: ``age_bucket`` x ``status``.**

    Age is whole **calendar** days from ``created`` to ``as_of``, both taken as
    local dates. Not working days: ``tools.calendar.WorkingDayCalendar`` needs a
    seeded holiday set and nothing in this feed supplies one, so a working-day
    age would be a guess dressed as a measure. If a consumer asks for it, that is
    the later change -- seed the calendar, then use it.

    ``age_bucket_order`` travels with the label so a consumer can sort the
    buckets without parsing ``"15-30 days"``. Every current Case appears in
    exactly one bucket (``unknown`` catches a null ``created``), so this table's
    total reconciles exactly with ``case_counts_current``.

    The reviewer dimensions are deliberately absent: they are one join away in
    ``case_current``, and carrying them here would multiply the table for a
    breakdown nobody has asked for.
    """
    return _aggregate_hop(
        reader,
        writer,
        table="case_age_buckets_current",
        transform=partial(_age_buckets, as_of=as_of),
        step="bucket-by-age",
        as_of=as_of,
        run_log=run_log,
    )


def case_throughput_daily_builder(
    reader: Reader,
    writer: Writer,
    *,
    as_of: dt.datetime,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the throughput hop. **Grain: ``terminal_date`` x ``terminal_status``.**

    Measures Cases that *first entered* a terminal state on a local calendar
    date. That event is derivable here rather than reconstructed, because the
    source writes it: in the review platform's Case machine, ``completedAt`` has
    exactly two writers and both refuse an already-terminal Case, no path moves
    a Case back to ``In-progress``, and ``voidedAt`` is the same shape. So there
    is one transition into a terminal state per Case and its stamp is
    write-once -- which makes this a source-written business event rather than an
    artefact of when we happened to poll. Overlapping re-reads cannot inflate it:
    the count is taken from the *current* row, one per Case.

    Two caveats, both real:

    * The invariant "terminal status implies a stamp" is enforced nowhere, and a
      list row is editable in the SharePoint web UI. A terminal Case with no
      stamp is counted under the literal ``"(unstamped)"`` rather than dropped or
      given a NULL date, so the table still adds up to the number of Cases
      currently in a terminal status.
    * It is the *source's* stamp under ``Refresh()``. A hand-edited or backdated
      stamp therefore changes a historical count on the next poll. That is the
      honest reading of a source that owns the event; a frozen copy would report
      a number the source no longer agrees with.
    """
    return _aggregate_hop(
        reader,
        writer,
        table="case_throughput_daily",
        transform=_throughput,
        step="count-by-terminal-date",
        as_of=as_of,
        run_log=run_log,
    )


# --- publication ------------------------------------------------------------


def _aggregates() -> list[tuple[str, Callable[..., Pipeline]]]:
    """The three aggregates in publication order: each table and its builder.

    Resolved per call rather than bound into a module constant, so a test that
    substitutes a builder on this module is still the builder that runs.
    """
    return [
        ("case_counts_current", case_counts_current_builder),
        ("case_age_buckets_current", case_age_buckets_current_builder),
        ("case_throughput_daily", case_throughput_daily_builder),
    ]


# All four gold tables, in publication order. Derived from the pair list rather
# than written out beside it, so the declared set and the published set are one
# thing.
GOLD_TABLES = (CURRENT_TABLE, *(table for table, _ in _aggregates()))


def _publish(pipeline: Pipeline, describe: bool) -> Dataset:
    """Print the hop's plan when asked, run it, and hand back what it produced."""
    if describe:
        print(pipeline.describe())
    return pipeline.run()


def publish_gold(
    med: Medallion,
    *,
    as_of: dt.datetime,
    describe: bool = False,
    run_log: RunLog | None = None,
) -> None:
    """Rebuild all four gold tables from the accumulated silver history.

    ``case_current`` is published first and its resulting dataset feeds the three
    aggregates through a :class:`~framework.io.DatasetReader`, so silver is read
    once and every aggregate counts exactly the rows the current table holds. The
    aggregates commit independently, in order; a failure part-way leaves the
    earlier ones refreshed, which is safe because the caller has not advanced the
    watermark and the next run rebuilds all four from the same history.

    Every hop runs as a bare ``p.run()``, exactly as the raw and silver hops
    above it do, and so inherits the **ambient** run context the runner makes
    active -- which is where a dry run's write-nothing behaviour comes from. No
    context is passed in here because none of these hops would read it.

    The first thing it does is ask whether silver has landed anything at all.
    Only one situation answers no: a **dry run against a fresh base directory**,
    where the silver write was previewed rather than performed, so there is no
    table to read. Previewing no gold steps there is honest -- there is nothing
    to reduce. A real run always creates the table, even for a quiet window, so
    this never fires in production. It is a *probe* and not a caught
    ``OperationalError``, which would also swallow "database is locked".
    """
    if med.silver.columns_of(SILVER_TABLE).columns() is None:
        return

    current = _publish(
        case_current_builder(
            med.silver.reader(SILVER_TABLE),
            med.gold.writer(CURRENT_TABLE, Refresh()),
            as_of=as_of,
            run_log=run_log,
        ),
        describe,
    )

    for table, builder in _aggregates():
        _publish(
            builder(
                DatasetReader(current),
                med.gold.writer(table, Refresh()),
                as_of=as_of,
                run_log=run_log,
            ),
            describe,
        )
