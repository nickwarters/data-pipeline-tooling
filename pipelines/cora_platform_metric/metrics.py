"""The reductions behind the ``cora_platform_metric`` gold tables.

Each function takes the Sync datasets as read and returns one Aggregate table;
nothing here reads or writes. ``case_stage_dwell``, ``case_hold`` and
``case_backlog`` reduce the observation history -- put in order once, by
``ordered_history`` -- and so measure what the polls saw: a change reversed
between two polls was never observed. Every table is
stamped with Sync's own ``as_of_utc`` and open intervals are measured to it, so
a re-run over the same snapshot gives the same numbers.

Each reduction hands its rows to ``_finish`` with the dataclass in ``schema``
that declares the table: that dataclass is the one statement of a table's
columns, their order and their types, so an empty result still lands the shape
the table's ``SchemaValidator`` gates.
"""

from __future__ import annotations

import datetime as dt
import json
from typing import get_type_hints

import numpy as np
import pandas as pd

from framework.core import Dataset
from tools.calendar import WorkingDayCalendar
from tools.integrations.sharepoint_rest import version_order
from tools.observability import timestamps
from tools.observability.timestamps import local_date

from .schema import (
    DURATION_WINDOWS,
    REMEDIATION_SLA,
    REVIEW_SLA,
    AnswerActionLoad,
    AnswerRemediationByManager,
    AppealCycleTime,
    AppealQuestionCitation,
    AppealRateByReviewerMonthly,
    CaseBacklogDaily,
    CaseDueProfile,
    CaseDurationPercentilesDaily,
    CaseFirstTimeRightMonthly,
    CaseHold,
    CaseIntakeDaily,
    CaseLifecycleDurationMonthly,
    CaseOpenAgeDaily,
    CaseOutcomeMonthly,
    CaseSlaAttainmentMonthly,
    CaseStageDwell,
    CaseVoidMonthly,
    ConversationPostingPattern,
    ConversationResponseTime,
    ConversationVolume,
    RemediationOverdue,
    ReviewerThroughputWeekly,
    ReviewerWorkload,
    ReviewerWorkloadDaily,
)

AS_OF_COLUMN = "as_of_utc"
CASE_ID_COLUMN = "case_id"

# The Sync subject's Case identity, as its history carries it. The history is
# read below the layer that derives ``case_id``, so the natural key stands in.
HISTORY_KEY = ("case_type", "source_item_id")

# Reporting fills, not source values -- literal keys rather than NULL so an
# aggregate's grain has no hole a reader may silently drop. The same spellings
# the Sync subject's own aggregates use.
UNKNOWN_BRAND = "(unknown)"
UNASSIGNED = "(unassigned)"
UNDECIDED = "(undecided)"
UNRESOLVED = "(unresolved)"
UNSTATED = "(unstated)"
UNSTAMPED = "(unstamped)"
# Time a Case was open before any poll saw which status it was in.
UNOBSERVED = "(unobserved)"
# The row a distribution table adds over every Case Type at once: a percentile
# does not roll up, so the total is taken, not left to a reader to sum.
ALL_CASE_TYPES = "(all)"

# The Case lifecycle's terminal states: a Case observed in one has stopped
# dwelling, so its last interval is neither open nor closed -- it is over.
TERMINAL_STATUSES = ("Completed", "Void")

# Where a Case's *first* observation already carries a status, the poll that
# first saw it is not when it entered that status. For the two entry states the
# source stamps its own clock for, that stamp is the better start.
FIRST_OBSERVATION_ENTRY_STAMPS = {
    "To-allocate": "created",
    "In-progress": "assigned_at",
}

# Dwell's entry stamps, widened to every status the source stamps entry into.
BACKLOG_ENTRY_STAMPS = {
    **FIRST_OBSERVATION_ENTRY_STAMPS,
    "Actions In Progress": "reportable_at",
    "Completed": "completed_at",
    "Void": "voided_at",
}

# The open statuses every Case Type's backlog grid carries, observed or not.
OPEN_STATUSES = ("To-allocate", "In-progress", "Actions In Progress")

# (leg, from stamp, to stamp, actions-path Cases only), in lifecycle order.
LIFECYCLE_LEGS = (
    ("allocation", "created", "assigned_at", False),
    ("review", "assigned_at", "reportable_at", False),
    ("remediation", "reportable_at", "completed_at", True),
    ("to_reportable", "created", "reportable_at", False),
    ("end_to_end", "created", "completed_at", False),
)

# Each SLA clock's open status and due-date column; a Case is on one at a time.
DUE_CLOCKS = (
    (REVIEW_SLA, "In-progress", "due_date"),
    (REMEDIATION_SLA, "Actions In Progress", "remediation_due_date"),
)

# (measure, from stamp, to stamp, actions-path Cases only) for the duration
# percentiles; ``sla_margin_review`` is working days, measured apart.
DURATION_LEGS = (
    ("end_to_end", "created", "completed_at", False),
    ("to_reportable", "created", "reportable_at", False),
    ("allocation_wait", "created", "assigned_at", False),
    ("review", "assigned_at", "reportable_at", False),
    ("remediation", "reportable_at", "completed_at", True),
)
SLA_MARGIN_MEASURE = "sla_margin_review"
# The measures that end at ``completed_at``: the first of those sets the first
# as-of date.
COMPLETION_MEASURES = (
    *(measure for measure, _, ended, _ in DURATION_LEGS if ended == "completed_at"),
    SLA_MARGIN_MEASURE,
)

# Each open status's Case-age measure.
OPEN_AGE_BY_STATUS = {
    "To-allocate": "open_age_to_allocate",
    "In-progress": "open_age_in_progress",
    "Actions In Progress": "open_age_actions_in_progress",
}

# A percentile over fewer measurements than this is published NULL: with so
# few, it is one Case's value, not a tail.
MIN_N_FOR_P90 = 10
MIN_N_FOR_P95 = 20

# Output window for ``reviewer_workload_current``, in whole weeks.
WORKLOAD_WINDOW_DAYS = 28

# ISO weekday order -> name, so a posting-pattern row sorts by the number and
# reads by the name without anyone hand-numbering the days.
WEEKDAY_NAMES = (
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
)

SECONDS_PER_DAY = 86_400.0
SECONDS_PER_HOUR = 3_600.0

# The columns each reduction needs from what it is handed; the pipeline gates
# each source on the union for its consumers, and the failure message lands
# beside the code that depends on them.
ORDERING_COLUMNS = (
    *HISTORY_KEY,
    "source_modified_at",
    "source_version",
    "source_observation_id",
)
HISTORY_COLUMNS = (
    *ORDERING_COLUMNS,
    "status",
    "assigned_reviewer_name",
    "created",
    "assigned_at",
    "on_hold",
    "placed_on_hold_at",
)
BACKLOG_COLUMNS = (*HISTORY_COLUMNS, "reportable_at", "completed_at", "voided_at")
CURRENT_COLUMNS = (
    CASE_ID_COLUMN,
    "case_type",
    "status",
    "assigned_reviewer_manager_name",
    "responsible_party_manager_name",
    "due_date",
    "remediation_due_date",
    "completed_at",
    "created",
    "voided_at",
    "void_reason",
    "voided_by_name",
    AS_OF_COLUMN,
)
LIFECYCLE_COLUMNS = (
    "case_type",
    "status",
    "assigned_reviewer_name",
    "created",
    "assigned_at",
    "reportable_at",
    "completed_at",
    "had_remediation",
)
OUTCOME_COLUMNS = (
    "case_type",
    "status",
    "assigned_reviewer_name",
    "reportable_at",
    "effective_outcome",
    "effective_had_remediation",
    "outcome_overridden",
)
DUE_COLUMNS = (
    "case_type",
    "status",
    "assigned_reviewer_name",
    "on_hold",
    "due_date",
    "remediation_due_date",
)
REMEDIATION_OVERDUE_COLUMNS = (
    CASE_ID_COLUMN,
    "case_type",
    "status",
    "assigned_reviewer_name",
    "responsible_party_name",
    "remediation_due_date",
)
WORKLOAD_COLUMNS = (
    *HISTORY_KEY,
    "status",
    "assigned_reviewer_name",
    "on_hold",
    "assigned_at",
    "reportable_at",
)
APPEAL_RATE_COLUMNS = (
    CASE_ID_COLUMN,
    "case_type",
    "status",
    "assigned_reviewer_name",
    "reportable_at",
)
OUTSTANDING_ANSWER_COLUMNS = (
    CASE_ID_COLUMN,
    "question_id",
    "remediation_required",
    "remediation_status",
)
ANSWER_COLUMNS = (
    CASE_ID_COLUMN,
    "case_type",
    "remediation_required",
    "remediation_status",
)
ANSWER_ACTION_COLUMNS = (CASE_ID_COLUMN, "case_type", "question_id", "action_id")
APPEAL_COLUMNS = (
    CASE_ID_COLUMN,
    "case_type",
    "appeal_id",
    "raised_at",
    "state",
    "resolution_verdict",
    "resolution_at",
    "cited_question_ids_json",
)
DURATION_COLUMNS = (
    "case_type",
    "status",
    "created",
    "assigned_at",
    "reportable_at",
    "completed_at",
    "had_remediation",
    "due_date",
)
OPEN_AGE_COLUMNS = (
    "case_type",
    "status",
    "created",
    "awaiting_responsible_party",
    "awaiting_since",
    "has_open_appeal",
    "appeal_raised_at",
)
FIRST_TIME_RIGHT_COLUMNS = (
    CASE_ID_COLUMN,
    "case_type",
    "status",
    "assigned_reviewer_name",
    "reportable_at",
    "outcome_overridden",
    "amended_outcome_id",
    "amended_at",
)
THROUGHPUT_COLUMNS = ("case_type", "status", "assigned_reviewer_name", "reportable_at")
CONVERSATION_COLUMNS = (
    CASE_ID_COLUMN,
    "case_type",
    "seq",
    "author_login",
    "posted_at",
)


# --- shared helpers ---------------------------------------------------------


def snapshot_as_of(current: Dataset) -> str:
    """The one ``as_of_utc`` Sync stamped on every current row.

    Sync's Refresh-built current table carries one literal on every row; an
    empty table carries none, and then there is no snapshot to report against.
    """
    frame = current.to_pandas()
    if frame.empty:
        raise ValueError(
            "case_current is empty: no Sync snapshot instant to report against"
        )
    return str(frame[AS_OF_COLUMN].iloc[0])


def _instants(values):
    """ISO text (or datetimes) as UTC instants -- a whole column or one value.

    Anything that does not parse becomes ``NaT``, and the measure it feeds
    drops that row rather than the run failing on one bad stamp.
    """
    return pd.to_datetime(values, utc=True, errors="coerce", format="ISO8601")


def _filled(frame: pd.DataFrame, fills: dict[str, str]) -> pd.DataFrame:
    """Replace a dimension's NULLs with the literal that stands in for them.

    Through ``object``: an all-null column arrives as ``float64``, and filling
    it in place would coerce the literal back to a number.
    """
    return frame.assign(
        **{
            column: frame[column].astype("object").fillna(literal)
            for column, literal in fills.items()
        }
    )


def _rounded(value: object) -> float | None:
    """A statistic as it is published; None where there was nothing to take."""
    return None if pd.isna(value) else round(float(value), 3)


def _mean(values: pd.Series) -> float | None:
    return _rounded(values.dropna().mean())


def _quantile(values: pd.Series, quantile: float) -> float | None:
    return _rounded(values.dropna().quantile(quantile))


def _maximum(values: pd.Series) -> float | None:
    return _rounded(values.dropna().max())


def _summaries(frame: pd.DataFrame, dims: list[str], value: str) -> pd.DataFrame:
    """Per ``dims`` group (sorted, a NULL key dropped as ``groupby`` drops it):
    its rows, and the count, total, mean, p50, p90 and max of ``value``'s
    non-null entries.

    Each statistic is bit for bit what ``Series.sum`` / ``.mean`` /
    ``.quantile`` / ``.max`` give on that group's values alone -- the total
    summed over the group in frame order, the quantiles interpolated as numpy
    interpolates them -- so a published figure rounds the same however the
    groups were formed.
    """
    grouped = frame.groupby(dims, sort=True)
    rows = grouped.size()
    codes = grouped.ngroup().to_numpy(dtype="float64")
    values = frame[value].to_numpy(dtype="float64")
    measured = ~np.isnan(codes) & ~np.isnan(values)
    codes, values = codes[measured].astype("int64"), values[measured]
    counts = np.bincount(codes, minlength=len(rows))
    ends = np.cumsum(counts)
    starts = ends - counts
    in_frame_order = values[np.argsort(codes, kind="stable")]
    totals = np.array(
        [in_frame_order[start:end].sum() for start, end in zip(starts, ends)],
        dtype="float64",
    )
    ascending = values[np.lexsort((values, codes))]

    with np.errstate(invalid="ignore", divide="ignore"):
        means = np.where(counts > 0, totals / counts, np.nan)
    return pd.DataFrame(
        {
            "rows": rows.to_numpy(),
            "count": counts,
            "total": totals,
            "mean": means,
            "p50": _run_quantiles(ascending, starts, counts, 0.5),
            "p90": _run_quantiles(ascending, starts, counts, 0.9),
            "max": _run_quantiles(ascending, starts, counts, 1.0),
        },
        index=rows.index,
    )


def _run_quantiles(
    ascending: np.ndarray, starts: np.ndarray, counts: np.ndarray, q: float
) -> np.ndarray:
    """Quantile ``q`` of each run ``ascending[start : start + count]``, as
    ``Series.quantile`` takes it; NaN for an empty run.

    numpy's linear method: index (n - 1) * q, interpolated from whichever
    neighbour is nearer, the last value once the index reaches it.
    """
    some = counts > 0
    index = (counts - 1) * q
    top = index >= counts - 1
    below = np.where(top, -1, np.floor(index)).astype("int64")

    def at(offsets: np.ndarray) -> np.ndarray:
        picked = np.full(len(counts), np.nan)
        picked[some] = ascending[(starts + offsets)[some]]
        return picked

    lower = at(np.where(top, counts - 1, below))
    upper = at(np.where(top, counts - 1, below + 1))
    weight = index - below
    step = upper - lower
    return np.where(weight >= 0.5, upper - step * (1 - weight), lower + step * weight)


def _rounded_all(values) -> list[float | None]:
    """``_rounded`` over a column of statistics."""
    return [_rounded(value) for value in values]


# What each declared type is held as while the table is being built.
PANDAS_DTYPES = {str: "string", int: "int64", float: "float64", bool: "bool"}


def _finish(
    rows: list[dict[str, object]] | pd.DataFrame,
    table: type,
    *,
    as_of: str,
    sort_by: tuple[str, ...],
) -> Dataset:
    """Rows -> a stamped, sorted frame shaped as ``table`` declares.

    The columns, their order and their types are read off the schema dataclass
    rather than restated here, so an empty result still carries the declared
    shape: string dimensions, ``int64`` counts and ``float64`` statistics (NaN
    where a group had nothing to summarise).
    """
    columns = {
        name: PANDAS_DTYPES[declared]
        for name, declared in get_type_hints(table).items()
    }
    frame = pd.DataFrame(rows, columns=list(columns))
    frame[AS_OF_COLUMN] = as_of
    for column, dtype in columns.items():
        frame[column] = frame[column].astype(dtype)
    ordered = frame.sort_values(list(sort_by), kind="stable").reset_index(drop=True)
    return Dataset.from_pandas(ordered)


def _flagged(values: pd.Series) -> pd.Series:
    """A source flag as True/False, NULL reading as not set."""
    return values.notna() & values.fillna(0).astype(bool)


def _local_days(instants: pd.Series) -> pd.Series:
    """Each instant's local calendar date, as a midnight; ``NaT`` where none."""
    return timestamps.local_wall_clock(instants).dt.normalize()


def _month(instants: pd.Series) -> pd.Series:
    """``YYYY-MM`` of each instant's local date; None where there is no instant."""
    months = _local_days(instants).dt.strftime("%Y-%m").astype("object")
    return months.where(months.notna(), None)


def _local_day(instants: pd.Series) -> pd.Series:
    """``YYYY-MM-DD`` of each instant's local date; ``(unstamped)`` where none."""
    days = _local_days(instants).dt.strftime("%Y-%m-%d").astype("object")
    return days.where(days.notna(), UNSTAMPED)


def _days_until(stamps: pd.Series, today: dt.date) -> pd.Series:
    """Local calendar days from ``today`` to each stamp; negative once passed,
    NaN where there is no stamp."""
    return (_local_days(_instants(stamps)) - pd.Timestamp(today)).dt.days.astype(
        "float64"
    )


def _days_since(stamps: pd.Series, today: dt.date) -> pd.Series:
    """Local calendar days from each stamp to ``today``; NaN where none."""
    return (pd.Timestamp(today) - _local_days(_instants(stamps))).dt.days.astype(
        "float64"
    )


# --- history metrics --------------------------------------------------------


def ordered_history(history: Dataset) -> Dataset:
    """The observation history in the order things happened, per Case.

    Ordered by the source's own ``Modified`` instant, then -- as Sync's
    current-state rule does -- the parsed ``source_version``, since two versions
    can share a ``Modified`` and the later status must come last; then the
    observation id, a digest, as a deterministic last resort. An observation
    whose ``Modified`` does not parse, or that names no Case, has no place in
    that order and is dropped. Parsed and sorted once, for every reduction of
    the history; each row carries ``_modified``, the parsed instant, and
    ``_case``, its Case's position in that order.
    """
    frame = history.to_pandas()
    codes, versions = pd.factorize(frame["source_version"])
    parsed = np.array(
        [version_order(value) for value in [*versions, None]], dtype="int64"
    )
    frame = frame.assign(
        _modified=_instants(frame["source_modified_at"]),
        _version_major=parsed[codes, 0],
        _version_minor=parsed[codes, 1],
    )
    placed = frame["_modified"].notna() & frame[list(HISTORY_KEY)].notna().all(axis=1)
    ordered = frame.loc[placed].sort_values(
        [
            *HISTORY_KEY,
            "_modified",
            "_version_major",
            "_version_minor",
            "source_observation_id",
        ],
        kind="stable",
    )
    keys = ordered[list(HISTORY_KEY)]
    ordered = ordered.assign(_case=keys.ne(keys.shift()).any(axis=1).cumsum())
    return Dataset.from_pandas(ordered.reset_index(drop=True))


def _case_starts(frame: pd.DataFrame) -> pd.Series:
    """True on each Case's first row of an ordered history."""
    return frame["_case"].ne(frame["_case"].shift())


def _entry_instants(
    frame: pd.DataFrame, stamps: dict[str, str] = FIRST_OBSERVATION_ENTRY_STAMPS
) -> pd.Series:
    """When each row's Case entered the status it carries, were that row the
    Case's *first* observation: the source's own entry stamp where it has one
    for that status and it is no later than the poll, else the poll."""
    stamped = pd.Series(pd.NaT, index=frame.index, dtype=frame["_modified"].dtype)
    for status, column in stamps.items():
        stamped = stamped.where(frame["status"].ne(status), _instants(frame[column]))
    usable = stamped.notna() & stamped.le(frame["_modified"])
    return stamped.where(usable, frame["_modified"])


def _stays(frame: pd.DataFrame, first: pd.Series) -> tuple[pd.Series, pd.Series]:
    """Where each row starts a stay in a status, and when that stay began."""
    previous = frame["status"].shift()
    changed = frame["status"].ne(previous) & ~first
    began = frame["_modified"].where(~first, _entry_instants(frame.loc[first]))
    return changed, began.where(first | changed).ffill()


def _elapsed_days(started: pd.Series, ended: pd.Series) -> pd.Series:
    """Days from each start to its end, never negative."""
    return ((ended - started).dt.total_seconds() / SECONDS_PER_DAY).clip(lower=0.0)


def case_stage_dwell(history: Dataset, *, as_of: str) -> Dataset:
    """How long Cases dwell in each status. **Grain: brand x case_type x
    status.**

    Reduces the ordered history (``ordered_history``). Every change of
    ``status`` closes an interval at that observation's ``Modified`` and opens
    the next. A Case's last interval is *open* unless its status is terminal,
    and a terminal status left by a reopen closes no interval: that was the gap
    until the reopen, not a stage. Statistics are over closed intervals only --
    an open one has no length yet, and measuring it to ``as_of`` would mix two
    different questions (the Sync subject's age-bucket aggregates already
    answer "how long has it been waiting").
    """
    frame = history.to_pandas()
    first = _case_starts(frame)
    last = first.shift(-1, fill_value=True)
    changed, began = _stays(frame, first)
    left = frame["status"].shift()
    closed = pd.DataFrame(
        {
            "case_type": frame["case_type"],
            "status": left,
            "days": _elapsed_days(began.shift(), frame["_modified"]),
        }
    ).loc[changed & ~left.isin(TERMINAL_STATUSES)]
    still_open = frame.loc[
        last & ~frame["status"].isin(TERMINAL_STATUSES), ["case_type", "status"]
    ]
    stays = pd.concat([closed, still_open.assign(days=np.nan)], ignore_index=True)

    stats = _summaries(stays, ["case_type", "status"], "days")
    keys = stats.index.to_frame(index=False)
    rows = pd.DataFrame(
        {
            "brand": UNKNOWN_BRAND,
            "case_type": keys["case_type"],
            "status": keys["status"],
            "interval_count": stats["count"].to_numpy(),
            "open_interval_count": (stats["rows"] - stats["count"]).to_numpy(),
            "dwell_days_mean": _rounded_all(stats["mean"]),
            "dwell_days_p50": _rounded_all(stats["p50"]),
            "dwell_days_p90": _rounded_all(stats["p90"]),
            "dwell_days_max": _rounded_all(stats["max"]),
        }
    )
    return _finish(
        rows, CaseStageDwell, as_of=as_of, sort_by=("brand", "case_type", "status")
    )


def case_hold(history: Dataset, *, as_of: str) -> Dataset:
    """How often and how long Cases are held. **Grain: brand x case_type x
    assigned_reviewer_name.**

    Reduces the ordered history. A hold opens at the first observation
    carrying ``on_hold`` (from the source's ``placed_on_hold_at`` where it has
    one, else that observation's ``Modified``) and closes at the first later
    observation without it. A hold still open at the last observation is
    measured to ``as_of`` and counted in ``open_hold_count`` -- unless the Case
    has since closed, when it ends where the Case entered its terminal status.
    Attributed to the Reviewer the Case's latest observation names, so a
    reassigned Case's holds follow the Case.
    """
    frame = history.to_pandas()
    first = _case_starts(frame)
    last = first.shift(-1, fill_value=True)
    on_hold = _flagged(frame["on_hold"])
    was_on_hold = on_hold.shift(fill_value=False) & ~first
    placed = _instants(frame["placed_on_hold_at"])
    terminal = frame["status"].isin(TERMINAL_STATUSES)
    closed_at = (
        frame["_modified"]
        .where(terminal & (first | ~terminal.shift(fill_value=False)))
        .ffill()
        .where(last & terminal)
    )
    hold = (on_hold & ~was_on_hold).cumsum()
    reviewer = (
        frame["assigned_reviewer_name"]
        .where(last)
        .groupby(frame["_case"])
        .transform("last")
    )

    opened = frame.loc[on_hold & ~was_on_hold].assign(
        _hold=hold,
        _started=placed.where(placed.notna(), frame["_modified"]),
        _reviewer=reviewer,
    )
    released = pd.Series(
        frame["_modified"].loc[~on_hold & was_on_hold].array,
        index=hold.loc[~on_hold & was_on_hold].to_numpy(),
    )
    trailing = pd.Series(
        closed_at.loc[last & on_hold].array,
        index=hold.loc[last & on_hold].to_numpy(),
    )
    ends = pd.DataFrame(
        {
            "released": released.reindex(opened["_hold"]).array,
            "closed": trailing.reindex(opened["_hold"]).array,
        },
        index=opened.index,
    )
    still_open = ends["released"].isna() & ends["closed"].isna()
    ended = ends["released"].fillna(ends["closed"]).fillna(pd.Timestamp(as_of))
    held = pd.DataFrame(
        {
            "case_type": opened["case_type"],
            "source_item_id": opened["source_item_id"],
            "assigned_reviewer_name": opened["_reviewer"]
            .astype("object")
            .where(
                opened["_reviewer"].notna() & opened["_reviewer"].ne(""), UNASSIGNED
            ),
            "days": _elapsed_days(opened["_started"], ended),
            "open": still_open,
        }
    )

    dims = ["case_type", "assigned_reviewer_name"]
    stats = _summaries(held, dims, "days")
    counted = held.groupby(dims, sort=True).agg(
        case_count=("source_item_id", "nunique"), open_hold_count=("open", "sum")
    )
    keys = stats.index.to_frame(index=False)
    rows = pd.DataFrame(
        {
            "brand": UNKNOWN_BRAND,
            "case_type": keys["case_type"],
            "assigned_reviewer_name": keys["assigned_reviewer_name"],
            "case_count": counted["case_count"].to_numpy(),
            "hold_count": stats["rows"].to_numpy(),
            "open_hold_count": counted["open_hold_count"].to_numpy(),
            "held_days_total": [round(float(v), 3) for v in stats["total"]],
            "held_days_mean": [round(float(v), 3) for v in stats["mean"]],
        }
    )
    return _finish(
        rows,
        CaseHold,
        as_of=as_of,
        sort_by=("brand", "case_type", "assigned_reviewer_name"),
    )


def _open_spans(frame: pd.DataFrame, as_of_day: pd.Timestamp) -> pd.DataFrame:
    """Every Case's open time as ``(case_type, status, start, end)`` local-day
    spans, end exclusive: on each local day, the status the Case closed it in."""
    first = _case_starts(frame)
    changed = frame["status"].ne(frame["status"].shift()) & ~first
    heads = frame.loc[first]
    entered = _entry_instants(heads, BACKLOG_ENTRY_STAMPS)
    opened = _instants(heads["created"])
    events = pd.concat(
        [
            pd.DataFrame(
                {
                    "_case": heads["_case"],
                    "_row": heads.index,
                    "_order": 0,
                    "case_type": heads["case_type"],
                    "status": UNOBSERVED,
                    "_at": opened,
                }
            ).loc[opened.notna() & opened.lt(entered)],
            pd.DataFrame(
                {
                    "_case": frame["_case"],
                    "_row": frame.index,
                    "_order": 1,
                    "case_type": frame["case_type"],
                    "status": frame["status"],
                    "_at": frame["_modified"].where(~first, entered),
                }
            ).loc[first | changed],
        ]
    ).sort_values(["_row", "_order"], kind="stable")
    events["start"] = _local_days(events["_at"])
    events = events.drop_duplicates(["_case", "start"], keep="last")
    events = events.loc[events["start"].le(as_of_day)]
    events["end"] = (
        events.groupby("_case")["start"]
        .shift(-1)
        .fillna(as_of_day + pd.Timedelta(days=1))
    )
    spans = events.loc[~events["status"].isin(TERMINAL_STATUSES)]
    return spans[["case_type", "status", "start", "end"]]


def case_backlog(history: Dataset, *, as_of: str) -> Dataset:
    """Open Cases at each day's close, by status, rebuilt from the ordered
    history."""
    as_of_day = pd.Timestamp(local_date(as_of))
    spans = _open_spans(history.to_pandas(), as_of_day)

    grids = []
    for case_type, group in spans.groupby("case_type", sort=True):
        first_day = group["start"].min()
        length = (as_of_day - first_day).days + 1
        days = pd.date_range(first_day, periods=length, freq="D")
        for status in sorted({*OPEN_STATUSES, *group["status"]}):
            of_status = group.loc[group["status"].eq(status)]
            entered = np.bincount(
                (of_status["start"] - first_day).dt.days, minlength=length + 1
            )
            left = np.bincount(
                (of_status["end"] - first_day).dt.days, minlength=length + 1
            )
            grids.append(
                pd.DataFrame(
                    {
                        "backlog_date": days.strftime("%Y-%m-%d"),
                        "brand": UNKNOWN_BRAND,
                        "case_type": case_type,
                        "status": status,
                        "case_count": np.cumsum(entered - left)[:length],
                    }
                )
            )
    rows = pd.concat(grids, ignore_index=True) if grids else []
    return _finish(
        rows,
        CaseBacklogDaily,
        as_of=as_of,
        sort_by=("backlog_date", "brand", "case_type", "status"),
    )


# --- current metrics --------------------------------------------------------


def working_days_late(
    calendar: WorkingDayCalendar, due: dt.date, completed: dt.date
) -> int:
    """Working days strictly after ``due`` up to and including ``completed``;
    zero when completed on or before the due date."""
    late = 0
    day = due
    while day < completed:
        day += dt.timedelta(days=1)
        if calendar.is_working_day(day):
            late += 1
    return late


def _working_days_after(
    calendar: WorkingDayCalendar, due: pd.Series, completed: pd.Series
) -> pd.Series:
    """Signed working days from each due day to its completion day: those after
    ``due`` up to and including ``completed``, or, completed early, minus those
    after ``completed`` up to and including ``due``; NaN where either is
    missing."""
    weekmask = [day not in calendar.weekend for day in range(7)]
    after = pd.Series(np.nan, index=due.index)
    judged = due.notna() & completed.notna()
    if not judged.any() or not any(weekmask):
        return after.where(~judged, 0.0)
    due_days = due[judged].to_numpy("datetime64[D]")
    done_days = completed[judged].to_numpy("datetime64[D]")
    day = np.timedelta64(1, "D")
    rules = {"weekmask": weekmask, "holidays": sorted(calendar.holidays)}
    # Backwards, busday_count counts (end, begin] and negates it.
    after[judged] = np.busday_count(
        due_days + day, np.maximum(done_days, due_days) + day, **rules
    ) + np.busday_count(due_days, np.minimum(done_days, due_days), **rules)
    return after


def _working_days_late(
    calendar: WorkingDayCalendar, due: pd.Series, completed: pd.Series
) -> pd.Series:
    """``working_days_late`` for each pair of local days; NaN where no due day."""
    return _working_days_after(calendar, due, completed).clip(lower=0.0)


# Each SLA and the due-date column it judges ``completed_at`` against.
SLA_DUE_DATES = ((REVIEW_SLA, "due_date"), (REMEDIATION_SLA, "remediation_due_date"))


def sla_attainment(
    current: Dataset, *, as_of: str, calendar: WorkingDayCalendar | None = None
) -> Dataset:
    """Completed Cases against each SLA. **Grain: sla_kind x completed_month x
    brand x case_type x assigned_reviewer_manager_name.**

    One row family per SLA: the review SLA judges ``completed_at`` against
    ``due_date``; the remediation SLA judges it against
    ``remediation_due_date`` over only the Cases that carry one -- the source
    stamps no remediation-complete instant of its own, and the Case's final
    ``Completed`` transition is after its Actions close. Days late are
    ``working_days_late`` between the two local dates, on the calendar the run
    was given (weekends-only when none).
    """
    calendar = calendar or WorkingDayCalendar()
    frame = current.to_pandas()
    completed = frame.loc[frame["status"].eq("Completed")].copy()
    completed["_completed"] = _instants(completed["completed_at"])
    completed = completed.loc[completed["_completed"].notna()]
    completed["completed_month"] = _month(completed["_completed"])
    completed = _filled(completed, {"assigned_reviewer_manager_name": UNASSIGNED})

    dims = ["completed_month", "case_type", "assigned_reviewer_manager_name"]
    parts = []
    for sla_kind, due_column in SLA_DUE_DATES:
        judged = completed.assign(_due=_instants(completed[due_column]))
        if sla_kind == REMEDIATION_SLA:
            judged = judged.loc[judged["_due"].notna()]
        late = _working_days_late(
            calendar, _local_days(judged["_due"]), _local_days(judged["_completed"])
        )
        judged = judged.assign(
            _late=late,
            _over=late.where(late > 0),
            _on_time=late.eq(0),
            _is_late=late.gt(0),
            _no_due=late.isna(),
        )
        stats = _summaries(judged, dims, "_over")
        counted = judged.groupby(dims, sort=True)[
            ["_on_time", "_is_late", "_no_due"]
        ].sum()
        keys = stats.index.to_frame(index=False)
        parts.append(
            pd.DataFrame(
                {
                    "sla_kind": sla_kind,
                    "completed_month": keys["completed_month"],
                    "brand": UNKNOWN_BRAND,
                    "case_type": keys["case_type"],
                    "assigned_reviewer_manager_name": keys[
                        "assigned_reviewer_manager_name"
                    ],
                    "case_count": stats["rows"].to_numpy(),
                    "on_time_count": counted["_on_time"].to_numpy(),
                    "late_count": counted["_is_late"].to_numpy(),
                    "no_due_date_count": counted["_no_due"].to_numpy(),
                    "late_working_days_mean": _rounded_all(stats["mean"]),
                    "late_working_days_max": _rounded_all(stats["max"]),
                    "on_time_rate": [
                        round(on_time / (on_time + late), 4) if on_time + late else None
                        for on_time, late in zip(
                            counted["_on_time"], counted["_is_late"]
                        )
                    ],
                }
            )
        )
    return _finish(
        pd.concat(parts, ignore_index=True),
        CaseSlaAttainmentMonthly,
        as_of=as_of,
        sort_by=(
            "sla_kind",
            "completed_month",
            "brand",
            "case_type",
            "assigned_reviewer_manager_name",
        ),
    )


def void_monthly(current: Dataset, *, as_of: str) -> Dataset:
    """Voided Cases by reason and by whom. **Grain: void_month x brand x
    case_type x void_reason x voided_by_name.** Age at void is calendar days
    from ``created``."""
    frame = current.to_pandas()
    voided = frame.loc[frame["status"].eq("Void")].copy()
    voided["_voided"] = _instants(voided["voided_at"])
    voided = voided.loc[voided["_voided"].notna()]
    voided["void_month"] = _month(voided["_voided"])
    voided["_age"] = (
        (voided["_voided"] - _instants(voided["created"])).dt.total_seconds()
        / SECONDS_PER_DAY
    ).clip(lower=0.0)
    voided = _filled(voided, {"void_reason": UNSTATED, "voided_by_name": UNASSIGNED})

    dims = ["void_month", "case_type", "void_reason", "voided_by_name"]
    rows = [
        {
            "void_month": month,
            "brand": UNKNOWN_BRAND,
            "case_type": case_type,
            "void_reason": reason,
            "voided_by_name": by,
            "case_count": len(group),
            "age_at_void_days_mean": _mean(group["_age"]),
            "age_at_void_days_max": _maximum(group["_age"]),
        }
        for (month, case_type, reason, by), group in voided.groupby(dims, sort=True)
    ]
    return _finish(
        rows,
        CaseVoidMonthly,
        as_of=as_of,
        sort_by=("void_month", "brand", "case_type", "void_reason", "voided_by_name"),
    )


def case_intake(current: Dataset, *, as_of: str) -> Dataset:
    """How many Cases arrive each day, by the status they hold now."""
    frame = current.to_pandas()
    frame = frame.assign(
        intake_date=_local_day(_instants(frame["created"])), brand=UNKNOWN_BRAND
    )
    dims = ["intake_date", "brand", "case_type", "status"]
    rows = frame.groupby(dims, sort=True).size().reset_index(name="case_count")
    return _finish(rows, CaseIntakeDaily, as_of=as_of, sort_by=tuple(dims))


def case_lifecycle_duration(current: Dataset, *, as_of: str) -> Dataset:
    """How long each non-void Case's lifecycle legs take; backwards legs are
    counted, not measured."""
    frame = current.to_pandas()
    frame = _filled(
        frame.loc[frame["status"].ne("Void")], {"assigned_reviewer_name": UNASSIGNED}
    )
    dims = ["ended_month", "case_type", "assigned_reviewer_name"]
    parts = []
    for order, (leg, started, ended, actions_path_only) in enumerate(
        LIFECYCLE_LEGS, start=1
    ):
        legs = frame
        if actions_path_only:
            legs = legs.loc[_flagged(legs["had_remediation"])]
        legs = legs.assign(
            _started=_instants(legs[started]), _ended=_instants(legs[ended])
        )
        legs = legs.loc[legs["_started"].notna() & legs["_ended"].notna()]
        days = (legs["_ended"] - legs["_started"]).dt.total_seconds() / SECONDS_PER_DAY
        legs = legs.assign(
            ended_month=_month(legs["_ended"]), _days=days.where(days >= 0)
        )
        stats = _summaries(legs, dims, "_days")
        keys = stats.index.to_frame(index=False)
        parts.append(
            pd.DataFrame(
                {
                    "leg": leg,
                    "leg_order": order,
                    "ended_month": keys["ended_month"],
                    "brand": UNKNOWN_BRAND,
                    "case_type": keys["case_type"],
                    "assigned_reviewer_name": keys["assigned_reviewer_name"],
                    "case_count": stats["count"].to_numpy(),
                    "out_of_order_count": (stats["rows"] - stats["count"]).to_numpy(),
                    "days_total": [round(float(v), 3) for v in stats["total"]],
                    "days_mean": _rounded_all(stats["mean"]),
                    "days_p50": _rounded_all(stats["p50"]),
                    "days_p90": _rounded_all(stats["p90"]),
                    "days_max": _rounded_all(stats["max"]),
                }
            )
        )
    return _finish(
        pd.concat(parts, ignore_index=True),
        CaseLifecycleDurationMonthly,
        as_of=as_of,
        sort_by=(
            "leg_order",
            "ended_month",
            "brand",
            "case_type",
            "assigned_reviewer_name",
        ),
    )


def _reportable_cases(current: Dataset) -> pd.DataFrame:
    """The Check population: non-void Cases with a parseable ``reportable_at``."""
    frame = current.to_pandas()
    reportable = frame.loc[frame["status"].ne("Void")].copy()
    reportable["_reportable"] = _instants(reportable["reportable_at"])
    reportable = reportable.loc[reportable["_reportable"].notna()]
    reportable["reportable_month"] = _month(reportable["_reportable"])
    return _filled(reportable, {"assigned_reviewer_name": UNASSIGNED})


def case_outcome(current: Dataset, *, as_of: str) -> Dataset:
    """Reportable non-void Cases by month and ``effective_outcome``."""
    reportable = _filled(_reportable_cases(current), {"effective_outcome": UNSTATED})
    dims = [
        "reportable_month",
        "case_type",
        "assigned_reviewer_name",
        "effective_outcome",
    ]
    rows = (
        reportable.assign(
            _remediation=_flagged(reportable["effective_had_remediation"]),
            _overridden=_flagged(reportable["outcome_overridden"]),
        )
        .groupby(dims, sort=True)
        .agg(
            case_count=("_remediation", "size"),
            remediation_count=("_remediation", "sum"),
            overridden_count=("_overridden", "sum"),
        )
        .reset_index()
        .assign(brand=UNKNOWN_BRAND)
    )
    return _finish(
        rows,
        CaseOutcomeMonthly,
        as_of=as_of,
        sort_by=(
            "reportable_month",
            "brand",
            "case_type",
            "assigned_reviewer_name",
            "effective_outcome",
        ),
    )


def _due_bucket(days_until: int | None) -> tuple[str, int]:
    """A due date's bucket and the order it sorts in, soonest-breached first."""
    if days_until is None:
        return "no_due_date", 6
    if days_until < -7:
        return "overdue_8_plus", 1
    if days_until < 0:
        return "overdue_1_7", 2
    if days_until == 0:
        return "due_today", 3
    if days_until <= 7:
        return "due_1_7", 4
    return "due_8_plus", 5


def case_due_profile(current: Dataset, *, as_of: str) -> Dataset:
    """Open Cases by how far they are from their due date, per SLA clock."""
    today = local_date(as_of)
    frame = _filled(current.to_pandas(), {"assigned_reviewer_name": UNASSIGNED})
    rows = []
    for sla_kind, status, due_column in DUE_CLOCKS:
        on_clock = frame.loc[frame["status"].eq(status)]
        buckets = [
            _due_bucket(None if pd.isna(days) else days)
            for days in _days_until(on_clock[due_column], today)
        ]
        on_clock = on_clock.assign(
            due_bucket=[name for name, _ in buckets],
            due_bucket_order=[order for _, order in buckets],
        )
        dims = ["case_type", "assigned_reviewer_name", "due_bucket_order", "due_bucket"]
        for (case_type, reviewer, order, bucket), group in on_clock.groupby(
            dims, sort=True
        ):
            rows.append(
                {
                    "sla_kind": sla_kind,
                    "brand": UNKNOWN_BRAND,
                    "case_type": case_type,
                    "assigned_reviewer_name": reviewer,
                    "due_bucket": bucket,
                    "due_bucket_order": order,
                    "case_count": len(group),
                    "on_hold_count": int(_flagged(group["on_hold"]).sum()),
                }
            )
    return _finish(
        rows,
        CaseDueProfile,
        as_of=as_of,
        sort_by=(
            "sla_kind",
            "brand",
            "case_type",
            "assigned_reviewer_name",
            "due_bucket_order",
        ),
    )


def _days_over_bucket(days_over: int) -> tuple[str, int]:
    """How far past its Remediation Due Date a Case is, as a bucket."""
    if days_over <= 7:
        return "over_1_7", 1
    if days_over <= 14:
        return "over_8_14", 2
    if days_over <= 28:
        return "over_15_28", 3
    return "over_29_plus", 4


def remediation_overdue(
    current: Dataset, answers: Dataset, actions: Dataset, *, as_of: str
) -> Dataset:
    """Outstanding remediation on Cases past their Remediation Due Date."""
    today = local_date(as_of)
    cases = current.to_pandas()
    cases = cases.loc[cases["status"].eq("Actions In Progress")].copy()
    cases["_days_over"] = _days_until(cases["remediation_due_date"], today).mul(-1)
    cases = cases.loc[cases["_days_over"].notna() & cases["_days_over"].gt(0)]
    cases = _filled(
        cases,
        {"assigned_reviewer_name": UNASSIGNED, "responsible_party_name": UNASSIGNED},
    )
    buckets = [_days_over_bucket(int(days)) for days in cases["_days_over"]]
    cases = cases.assign(
        days_over_bucket=[name for name, _ in buckets],
        days_over_bucket_order=[order for _, order in buckets],
    )

    answer_rows = answers.to_pandas()
    outstanding = answer_rows.loc[
        answer_rows["remediation_required"].eq("yes")
        & answer_rows["remediation_status"].isna()
    ]
    per_case_answers = outstanding.groupby(CASE_ID_COLUMN).size()
    action_rows = actions.to_pandas().merge(
        outstanding[[CASE_ID_COLUMN, "question_id"]],
        on=[CASE_ID_COLUMN, "question_id"],
        how="inner",
    )
    per_case_actions = action_rows.groupby(CASE_ID_COLUMN).size()
    cases = cases.assign(
        _answers=cases[CASE_ID_COLUMN].map(per_case_answers).fillna(0),
        _actions=cases[CASE_ID_COLUMN].map(per_case_actions).fillna(0),
    )

    dims = [
        "case_type",
        "assigned_reviewer_name",
        "responsible_party_name",
        "days_over_bucket_order",
        "days_over_bucket",
    ]
    rows = [
        {
            "brand": UNKNOWN_BRAND,
            "case_type": case_type,
            "assigned_reviewer_name": reviewer,
            "responsible_party_name": party,
            "days_over_bucket": bucket,
            "days_over_bucket_order": order,
            "case_count": len(group),
            "outstanding_answer_count": int(group["_answers"].sum()),
            "outstanding_action_count": int(group["_actions"].sum()),
            "days_over_max": int(group["_days_over"].max()),
        }
        for (case_type, reviewer, party, order, bucket), group in cases.groupby(
            dims, sort=True
        )
    ]
    return _finish(
        rows,
        RemediationOverdue,
        as_of=as_of,
        sort_by=(
            "brand",
            "case_type",
            "assigned_reviewer_name",
            "responsible_party_name",
            "days_over_bucket_order",
        ),
    )


def _in_progress_since(history: Dataset) -> pd.DataFrame:
    """When each Case whose latest observation is ``In-progress`` last entered
    it -- after a reopen, the reopen, not the original claim."""
    frame = history.to_pandas()
    first = _case_starts(frame)
    last = first.shift(-1, fill_value=True)
    _, began = _stays(frame, first)
    latest = last & frame["status"].eq("In-progress")
    return frame.assign(_since=began).loc[latest, [*HISTORY_KEY, "_since"]]


def reviewer_workload(current: Dataset, history: Dataset, *, as_of: str) -> Dataset:
    """What each Reviewer holds, against their last 28 days' output.

    An ``In-progress`` Case's age runs from when the history last saw it enter
    that status, so a reopened Case's Completed spell is not counted; a Case
    the history has not seen there falls back to its ``assigned_at``.
    """
    today = local_date(as_of)
    frame = _filled(current.to_pandas(), {"assigned_reviewer_name": UNASSIGNED})
    frame = frame.merge(_in_progress_since(history), on=list(HISTORY_KEY), how="left")
    started = frame["_since"].where(
        frame["_since"].notna(), _instants(frame["assigned_at"])
    )
    in_progress = frame["status"].eq("In-progress")
    reportable = _days_since(frame["reportable_at"], today)
    frame = frame.assign(
        _in_progress=in_progress,
        _held=in_progress & _flagged(frame["on_hold"]),
        _actions=frame["status"].eq("Actions In Progress"),
        _recent=reportable.between(0, WORKLOAD_WINDOW_DAYS - 1)
        & frame["status"].ne("Void"),
        _age=_days_since(started.where(in_progress), today),
    )
    frame = frame.loc[frame["_in_progress"] | frame["_actions"] | frame["_recent"]]

    rows = []
    for (case_type, reviewer), group in frame.groupby(
        ["case_type", "assigned_reviewer_name"], sort=True
    ):
        held = int(group["_in_progress"].sum())
        output = int(group["_recent"].sum())
        weekly = output / (WORKLOAD_WINDOW_DAYS / 7)
        rows.append(
            {
                "brand": UNKNOWN_BRAND,
                "case_type": case_type,
                "assigned_reviewer_name": reviewer,
                "in_progress_count": held,
                "in_progress_on_hold_count": int(group["_held"].sum()),
                "actions_in_progress_count": int(group["_actions"].sum()),
                "oldest_in_progress_days": _maximum(pd.to_numeric(group["_age"])),
                "reportable_last_28_days_count": output,
                "weeks_of_work": round(held / weekly, 3) if output else None,
            }
        )
    return _finish(
        rows,
        ReviewerWorkload,
        as_of=as_of,
        sort_by=("brand", "case_type", "assigned_reviewer_name"),
    )


def appeal_rate_by_reviewer(
    current: Dataset, appeals: Dataset, *, as_of: str
) -> Dataset:
    """Appeals counted onto their Case's Reportable month and Reviewer."""
    cases = _reportable_cases(current)
    frame = appeals.to_pandas()
    per_case = (
        frame.assign(
            _open=frame["state"].ne("resolved"),
            _agreed=frame["resolution_verdict"].eq("agreed"),
            _rejected=frame["resolution_verdict"].eq("rejected"),
        )
        .groupby(CASE_ID_COLUMN)
        .agg(
            _appeals=("appeal_id", "size"),
            _open=("_open", "sum"),
            _agreed=("_agreed", "sum"),
            _rejected=("_rejected", "sum"),
        )
    )
    cases = cases.join(per_case, on=CASE_ID_COLUMN)
    counts = ["_appeals", "_open", "_agreed", "_rejected"]
    cases[counts] = cases[counts].fillna(0)

    dims = ["reportable_month", "case_type", "assigned_reviewer_name"]
    rows = (
        cases.assign(_appealed=cases["_appeals"].gt(0))
        .groupby(dims, sort=True)
        .agg(
            reportable_count=("_appeals", "size"),
            appealed_case_count=("_appealed", "sum"),
            appeal_count=("_appeals", "sum"),
            open_appeal_count=("_open", "sum"),
            agreed_appeal_count=("_agreed", "sum"),
            rejected_appeal_count=("_rejected", "sum"),
        )
        .reset_index()
        .assign(brand=UNKNOWN_BRAND)
    )
    return _finish(
        rows,
        AppealRateByReviewerMonthly,
        as_of=as_of,
        sort_by=("reportable_month", "brand", "case_type", "assigned_reviewer_name"),
    )


def answer_action_load(actions: Dataset, current: Dataset, *, as_of: str) -> Dataset:
    """Remediation Actions per question. **Grain: case_type x question_id.**

    Over the current non-void Cases only, so ``share_of_cases`` reads as "this
    share of the Case Type's live Cases carry an Action on this question".
    """
    live = _live_cases(current)
    live_counts = live.groupby("case_type").size()
    per_case = (
        _live_rows(actions, live)
        .groupby(["case_type", "question_id", CASE_ID_COLUMN], sort=True)
        .size()
        .reset_index(name="actions")
    )
    rows = []
    for (case_type, question_id), group in per_case.groupby(
        ["case_type", "question_id"], sort=True
    ):
        live_count = int(live_counts.get(case_type, 0))
        rows.append(
            {
                "case_type": case_type,
                "question_id": question_id,
                "case_count": len(group),
                "action_count": int(group["actions"].sum()),
                "actions_per_case_mean": round(float(group["actions"].mean()), 3),
                "actions_per_case_max": int(group["actions"].max()),
                "share_of_cases": round(len(group) / live_count, 4)
                if live_count
                else None,
            }
        )
    return _finish(
        rows, AnswerActionLoad, as_of=as_of, sort_by=("case_type", "question_id")
    )


def answer_remediation_by_manager(
    answers: Dataset, current: Dataset, *, as_of: str
) -> Dataset:
    """Remediation decisions and statuses under each Responsible Party
    Manager. **Grain: case_type x responsible_party_manager_name x
    remediation_required x remediation_status.**

    The Sync subject's ``answer_remediation_current`` has no people on it;
    this joins each Answer to its Case for the manager who answers for the
    remediation, and counts both Answers and the distinct Cases behind them.
    """
    cases = current.to_pandas()[[CASE_ID_COLUMN, "responsible_party_manager_name"]]
    frame = answers.to_pandas().merge(cases, on=CASE_ID_COLUMN, how="inner")
    frame = _filled(
        frame,
        {
            "responsible_party_manager_name": UNASSIGNED,
            "remediation_required": UNDECIDED,
            "remediation_status": UNRESOLVED,
        },
    )
    dims = [
        "case_type",
        "responsible_party_manager_name",
        "remediation_required",
        "remediation_status",
    ]
    rows = [
        {
            "case_type": case_type,
            "responsible_party_manager_name": manager,
            "remediation_required": required,
            "remediation_status": status,
            "answer_count": len(group),
            "case_count": group[CASE_ID_COLUMN].nunique(),
        }
        for (case_type, manager, required, status), group in frame.groupby(
            dims, sort=True
        )
    ]
    return _finish(rows, AnswerRemediationByManager, as_of=as_of, sort_by=tuple(dims))


def appeal_cycle_time(appeals: Dataset, *, as_of: str) -> Dataset:
    """How long Appeals take to resolve. **Grain: case_type x state x
    resolution_verdict.** Cycle days run from ``raised_at`` to
    ``resolution_at``, over the Appeals carrying both."""
    frame = appeals.to_pandas().copy()
    frame["_cycle"] = (
        (
            _instants(frame["resolution_at"]) - _instants(frame["raised_at"])
        ).dt.total_seconds()
        / SECONDS_PER_DAY
    ).clip(lower=0.0)
    frame = _filled(frame, {"state": UNSTATED, "resolution_verdict": UNRESOLVED})

    dims = ["case_type", "state", "resolution_verdict"]
    rows = [
        {
            "case_type": case_type,
            "state": state,
            "resolution_verdict": verdict,
            "appeal_count": len(group),
            "resolved_count": int(group["_cycle"].notna().sum()),
            "cycle_days_mean": _mean(group["_cycle"]),
            "cycle_days_p50": _quantile(group["_cycle"], 0.5),
            "cycle_days_p90": _quantile(group["_cycle"], 0.9),
            "cycle_days_max": _maximum(group["_cycle"]),
        }
        for (case_type, state, verdict), group in frame.groupby(dims, sort=True)
    ]
    return _finish(rows, AppealCycleTime, as_of=as_of, sort_by=tuple(dims))


def _cited_questions(value: object) -> list[str]:
    """The question ids an Appeal cites; a blob that is not a JSON list of
    strings cites nothing rather than aborting the table."""
    if not isinstance(value, str) or not value.strip():
        return []
    try:
        loaded = json.loads(value)
    except ValueError:
        return []
    if not isinstance(loaded, list):
        return []
    return [
        str(item)
        for item in loaded
        if isinstance(item, (str, int)) and not isinstance(item, bool)
    ]


def appeal_question_citations(appeals: Dataset, *, as_of: str) -> Dataset:
    """Which questions get appealed. **Grain: case_type x question_id.**"""
    frame = appeals.to_pandas()
    cited = (
        frame.assign(question_id=frame["cited_question_ids_json"].map(_cited_questions))
        .explode("question_id")
        .dropna(subset=["question_id"])
    )
    rows = [
        {
            "case_type": case_type,
            "question_id": question_id,
            "appeal_count": group["appeal_id"].nunique(),
            "case_count": group[CASE_ID_COLUMN].nunique(),
        }
        for (case_type, question_id), group in cited.groupby(
            ["case_type", "question_id"], sort=True
        )
    ]
    return _finish(
        rows, AppealQuestionCitation, as_of=as_of, sort_by=("case_type", "question_id")
    )


def conversation_response_time(
    messages: Dataset, current: Dataset, *, as_of: str
) -> Dataset:
    """How quickly Conversations are replied to. **Grain: brand x case_type.**

    Each Case's thread is read in ``seq`` order; a Message whose
    ``author_login`` differs from the previous Message's is a reply, and its
    hours are measured from that previous Message. Two consecutive Messages by
    one author are one turn, not a reply to oneself. Author-agnostic by design:
    the source's own ``awaiting_since`` already says who is being waited on
    right now. Over the Messages on live Cases, as the other Conversation
    tables count.
    """
    frame = _live_rows(messages, _live_cases(current)).copy()
    frame["_posted"] = _instants(frame["posted_at"])
    frame = frame.sort_values([CASE_ID_COLUMN, "seq"], kind="stable")

    threads = frame.groupby(CASE_ID_COLUMN, sort=False)
    previous_author = threads["author_login"].shift()
    previous_posted = threads["_posted"].shift()
    replies = frame.loc[
        threads.cumcount().gt(0)
        & frame["author_login"].ne(previous_author)
        & frame["_posted"].notna()
        & previous_posted.notna()
    ].copy()
    replies["hours"] = (
        (replies["_posted"] - previous_posted).dt.total_seconds() / SECONDS_PER_HOUR
    ).clip(lower=0.0)

    rows = [
        {
            "brand": UNKNOWN_BRAND,
            "case_type": case_type,
            "thread_count": group[CASE_ID_COLUMN].nunique(),
            "reply_count": len(group),
            "reply_hours_mean": _mean(group["hours"]),
            "reply_hours_p50": _quantile(group["hours"], 0.5),
            "reply_hours_p90": _quantile(group["hours"], 0.9),
            "reply_hours_max": _maximum(group["hours"]),
        }
        for case_type, group in replies.groupby("case_type", sort=True)
    ]
    return _finish(
        rows, ConversationResponseTime, as_of=as_of, sort_by=("brand", "case_type")
    )


def _live_cases(current: Dataset) -> pd.DataFrame:
    """The current non-void Cases: the population a Conversation belongs to."""
    cases = current.to_pandas()
    return cases.loc[cases["status"].ne("Void"), [CASE_ID_COLUMN, "case_type"]]


def conversation_volume(messages: Dataset, current: Dataset, *, as_of: str) -> Dataset:
    """How much Conversation Cases carry. **Grain: brand x case_type.**

    Counts over the current non-void Cases of each Case Type: how many have a
    thread at all, how many have none, and how the thread lengths are spread.
    A Message whose Case is not among those Cases is not counted -- the Case
    is void, or no longer current -- so ``message_count`` is the volume on the
    live population, not on the Detail Table.
    """
    live = _live_cases(current)
    per_thread = (
        _live_rows(messages, live).groupby(CASE_ID_COLUMN).size().rename("messages")
    )
    counted = live.join(per_thread, on=CASE_ID_COLUMN)

    rows = []
    for case_type, group in counted.groupby("case_type", sort=True):
        lengths = group["messages"].dropna()
        without = len(group) - len(lengths)
        rows.append(
            {
                "brand": UNKNOWN_BRAND,
                "case_type": case_type,
                "case_count": len(group),
                "thread_count": len(lengths),
                "no_conversation_count": without,
                "no_conversation_share": round(without / len(group), 4),
                "message_count": int(lengths.sum()),
                "messages_per_thread_mean": _mean(lengths),
                "messages_per_thread_p50": _quantile(lengths, 0.5),
                "messages_per_thread_p90": _quantile(lengths, 0.9),
                "messages_per_thread_max": _maximum(lengths),
            }
        )
    return _finish(
        rows, ConversationVolume, as_of=as_of, sort_by=("brand", "case_type")
    )


def _live_rows(rows: Dataset, live: pd.DataFrame) -> pd.DataFrame:
    """The Detail rows (Messages, Actions) whose Case is one of the live Cases."""
    frame = rows.to_pandas()
    return frame.loc[frame[CASE_ID_COLUMN].isin(live[CASE_ID_COLUMN])]


def conversation_posting_pattern(
    messages: Dataset, current: Dataset, *, as_of: str
) -> Dataset:
    """When Messages get posted. **Grain: brand x case_type x weekday_order x
    hour_of_day.**

    Every Case Type with at least one counted Message gets the full 7 x 24
    grid, so a quiet cell is a row holding 0 rather than a hole a chart would
    have to infer. Weekday and hour are on the *local* clock, the same zone
    the calendar dates are expressed in -- converted instant by instant, so a
    thread spanning a summer-time change files each Message under the hour it
    was actually posted at. A Message with no parseable ``posted_at`` is not
    counted.
    """
    posted = _live_rows(messages, _live_cases(current)).copy()
    posted["_posted"] = _instants(posted["posted_at"])
    posted = posted.loc[posted["_posted"].notna()]

    local = timestamps.local_wall_clock(posted["_posted"])
    posted["weekday_order"] = local.dt.dayofweek + 1  # ISO: 1 = Monday
    posted["hour_of_day"] = local.dt.hour
    counts = posted.groupby(["case_type", "weekday_order", "hour_of_day"]).size()

    rows = [
        {
            "brand": UNKNOWN_BRAND,
            "case_type": case_type,
            "weekday_order": order,
            "weekday": WEEKDAY_NAMES[order - 1],
            "hour_of_day": hour,
            "message_count": int(counts.get((case_type, order, hour), 0)),
        }
        for case_type in sorted(posted["case_type"].unique())
        for order in range(1, len(WEEKDAY_NAMES) + 1)
        for hour in range(24)
    ]
    return _finish(
        rows,
        ConversationPostingPattern,
        as_of=as_of,
        sort_by=("brand", "case_type", "weekday_order", "hour_of_day"),
    )


# --- distributions and trends -----------------------------------------------


def _percentiles(
    codes: np.ndarray, ascending: np.ndarray, groups: int
) -> dict[str, np.ndarray]:
    """n, p50, p90, p95 and max per group code in ``range(groups)``, the values
    given sorted by (code, value); a percentile over too few is NaN."""
    counts = np.bincount(codes, minlength=groups)
    starts = np.cumsum(counts) - counts
    stats = {
        name: _run_quantiles(ascending, starts, counts, q)
        for name, q in (("p50", 0.5), ("p90", 0.9), ("p95", 0.95), ("max", 1.0))
    }
    stats["p90"] = np.where(counts >= MIN_N_FOR_P90, stats["p90"], np.nan)
    stats["p95"] = np.where(counts >= MIN_N_FOR_P95, stats["p95"], np.nan)
    return {"n": counts, **stats}


def _with_all_case_types(frame: pd.DataFrame) -> pd.DataFrame:
    """``frame`` again under ``(all)``, so each measure is also taken over
    every Case Type together."""
    return pd.concat([frame, frame.assign(case_type=ALL_CASE_TYPES)], ignore_index=True)


def _grouped_percentiles(
    frame: pd.DataFrame, dims: list[str], value: str
) -> tuple[pd.DataFrame, dict[str, np.ndarray]]:
    """Each ``dims`` group (sorted) and ``_percentiles`` of its ``value``."""
    grouped = frame.groupby(dims, sort=True)
    keys = grouped.size().index.to_frame(index=False)
    codes = grouped.ngroup().to_numpy()
    values = frame[value].to_numpy(dtype="float64")
    order = np.lexsort((values, codes))
    return keys, _percentiles(codes[order], values[order], len(keys))


def _durations(current: Dataset, calendar: WorkingDayCalendar) -> pd.DataFrame:
    """One row per live Case per measure it has: its ``case_type``,
    ``measure``, the local day it ended (``_end_day``) and its ``_value``."""
    frame = current.to_pandas()
    live = frame.loc[frame["status"].ne("Void")]
    parts = []
    for measure, started, ended, actions_path_only in DURATION_LEGS:
        legs = (
            live.loc[_flagged(live["had_remediation"])] if actions_path_only else live
        )
        end = _instants(legs[ended])
        days = (end - _instants(legs[started])).dt.total_seconds() / SECONDS_PER_DAY
        # A leg that runs backwards is excluded, as the lifecycle table does.
        parts.append(
            pd.DataFrame({"case_type": legs["case_type"], "_end": end, "_value": days})
            .loc[days.ge(0)]
            .assign(measure=measure)
        )
    completed = live.loc[live["status"].eq("Completed")]
    done = _instants(completed["completed_at"])
    margin = _working_days_after(
        calendar, _local_days(_instants(completed["due_date"])), _local_days(done)
    )
    parts.append(
        pd.DataFrame(
            {"case_type": completed["case_type"], "_end": done, "_value": margin}
        )
        .loc[margin.notna()]
        .assign(measure=SLA_MARGIN_MEASURE)
    )
    measured = pd.concat(parts, ignore_index=True)
    measured = measured.loc[measured["_end"].notna()]
    return measured.assign(_end_day=_local_days(measured["_end"]))


# How many as-of days share one pass over the measurements near them.
DAYS_PER_PASS = 32


def case_duration_percentiles(
    current: Dataset, *, as_of: str, calendar: WorkingDayCalendar | None = None
) -> Dataset:
    """Trailing-window duration percentiles. **Grain: as_of_date x window_days
    x case_type x measure.**

    A row's window is the measurements whose end falls on a local date in
    ``(as_of_date - window_days, as_of_date]``. Rebuilt for every as-of date
    from the first completion to the snapshot's, so the table is its own
    backfill.
    """
    measured = _with_all_case_types(
        _durations(current, calendar or WorkingDayCalendar())
    )
    grouped = measured.groupby(["case_type", "measure"], sort=True)
    keys = grouped.size().index.to_frame(index=False)
    codes = grouped.ngroup().to_numpy()
    values = measured["_value"].to_numpy(dtype="float64")
    days = measured["_end_day"].to_numpy("datetime64[D]").astype("int64")
    order = np.lexsort((values, codes))
    codes, values, days = codes[order], values[order], days[order]

    today = int(np.datetime64(local_date(as_of), "D").astype("int64"))
    completed = measured.loc[measured["measure"].isin(COMPLETION_MEASURES), "_end_day"]
    first = (
        int(np.datetime64(completed.min(), "D").astype("int64"))
        if len(completed)
        else today + 1
    )
    widest = max(DURATION_WINDOWS)
    found: list[pd.DataFrame] = []
    for start in range(first, today + 1, DAYS_PER_PASS):
        stop = min(start + DAYS_PER_PASS - 1, today)
        # Within a pass, only what ended inside its widest window is looked at.
        near = (days > start - widest) & (days <= stop)
        near_codes, near_values, near_days = codes[near], values[near], days[near]
        for as_of_day in range(start, stop + 1):
            for window in DURATION_WINDOWS:
                inside = (near_days > as_of_day - window) & (near_days <= as_of_day)
                stats = _percentiles(near_codes[inside], near_values[inside], len(keys))
                some = stats["n"] > 0
                found.append(
                    pd.DataFrame(
                        {
                            "_day": as_of_day,
                            "window_days": window,
                            "_group": np.flatnonzero(some),
                            **{name: column[some] for name, column in stats.items()},
                        }
                    )
                )
    rows: pd.DataFrame | list = []
    if found:
        built = pd.concat(found, ignore_index=True)
        group = built["_group"].to_numpy()
        rows = built.assign(
            as_of_date=built["_day"].to_numpy().astype("datetime64[D]").astype(str),
            case_type=keys["case_type"].to_numpy()[group],
            measure=keys["measure"].to_numpy()[group],
            **{
                name: _rounded_all(built[name]) for name in ("p50", "p90", "p95", "max")
            },
        )
    return _finish(
        rows,
        CaseDurationPercentilesDaily,
        as_of=as_of,
        sort_by=("as_of_date", "window_days", "case_type", "measure"),
    )


def case_open_age(current: Dataset, *, as_of: str) -> Dataset:
    """How old what is open is, at the snapshot. **Grain: as_of_date x
    case_type x measure.** Days to ``as_of_utc``: an open Case's from
    ``created``; an awaited one's from ``awaiting_since``; an open Appeal's from
    ``appeal_raised_at``."""
    frame = current.to_pandas()
    live = frame.loc[frame["status"].ne("Void")]
    open_cases = live.loc[live["status"].isin(list(OPEN_AGE_BY_STATUS))]
    awaited = open_cases.loc[_flagged(open_cases["awaiting_responsible_party"])]
    appealed = live.loc[_flagged(live["has_open_appeal"])]
    started = pd.concat(
        [
            pd.DataFrame(
                {
                    "case_type": open_cases["case_type"],
                    "measure": open_cases["status"].map(OPEN_AGE_BY_STATUS),
                    "_start": _instants(open_cases["created"]),
                }
            ),
            pd.DataFrame(
                {
                    "case_type": awaited["case_type"],
                    "measure": "awaiting_responsible_party",
                    "_start": _instants(awaited["awaiting_since"]),
                }
            ),
            pd.DataFrame(
                {
                    "case_type": appealed["case_type"],
                    "measure": "open_appeal_age",
                    "_start": _instants(appealed["appeal_raised_at"]),
                }
            ),
        ],
        ignore_index=True,
    )
    started = started.loc[started["_start"].notna()]
    snapshot = pd.Series(_instants(as_of), index=started.index)
    ages = _with_all_case_types(
        started.assign(_age=_elapsed_days(started["_start"], snapshot))
    )
    keys, stats = _grouped_percentiles(ages, ["case_type", "measure"], "_age")
    rows = keys.assign(
        as_of_date=local_date(as_of).isoformat(),
        n=stats["n"],
        **{name: _rounded_all(stats[name]) for name in ("p50", "p90", "p95", "max")},
    )
    return _finish(
        rows,
        CaseOpenAgeDaily,
        as_of=as_of,
        sort_by=("as_of_date", "case_type", "measure"),
    )


def first_time_right(current: Dataset, appeals: Dataset, *, as_of: str) -> Dataset:
    """Reportable Cases right first time: never appealed, amended or
    overridden. **Grain: reportable_month x brand x case_type x
    assigned_reviewer_name.**"""
    cases = _reportable_cases(current)
    appealed = cases[CASE_ID_COLUMN].isin(appeals.to_pandas()[CASE_ID_COLUMN])
    amended = cases["amended_outcome_id"].notna() | cases["amended_at"].notna()
    right = ~appealed & ~amended & ~_flagged(cases["outcome_overridden"])
    dims = ["reportable_month", "case_type", "assigned_reviewer_name"]
    rows = (
        cases.assign(_right=right)
        .groupby(dims, sort=True)
        .agg(
            reportable_count=("_right", "size"),
            first_time_right_count=("_right", "sum"),
        )
        .reset_index()
    )
    rows = rows.assign(
        brand=UNKNOWN_BRAND,
        first_time_right_rate=[
            round(right / total, 4)
            for right, total in zip(
                rows["first_time_right_count"], rows["reportable_count"]
            )
        ],
    )
    return _finish(
        rows,
        CaseFirstTimeRightMonthly,
        as_of=as_of,
        sort_by=("reportable_month", "brand", "case_type", "assigned_reviewer_name"),
    )


def _iso_week(days: pd.Series) -> pd.Series:
    """``YYYY-Www`` of each local day's ISO week."""
    iso = days.dt.isocalendar()
    return iso["year"].astype(str) + "-W" + iso["week"].astype(str).str.zfill(2)


def reviewer_throughput(current: Dataset, *, as_of: str) -> Dataset:
    """Cases made Reportable per ISO week, and how they spread over the
    Reviewers who made them. **Grain: iso_week x brand x case_type.**"""
    cases = _reportable_cases(current)
    cases = _with_all_case_types(
        cases.assign(iso_week=_iso_week(_local_days(cases["_reportable"])))
    )
    dims = ["iso_week", "case_type"]
    totals = cases.groupby(dims, sort=True).size()
    per_reviewer = (
        cases.loc[cases["assigned_reviewer_name"].ne(UNASSIGNED)]
        .groupby([*dims, "assigned_reviewer_name"], sort=True)
        .size()
        .reset_index(name="_completions")
    )
    codes = totals.index.get_indexer(pd.MultiIndex.from_frame(per_reviewer[dims]))
    values = per_reviewer["_completions"].to_numpy(dtype="float64")
    order = np.lexsort((values, codes))
    stats = _percentiles(codes[order], values[order], len(totals))
    rows = totals.index.to_frame(index=False).assign(
        brand=UNKNOWN_BRAND,
        active_reviewer_count=stats["n"],
        completions_total=totals.to_numpy(),
        completions_per_reviewer_p50=_rounded_all(stats["p50"]),
        completions_per_reviewer_p90=_rounded_all(stats["p90"]),
        completions_per_reviewer_max=_rounded_all(stats["max"]),
    )
    return _finish(
        rows,
        ReviewerThroughputWeekly,
        as_of=as_of,
        sort_by=("iso_week", "brand", "case_type"),
    )


def reviewer_workload_daily(workload: Dataset, *, as_of: str) -> Dataset:
    """``reviewer_workload_current``'s rows under the snapshot's local date."""
    frame = workload.to_pandas().assign(as_of_date=local_date(as_of).isoformat())
    return _finish(
        frame,
        ReviewerWorkloadDaily,
        as_of=as_of,
        sort_by=("as_of_date", "brand", "case_type", "assigned_reviewer_name"),
    )
