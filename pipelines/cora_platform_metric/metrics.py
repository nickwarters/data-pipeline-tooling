"""The reductions behind the ``cora_platform_metric`` gold tables.

Each function takes the Sync datasets as read and returns one Aggregate table;
nothing here reads or writes. ``case_stage_dwell`` and ``case_hold`` reduce the
observation history and so measure what the polls saw -- a change reversed
between two polls was never observed. Every table is stamped with Sync's own
``as_of_utc`` and open intervals are measured to it, so a re-run over the same
snapshot gives the same numbers.

Each table declares its columns and their types together, in a ``*_COLUMNS``
mapping beside the reduction that fills it, and ``_finish`` builds the frame
from that mapping -- so an empty result still lands the shape the table's
``SchemaValidator`` gates.
"""

from __future__ import annotations

import datetime as dt
import json

import pandas as pd

from framework.core import Dataset
from tools.calendar import WorkingDayCalendar
from tools.observability import timestamps
from tools.observability.timestamps import local_date

from .schema import REMEDIATION_SLA, REVIEW_SLA

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
HOURS_OF_DAY = range(24)

SECONDS_PER_DAY = 86_400.0
SECONDS_PER_HOUR = 3_600.0

# The columns each reduction needs from what it is handed; the pipeline gates
# each source on the union for its consumers, and the failure message lands
# beside the code that depends on them.
HISTORY_COLUMNS = (
    *HISTORY_KEY,
    "source_modified_at",
    "source_observation_id",
    "status",
    "assigned_reviewer_name",
    "created",
    "assigned_at",
    "on_hold",
    "placed_on_hold_at",
)
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


def _instants(values: pd.Series) -> pd.Series:
    """Parse a column of ISO text (or datetimes) to UTC instants; bad -> NaT."""
    return pd.to_datetime(values, utc=True, errors="coerce", format="ISO8601")


def _instant(value: object) -> pd.Timestamp:
    """Parse one ISO text (or datetime) to a UTC instant; bad or absent -> NaT."""
    return pd.to_datetime(value, utc=True, errors="coerce", format="ISO8601")


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


def _finish(
    rows: list[dict[str, object]],
    columns: dict[str, str],
    *,
    as_of: str,
    sort_by: tuple[str, ...],
) -> Dataset:
    """Rows -> a stamped, sorted frame in the declared column order and types.

    The types come from the table's ``*_COLUMNS`` mapping, so an empty result
    still carries the declared shape: string dimensions, ``int64`` counts and
    ``float64`` statistics (NaN where a group had nothing to summarise).
    """
    frame = pd.DataFrame(rows, columns=list(columns))
    frame[AS_OF_COLUMN] = as_of
    for column, dtype in columns.items():
        frame[column] = frame[column].astype(dtype)
    ordered = frame.sort_values(list(sort_by), kind="stable").reset_index(drop=True)
    return Dataset.from_pandas(ordered)


def _ordered_history(dataset: Dataset) -> pd.DataFrame:
    """The observation history in the order things happened, per Case.

    Ordered by the source's own ``Modified`` instant, then the observation id
    as a deterministic last resort. Sync's current-state rule additionally
    breaks a same-second tie on the parsed version; a tie that fine changes
    which of two sub-second observations is credited, not any measure here.
    """
    frame = dataset.to_pandas().copy()
    frame["_modified"] = _instants(frame["source_modified_at"])
    return frame.sort_values(
        [*HISTORY_KEY, "_modified", "source_observation_id"], kind="stable"
    )


def _entry_instant(first: pd.Series) -> pd.Timestamp:
    """When a Case entered the status its *first* observation carries."""
    stamp_column = FIRST_OBSERVATION_ENTRY_STAMPS.get(first["status"])
    if stamp_column is None:
        return first["_modified"]
    stamped = _instant(first.get(stamp_column))
    if pd.notna(stamped) and stamped <= first["_modified"]:
        return stamped
    return first["_modified"]


# --- history metrics --------------------------------------------------------

DWELL_COLUMNS = {
    "brand": "string",
    "case_type": "string",
    "status": "string",
    "interval_count": "int64",
    "open_interval_count": "int64",
    "dwell_days_mean": "float64",
    "dwell_days_p50": "float64",
    "dwell_days_p90": "float64",
    "dwell_days_max": "float64",
    AS_OF_COLUMN: "string",
}


def case_stage_dwell(history: Dataset, current: Dataset) -> Dataset:
    """How long Cases dwell in each status. **Grain: brand x case_type x
    status.**

    Walks each Case's observations in order; every change of ``status`` closes
    an interval at that observation's ``Modified`` and opens the next. A Case's
    last interval is *open* unless its status is terminal. Statistics are over
    closed intervals only -- an open one has no length yet, and measuring it to
    ``as_of`` would mix two different questions (the Sync subject's age-bucket
    aggregates already answer "how long has it been waiting").
    """
    stays: list[dict[str, object]] = []
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
            days = (observation["_modified"] - entered).total_seconds()
            stays.append(
                {
                    "case_type": case_type,
                    "status": status,
                    "days": max(days / SECONDS_PER_DAY, 0.0),
                    "open": False,
                }
            )
            status = observation["status"]
            entered = observation["_modified"]
        if status not in TERMINAL_STATUSES:
            stays.append(
                {"case_type": case_type, "status": status, "days": None, "open": True}
            )

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
        rows,
        DWELL_COLUMNS,
        as_of=snapshot_as_of(current),
        sort_by=("brand", "case_type", "status"),
    )


HOLD_COLUMNS = {
    "brand": "string",
    "case_type": "string",
    "assigned_reviewer_name": "string",
    "case_count": "int64",
    "hold_count": "int64",
    "open_hold_count": "int64",
    "held_days_total": "float64",
    "held_days_mean": "float64",
    AS_OF_COLUMN: "string",
}


def case_hold(history: Dataset, current: Dataset) -> Dataset:
    """How often and how long Cases are held. **Grain: brand x case_type x
    assigned_reviewer_name.**

    A hold opens at the first observation carrying ``on_hold`` (from the
    source's ``placed_on_hold_at`` where it has one, else that observation's
    ``Modified``) and closes at the first later observation without it. A hold
    still open at the last observation is measured to ``as_of`` and counted in
    ``open_hold_count``. Attributed to the Reviewer the Case's latest
    observation names, so a reassigned Case's holds follow the Case.
    """
    as_of = snapshot_as_of(current)
    as_of_instant = pd.Timestamp(as_of)
    holds: list[dict[str, object]] = []
    for case, observations in _ordered_history(history).groupby(
        list(HISTORY_KEY), sort=False
    ):
        reviewer = observations.iloc[-1]["assigned_reviewer_name"]
        if pd.isna(reviewer) or not reviewer:
            reviewer = UNASSIGNED
        started = pd.NaT
        for _, observation in observations.iterrows():
            on_hold = (
                bool(observation["on_hold"])
                if pd.notna(observation["on_hold"])
                else False
            )
            if on_hold and pd.isna(started):
                stamped = _instant(observation["placed_on_hold_at"])
                started = stamped if pd.notna(stamped) else observation["_modified"]
            elif not on_hold and pd.notna(started):
                holds.append(
                    _hold(case, reviewer, started, observation["_modified"], False)
                )
                started = pd.NaT
        if pd.notna(started):
            holds.append(_hold(case, reviewer, started, as_of_instant, True))

    held = pd.DataFrame(
        holds, columns=["case", "case_type", "assigned_reviewer_name", "days", "open"]
    )
    rows = [
        {
            "brand": UNKNOWN_BRAND,
            "case_type": case_type,
            "assigned_reviewer_name": reviewer,
            "case_count": group["case"].nunique(),
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
        HOLD_COLUMNS,
        as_of=as_of,
        sort_by=("brand", "case_type", "assigned_reviewer_name"),
    )


def _hold(
    case: tuple[str, str],
    reviewer: str,
    started: pd.Timestamp,
    ended: pd.Timestamp,
    is_open: bool,
) -> dict[str, object]:
    """One hold, as the aggregation above counts it."""
    return {
        "case": case,
        "case_type": case[0],
        "assigned_reviewer_name": reviewer,
        "days": max((ended - started).total_seconds() / SECONDS_PER_DAY, 0.0),
        "open": is_open,
    }


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


SLA_COLUMNS = {
    "sla_kind": "string",
    "completed_month": "string",
    "brand": "string",
    "case_type": "string",
    "assigned_reviewer_manager_name": "string",
    "case_count": "int64",
    "on_time_count": "int64",
    "late_count": "int64",
    "no_due_date_count": "int64",
    "late_working_days_mean": "float64",
    "late_working_days_max": "float64",
    AS_OF_COLUMN: "string",
}

# Each SLA and the due-date column it judges ``completed_at`` against.
SLA_DUE_DATES = ((REVIEW_SLA, "due_date"), (REMEDIATION_SLA, "remediation_due_date"))


def sla_attainment(
    current: Dataset, *, calendar: WorkingDayCalendar | None = None
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
    as_of = snapshot_as_of(current)
    frame = current.to_pandas()
    completed = frame.loc[frame["status"].eq("Completed")].copy()
    completed["_completed"] = _instants(completed["completed_at"])
    completed = completed.loc[completed["_completed"].notna()]
    completed["completed_month"] = _month(completed["_completed"])
    completed = _filled(completed, {"assigned_reviewer_manager_name": UNASSIGNED})

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
        dims = ["completed_month", "case_type", "assigned_reviewer_manager_name"]
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
        SLA_COLUMNS,
        as_of=as_of,
        sort_by=(
            "sla_kind",
            "completed_month",
            "brand",
            "case_type",
            "assigned_reviewer_manager_name",
        ),
    )


VOID_COLUMNS = {
    "void_month": "string",
    "brand": "string",
    "case_type": "string",
    "void_reason": "string",
    "voided_by_name": "string",
    "case_count": "int64",
    "age_at_void_days_mean": "float64",
    "age_at_void_days_max": "float64",
    AS_OF_COLUMN: "string",
}


def void_monthly(current: Dataset) -> Dataset:
    """Voided Cases by reason and by whom. **Grain: void_month x brand x
    case_type x void_reason x voided_by_name.** Age at void is calendar days
    from ``created``."""
    as_of = snapshot_as_of(current)
    frame = current.to_pandas()
    voided = frame.loc[frame["status"].eq("Void")].copy()
    voided["_voided"] = _instants(voided["voided_at"])
    voided = voided.loc[voided["_voided"].notna()]
    voided["void_month"] = _month(voided["_voided"])
    voided["_age"] = (
        voided["_voided"] - _instants(voided["created"])
    ).dt.total_seconds() / SECONDS_PER_DAY
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
        VOID_COLUMNS,
        as_of=as_of,
        sort_by=("void_month", "brand", "case_type", "void_reason", "voided_by_name"),
    )


ACTION_LOAD_COLUMNS = {
    "case_type": "string",
    "question_id": "string",
    "case_count": "int64",
    "action_count": "int64",
    "actions_per_case_mean": "float64",
    "actions_per_case_max": "int64",
    "share_of_cases": "float64",
    AS_OF_COLUMN: "string",
}


def answer_action_load(actions: Dataset, current: Dataset) -> Dataset:
    """Remediation Actions per question. **Grain: case_type x question_id.**

    ``share_of_cases`` divides by the current non-void Cases of the Case Type,
    so it reads as "this share of the Case Type's live Cases carry an Action on
    this question".
    """
    as_of = snapshot_as_of(current)
    live = _live_cases(current)
    live_counts = live.groupby("case_type").size()
    per_case = (
        actions.to_pandas()
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
        rows, ACTION_LOAD_COLUMNS, as_of=as_of, sort_by=("case_type", "question_id")
    )


REMEDIATION_COLUMNS = {
    "case_type": "string",
    "responsible_party_manager_name": "string",
    "remediation_required": "string",
    "remediation_status": "string",
    "answer_count": "int64",
    "case_count": "int64",
    AS_OF_COLUMN: "string",
}


def answer_remediation_by_manager(answers: Dataset, current: Dataset) -> Dataset:
    """Remediation decisions and statuses under each Responsible Party
    Manager. **Grain: case_type x responsible_party_manager_name x
    remediation_required x remediation_status.**

    The Sync subject's ``answer_remediation_current`` has no people on it;
    this joins each Answer to its Case for the manager who answers for the
    remediation, and counts both Answers and the distinct Cases behind them.
    """
    as_of = snapshot_as_of(current)
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
            **dict(zip(dims, key)),
            "answer_count": len(group),
            "case_count": group[CASE_ID_COLUMN].nunique(),
        }
        for key, group in frame.groupby(dims, sort=True)
    ]
    return _finish(rows, REMEDIATION_COLUMNS, as_of=as_of, sort_by=tuple(dims))


APPEAL_CYCLE_COLUMNS = {
    "case_type": "string",
    "state": "string",
    "resolution_verdict": "string",
    "appeal_count": "int64",
    "resolved_count": "int64",
    "cycle_days_mean": "float64",
    "cycle_days_p50": "float64",
    "cycle_days_p90": "float64",
    "cycle_days_max": "float64",
    AS_OF_COLUMN: "string",
}


def appeal_cycle_time(appeals: Dataset, current: Dataset) -> Dataset:
    """How long Appeals take to resolve. **Grain: case_type x state x
    resolution_verdict.** Cycle days run from ``raised_at`` to
    ``resolution_at``, over the Appeals carrying both."""
    as_of = snapshot_as_of(current)
    frame = appeals.to_pandas().copy()
    frame["_cycle"] = (
        _instants(frame["resolution_at"]) - _instants(frame["raised_at"])
    ).dt.total_seconds() / SECONDS_PER_DAY
    frame = _filled(frame, {"state": UNSTATED, "resolution_verdict": UNRESOLVED})

    dims = ["case_type", "state", "resolution_verdict"]
    rows = [
        {
            **dict(zip(dims, key)),
            "appeal_count": len(group),
            "resolved_count": int(group["_cycle"].notna().sum()),
            "cycle_days_mean": _mean(group["_cycle"]),
            "cycle_days_p50": _quantile(group["_cycle"], 0.5),
            "cycle_days_p90": _quantile(group["_cycle"], 0.9),
            "cycle_days_max": _maximum(group["_cycle"]),
        }
        for key, group in frame.groupby(dims, sort=True)
    ]
    return _finish(rows, APPEAL_CYCLE_COLUMNS, as_of=as_of, sort_by=tuple(dims))


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
    return [str(item) for item in loaded if isinstance(item, (str, int))]


CITATION_COLUMNS = {
    "case_type": "string",
    "question_id": "string",
    "appeal_count": "int64",
    "case_count": "int64",
    AS_OF_COLUMN: "string",
}


def appeal_question_citations(appeals: Dataset, current: Dataset) -> Dataset:
    """Which questions get appealed. **Grain: case_type x question_id.**"""
    as_of = snapshot_as_of(current)
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
        rows, CITATION_COLUMNS, as_of=as_of, sort_by=("case_type", "question_id")
    )


RESPONSE_TIME_COLUMNS = {
    "brand": "string",
    "case_type": "string",
    "thread_count": "int64",
    "reply_count": "int64",
    "reply_hours_mean": "float64",
    "reply_hours_p50": "float64",
    "reply_hours_p90": "float64",
    "reply_hours_max": "float64",
    AS_OF_COLUMN: "string",
}


def conversation_response_time(messages: Dataset, current: Dataset) -> Dataset:
    """How quickly Conversations are replied to. **Grain: brand x case_type.**

    Each Case's thread is read in ``seq`` order; a Message whose
    ``author_login`` differs from the previous Message's is a reply, and its
    hours are measured from that previous Message. Two consecutive Messages by
    one author are one turn, not a reply to oneself. Author-agnostic by design:
    which *side* replied needs the bare-login-to-claims-login join the Sync
    subject refuses (see its data dictionary), and the source's own
    ``awaiting_since`` already says who is being waited on right now.
    """
    as_of = snapshot_as_of(current)
    frame = messages.to_pandas().copy()
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
        rows, RESPONSE_TIME_COLUMNS, as_of=as_of, sort_by=("brand", "case_type")
    )


def _live_cases(current: Dataset) -> pd.DataFrame:
    """The current non-void Cases: the population a Conversation belongs to."""
    cases = current.to_pandas()
    return cases.loc[cases["status"].ne("Void"), [CASE_ID_COLUMN, "case_type"]]


VOLUME_COLUMNS = {
    "brand": "string",
    "case_type": "string",
    "case_count": "int64",
    "thread_count": "int64",
    "no_conversation_count": "int64",
    "no_conversation_share": "float64",
    "message_count": "int64",
    "messages_per_thread_mean": "float64",
    "messages_per_thread_p50": "float64",
    "messages_per_thread_p90": "float64",
    "messages_per_thread_max": "float64",
    AS_OF_COLUMN: "string",
}


def conversation_volume(messages: Dataset, current: Dataset) -> Dataset:
    """How much Conversation Cases carry. **Grain: brand x case_type.**

    Counts over the current non-void Cases of each Case Type: how many have a
    thread at all, how many have none, and how the thread lengths are spread.
    A Message whose Case is not among those Cases is not counted -- the Case
    is void, or no longer current -- so ``message_count`` is the volume on the
    live population, not on the Detail Table.
    """
    as_of = snapshot_as_of(current)
    live = _live_cases(current)
    per_thread = (
        _live_messages(messages, live).groupby(CASE_ID_COLUMN).size().rename("messages")
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
    return _finish(rows, VOLUME_COLUMNS, as_of=as_of, sort_by=("brand", "case_type"))


def _live_messages(messages: Dataset, live: pd.DataFrame) -> pd.DataFrame:
    """The Messages whose Case is one of the live Cases."""
    frame = messages.to_pandas()
    return frame.loc[frame[CASE_ID_COLUMN].isin(live[CASE_ID_COLUMN])]


POSTING_PATTERN_COLUMNS = {
    "brand": "string",
    "case_type": "string",
    "weekday_order": "int64",
    "weekday": "string",
    "hour_of_day": "int64",
    "message_count": "int64",
    AS_OF_COLUMN: "string",
}


def conversation_posting_pattern(messages: Dataset, current: Dataset) -> Dataset:
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
    as_of = snapshot_as_of(current)
    posted = _live_messages(messages, _live_cases(current)).copy()
    posted["_posted"] = _instants(posted["posted_at"])
    posted = posted.loc[posted["_posted"].notna()]

    local = posted["_posted"].dt.tz_convert(timestamps.local_timezone())
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
        for hour in HOURS_OF_DAY
    ]
    return _finish(
        rows,
        POSTING_PATTERN_COLUMNS,
        as_of=as_of,
        sort_by=("brand", "case_type", "weekday_order", "hour_of_day"),
    )
