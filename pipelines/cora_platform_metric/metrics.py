"""The reductions behind the ``cora_platform_metric`` gold tables.

Each function takes the Sync datasets as read and returns one Aggregate table;
nothing here reads or writes. ``case_stage_dwell``, ``case_hold`` and
``case_backlog`` reduce the observation history and so measure what the polls
saw -- a change reversed between two polls was never observed. Every table is
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

import pandas as pd

from framework.core import Dataset
from tools.calendar import WorkingDayCalendar
from tools.observability import timestamps
from tools.observability.timestamps import local_date

from .schema import (
    REMEDIATION_SLA,
    REVIEW_SLA,
    AnswerActionLoad,
    AnswerRemediationByManager,
    AppealCycleTime,
    AppealQuestionCitation,
    AppealRateByReviewerMonthly,
    CaseBacklogDaily,
    CaseDueProfile,
    CaseHold,
    CaseIntakeDaily,
    CaseLifecycleDurationMonthly,
    CaseOutcomeMonthly,
    CaseSlaAttainmentMonthly,
    CaseStageDwell,
    CaseVoidMonthly,
    ConversationPostingPattern,
    ConversationResponseTime,
    ConversationVolume,
    RemediationOverdue,
    ReviewerWorkload,
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
HISTORY_COLUMNS = (
    *HISTORY_KEY,
    "source_modified_at",
    "source_version",
    "source_observation_id",
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


def _days(started: pd.Timestamp, ended: pd.Timestamp) -> float:
    """Days from one instant to another, never negative."""
    return max((ended - started).total_seconds() / SECONDS_PER_DAY, 0.0)


def _rounded(value: object) -> float | None:
    """A statistic as it is published; None where there was nothing to take."""
    return None if pd.isna(value) else round(float(value), 3)


def _mean(values: pd.Series) -> float | None:
    return _rounded(values.dropna().mean())


def _quantile(values: pd.Series, quantile: float) -> float | None:
    return _rounded(values.dropna().quantile(quantile))


def _maximum(values: pd.Series) -> float | None:
    return _rounded(values.dropna().max())


# What each declared type is held as while the table is being built.
PANDAS_DTYPES = {str: "string", int: "int64", float: "float64", bool: "bool"}


def _finish(
    rows: list[dict[str, object]],
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


def _ordered_history(dataset: Dataset) -> pd.DataFrame:
    """The observation history in the order things happened, per Case.

    Ordered by the source's own ``Modified`` instant, then ``source_version``
    as a number, since two versions can share a ``Modified`` and the later
    status must come last; then the observation id, a digest, as a
    deterministic last resort. An observation
    whose ``Modified`` does not parse has no place in that order and is dropped.
    """
    frame = dataset.to_pandas().copy()
    frame["_modified"] = _instants(frame["source_modified_at"])
    frame["_version"] = _version_number(frame["source_version"])
    return frame.loc[frame["_modified"].notna()].sort_values(
        [
            *HISTORY_KEY,
            "_modified",
            "_version",
            "source_observation_id",
        ],
        kind="stable",
    )


def _version_number(versions: pd.Series) -> pd.Series:
    """Each ``source_version`` -- a whole number in double quotes, ``'"10"'`` --
    as the number it sorts on.

    As text ``"10"`` sorts before ``"9"``. A version that is not a number (the
    digest the Reader stamps when the item carried none) sorts first, at -1,
    rather than as NA, which pandas would sort last.
    """
    number = pd.to_numeric(versions.astype("string").str.strip('"'), errors="coerce")
    return number.fillna(-1)


def _entry_instant(
    first: pd.Series, stamps: dict[str, str] = FIRST_OBSERVATION_ENTRY_STAMPS
) -> pd.Timestamp:
    """When a Case entered the status its *first* observation carries."""
    stamp_column = stamps.get(first["status"])
    if stamp_column is None:
        return first["_modified"]
    stamped = _instants(first.get(stamp_column))
    if pd.notna(stamped) and stamped <= first["_modified"]:
        return stamped
    return first["_modified"]


def _entry_instants(
    frame: pd.DataFrame, stamps: dict[str, str] = FIRST_OBSERVATION_ENTRY_STAMPS
) -> pd.Series:
    """``_entry_instant`` for every row, as though each were a first observation."""
    stamped = pd.Series(pd.NaT, index=frame.index, dtype=frame["_modified"].dtype)
    for status, column in stamps.items():
        stamped = stamped.where(frame["status"].ne(status), _instants(frame[column]))
    usable = stamped.notna() & stamped.le(frame["_modified"])
    return stamped.where(usable, frame["_modified"])


# --- history metrics --------------------------------------------------------


def case_stage_dwell(history: Dataset, *, as_of: str) -> Dataset:
    """How long Cases dwell in each status. **Grain: brand x case_type x
    status.**

    Walks each Case's observations in order; every change of ``status`` closes
    an interval at that observation's ``Modified`` and opens the next. A Case's
    last interval is *open* unless its status is terminal, and a terminal
    status left by a reopen closes no interval: that was the gap until the
    reopen, not a stage. Statistics are over closed intervals only -- an open
    one has no length yet, and measuring it to ``as_of`` would mix two
    different questions (the Sync subject's age-bucket aggregates already
    answer "how long has it been waiting").
    """
    stays = []  # one per stay in a status: (case_type, status, days, open)
    for _, observations in _ordered_history(history).groupby(
        list(HISTORY_KEY), sort=False
    ):
        first = observations.iloc[0]
        case_type = first["case_type"]
        status = first["status"]
        entered = _entry_instant(first)
        for _, observation in observations.iloc[1:].iterrows():
            if observation["status"] == status:
                continue
            if status not in TERMINAL_STATUSES:
                stays.append(
                    (case_type, status, _days(entered, observation["_modified"]), False)
                )
            status = observation["status"]
            entered = observation["_modified"]
        if status not in TERMINAL_STATUSES:
            stays.append((case_type, status, None, True))

    frame = pd.DataFrame(stays, columns=["case_type", "status", "days", "open"])
    frame["days"] = pd.to_numeric(frame["days"])
    rows = []
    for (case_type, status), group in frame.groupby(["case_type", "status"], sort=True):
        closed = group.loc[~group["open"].astype(bool), "days"]
        rows.append(
            {
                "brand": UNKNOWN_BRAND,
                "case_type": case_type,
                "status": status,
                "interval_count": len(closed),
                "open_interval_count": len(group) - len(closed),
                "dwell_days_mean": _mean(closed),
                "dwell_days_p50": _quantile(closed, 0.5),
                "dwell_days_p90": _quantile(closed, 0.9),
                "dwell_days_max": _maximum(closed),
            }
        )
    return _finish(
        rows, CaseStageDwell, as_of=as_of, sort_by=("brand", "case_type", "status")
    )


def case_hold(history: Dataset, *, as_of: str) -> Dataset:
    """How often and how long Cases are held. **Grain: brand x case_type x
    assigned_reviewer_name.**

    A hold opens at the first open-status observation carrying ``on_hold``
    (from the source's ``placed_on_hold_at`` where it has one, else that
    observation's ``Modified``) and closes at the first later observation
    without it, or at the observation where the Case entered ``Completed`` or
    ``Void`` if that comes first. Terminal spells are not held time, as they are
    not a stage in ``case_stage_dwell``: a flag first seen on a terminal
    observation opens nothing, and a flag still set when the Case is reopened
    opens a new hold from the reopen (never from a ``placed_on_hold_at`` before
    it). A hold still open at the last observation is measured to ``as_of`` and
    counted in ``open_hold_count``. Attributed to the Reviewer the Case's latest
    observation names, so a reassigned Case's holds follow the Case.
    """
    as_of_instant = pd.Timestamp(as_of)
    holds = []  # one per hold: (case_type, source_item_id, reviewer, days, open)
    for (case_type, item), observations in _ordered_history(history).groupby(
        list(HISTORY_KEY), sort=False
    ):
        reviewer = observations.iloc[-1]["assigned_reviewer_name"]
        if pd.isna(reviewer) or not reviewer:
            reviewer = UNASSIGNED
        started = pd.NaT  # the open hold's start, if one is open
        terminal = False
        reopened = pd.NaT  # the latest return from a terminal status
        for _, observation in observations.iterrows():
            modified = observation["_modified"]
            if observation["status"] in TERMINAL_STATUSES:
                if pd.notna(started):  # entering a terminal status ends the hold
                    holds.append(
                        (case_type, item, reviewer, _days(started, modified), False)
                    )
                    started = pd.NaT
                terminal = True
                continue
            if terminal:
                terminal, reopened = False, modified
            on_hold = pd.notna(observation["on_hold"]) and bool(observation["on_hold"])
            if on_hold and pd.isna(started):
                stamped = _instants(observation["placed_on_hold_at"])
                started = stamped if pd.notna(stamped) else modified
                if pd.notna(reopened) and started < reopened:
                    started = reopened
            elif not on_hold and pd.notna(started):
                holds.append(
                    (case_type, item, reviewer, _days(started, modified), False)
                )
                started = pd.NaT
        if pd.notna(started):
            holds.append(
                (case_type, item, reviewer, _days(started, as_of_instant), True)
            )

    held = pd.DataFrame(
        holds,
        columns=[
            "case_type",
            "source_item_id",
            "assigned_reviewer_name",
            "days",
            "open",
        ],
    )
    rows = [
        {
            "brand": UNKNOWN_BRAND,
            "case_type": case_type,
            "assigned_reviewer_name": reviewer,
            "case_count": group["source_item_id"].nunique(),
            "hold_count": len(group),
            "open_hold_count": int(group["open"].sum()),
            "held_days_total": round(float(group["days"].sum()), 3),
            "held_days_mean": round(float(group["days"].mean()), 3),
        }
        for (case_type, reviewer), group in held.groupby(
            ["case_type", "assigned_reviewer_name"], sort=True
        )
    ]
    return _finish(
        rows,
        CaseHold,
        as_of=as_of,
        sort_by=("brand", "case_type", "assigned_reviewer_name"),
    )


def _open_spans(
    observations: pd.DataFrame, as_of_day: dt.date
) -> list[tuple[str, dt.date, dt.date]]:
    """One Case's open time as ``(status, first_day, end_day)`` spans, end exclusive."""
    first = observations.iloc[0]
    entered = _entry_instant(first, BACKLOG_ENTRY_STAMPS)
    opened = _instants(first["created"])
    changes = []  # (instant, status), in the order they happened
    if pd.notna(opened) and opened < entered:
        changes.append((opened, UNOBSERVED))
    changes.append((entered, first["status"]))
    for _, observation in observations.iloc[1:].iterrows():
        if observation["status"] != changes[-1][1]:
            changes.append((observation["_modified"], observation["status"]))

    closing = {}  # local day -> the status the Case closed that day in
    for instant, status in changes:
        closing[local_date(instant)] = status
    days = sorted(day for day in closing if day <= as_of_day)
    ends = [*days[1:], as_of_day + dt.timedelta(days=1)]
    return [
        (closing[day], day, end)
        for day, end in zip(days, ends)
        if closing[day] not in TERMINAL_STATUSES
    ]


def case_backlog(history: Dataset, *, as_of: str) -> Dataset:
    """Open Cases at each day's close, by status, rebuilt from the history."""
    as_of_day = local_date(as_of)
    spans = []  # (case_type, status, first_day, end_day)
    for (case_type, _), observations in _ordered_history(history).groupby(
        list(HISTORY_KEY), sort=False
    ):
        spans.extend(
            (case_type, status, start, end)
            for status, start, end in _open_spans(observations, as_of_day)
        )

    rows = []
    frame = pd.DataFrame(spans, columns=["case_type", "status", "start", "end"])
    for case_type, group in frame.groupby("case_type", sort=True):
        first_day = group["start"].min()
        days = [
            first_day + dt.timedelta(days=offset)
            for offset in range((as_of_day - first_day).days + 1)
        ]
        for status in sorted({*OPEN_STATUSES, *group["status"]}):
            of_status = group.loc[group["status"].eq(status)]
            change = {}  # day -> how many Cases entered (+) or left (-) it
            for start, end in zip(of_status["start"], of_status["end"]):
                change[start] = change.get(start, 0) + 1
                change[end] = change.get(end, 0) - 1
            open_count = 0
            for day in days:
                open_count += change.get(day, 0)
                rows.append(
                    {
                        "backlog_date": day.isoformat(),
                        "brand": UNKNOWN_BRAND,
                        "case_type": case_type,
                        "status": status,
                        "case_count": open_count,
                    }
                )
    return _finish(
        rows,
        CaseBacklogDaily,
        as_of=as_of,
        sort_by=("backlog_date", "brand", "case_type", "status"),
    )


# --- current metrics --------------------------------------------------------


def _month(instants: pd.Series) -> pd.Series:
    """``YYYY-MM`` of each instant's local date; None where there is no instant."""
    return instants.map(
        lambda v: None if pd.isna(v) else local_date(v).strftime("%Y-%m")
    )


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
    ``Completed`` transition is after its Actions close. Days late are working
    days after the due date's local date, on the calendar the run was given
    (weekends-only when none).
    """
    calendar = calendar or WorkingDayCalendar()
    frame = current.to_pandas()
    completed = frame.loc[frame["status"].eq("Completed")].copy()
    completed["_completed"] = _instants(completed["completed_at"])
    completed = completed.loc[completed["_completed"].notna()]
    completed["completed_month"] = _month(completed["_completed"])
    completed = _filled(completed, {"assigned_reviewer_manager_name": UNASSIGNED})

    dims = ["completed_month", "case_type", "assigned_reviewer_manager_name"]
    rows = []
    for sla_kind, due_column in SLA_DUE_DATES:
        judged = completed.copy()
        judged["_due"] = _instants(judged[due_column])
        if sla_kind == REMEDIATION_SLA:
            judged = judged.loc[judged["_due"].notna()]
        judged["_late"] = [
            None
            if pd.isna(due)
            else working_days_late(calendar, local_date(due), local_date(done))
            for due, done in zip(judged["_due"], judged["_completed"])
        ]
        for (month, case_type, manager), group in judged.groupby(dims, sort=True):
            late = pd.to_numeric(group["_late"])
            overdue = late[late > 0]
            rows.append(
                {
                    "sla_kind": sla_kind,
                    "completed_month": month,
                    "brand": UNKNOWN_BRAND,
                    "case_type": case_type,
                    "assigned_reviewer_manager_name": manager,
                    "case_count": len(group),
                    "on_time_count": int((late == 0).sum()),
                    "late_count": len(overdue),
                    "no_due_date_count": int(late.isna().sum()),
                    "late_working_days_mean": _mean(overdue),
                    "late_working_days_max": _maximum(overdue),
                }
            )
    return _finish(
        rows,
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


def _local_day(instants: pd.Series) -> list[str]:
    """``YYYY-MM-DD`` of each instant's local date; ``(unstamped)`` where none."""
    return [
        UNSTAMPED if pd.isna(instant) else local_date(instant).isoformat()
        for instant in instants
    ]


def _flagged(values: pd.Series) -> pd.Series:
    """A source flag as True/False, NULL reading as not set."""
    return values.map(lambda value: pd.notna(value) and bool(value))


def case_intake(current: Dataset, *, as_of: str) -> Dataset:
    """How many Cases arrive each day, by the status they hold now."""
    frame = current.to_pandas()
    frame = frame.assign(
        intake_date=_local_day(_instants(frame["created"])), brand=UNKNOWN_BRAND
    )
    dims = ["intake_date", "brand", "case_type", "status"]
    rows = [
        dict(zip(dims, keys), case_count=len(group))
        for keys, group in frame.groupby(dims, sort=True)
    ]
    return _finish(rows, CaseIntakeDaily, as_of=as_of, sort_by=tuple(dims))


def case_lifecycle_duration(current: Dataset, *, as_of: str) -> Dataset:
    """How long each non-void Case's lifecycle legs take; backwards legs are
    counted, not measured."""
    frame = current.to_pandas()
    frame = _filled(
        frame.loc[frame["status"].ne("Void")], {"assigned_reviewer_name": UNASSIGNED}
    )
    rows = []
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
        legs = legs.assign(
            ended_month=_month(legs["_ended"]),
            _days=(legs["_ended"] - legs["_started"]).dt.total_seconds()
            / SECONDS_PER_DAY,
        )
        for (month, case_type, reviewer), group in legs.groupby(
            ["ended_month", "case_type", "assigned_reviewer_name"], sort=True
        ):
            days = group.loc[group["_days"].ge(0), "_days"]
            rows.append(
                {
                    "leg": leg,
                    "leg_order": order,
                    "ended_month": month,
                    "brand": UNKNOWN_BRAND,
                    "case_type": case_type,
                    "assigned_reviewer_name": reviewer,
                    "case_count": len(days),
                    "out_of_order_count": len(group) - len(days),
                    "days_total": round(float(days.sum()), 3),
                    "days_mean": _mean(days),
                    "days_p50": _quantile(days, 0.5),
                    "days_p90": _quantile(days, 0.9),
                    "days_max": _maximum(days),
                }
            )
    return _finish(
        rows,
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
    rows = [
        {
            "reportable_month": month,
            "brand": UNKNOWN_BRAND,
            "case_type": case_type,
            "assigned_reviewer_name": reviewer,
            "effective_outcome": outcome,
            "case_count": len(group),
            "remediation_count": int(
                _flagged(group["effective_had_remediation"]).sum()
            ),
            "overridden_count": int(_flagged(group["outcome_overridden"]).sum()),
        }
        for (month, case_type, reviewer, outcome), group in reportable.groupby(
            dims, sort=True
        )
    ]
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


def _days_until(stamps: pd.Series, today: dt.date) -> list[int | None]:
    """Local calendar days from ``today`` to each stamp; negative once passed."""
    return [
        None if pd.isna(stamp) else (local_date(stamp) - today).days
        for stamp in _instants(stamps)
    ]


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
            _due_bucket(days) for days in _days_until(on_clock[due_column], today)
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
    days_until = _days_until(cases["remediation_due_date"], today)
    cases["_days_over"] = pd.to_numeric(
        pd.Series(days_until, index=cases.index, dtype="object")
    ).mul(-1)
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
    frame = _ordered_history(history)
    cases = frame.groupby(list(HISTORY_KEY), sort=False)
    first = cases.cumcount().eq(0)
    entered = frame["status"].ne(cases["status"].shift())
    starts = frame["_modified"].where(entered & ~first, _entry_instants(frame))
    frame = frame.assign(_since=starts.where(entered).groupby(cases.ngroup()).ffill())
    latest = frame.groupby(list(HISTORY_KEY), sort=False).tail(1)
    return latest.loc[latest["status"].eq("In-progress"), [*HISTORY_KEY, "_since"]]


def reviewer_workload(current: Dataset, history: Dataset, *, as_of: str) -> Dataset:
    """What each Reviewer holds, against their last 28 days' output.

    An ``In-progress`` Case's age runs from when the history last saw it enter
    that status, so a reopened Case's Completed spell is not counted; a Case
    the history has not seen there falls back to its ``assigned_at``.
    """
    today = local_date(as_of)
    window_start = today - dt.timedelta(days=WORKLOAD_WINDOW_DAYS - 1)
    frame = _filled(current.to_pandas(), {"assigned_reviewer_name": UNASSIGNED})
    frame = frame.merge(_in_progress_since(history), on=list(HISTORY_KEY), how="left")
    started = frame["_since"].where(
        frame["_since"].notna(), _instants(frame["assigned_at"])
    )
    in_progress = frame["status"].eq("In-progress")
    reportable = _instants(frame["reportable_at"])
    recent = [
        pd.notna(stamp) and window_start <= local_date(stamp) <= today
        for stamp in reportable
    ]
    frame = frame.assign(
        _in_progress=in_progress,
        _held=in_progress & _flagged(frame["on_hold"]),
        _actions=frame["status"].eq("Actions In Progress"),
        _recent=pd.Series(recent, index=frame.index) & frame["status"].ne("Void"),
        _age=[
            None if days is None else -days
            for days in _days_until(started.where(in_progress), today)
        ],
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
    rows = [
        {
            "reportable_month": month,
            "brand": UNKNOWN_BRAND,
            "case_type": case_type,
            "assigned_reviewer_name": reviewer,
            "reportable_count": len(group),
            "appealed_case_count": int(group["_appeals"].gt(0).sum()),
            "appeal_count": int(group["_appeals"].sum()),
            "open_appeal_count": int(group["_open"].sum()),
            "agreed_appeal_count": int(group["_agreed"].sum()),
            "rejected_appeal_count": int(group["_rejected"].sum()),
        }
        for (month, case_type, reviewer), group in cases.groupby(dims, sort=True)
    ]
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
