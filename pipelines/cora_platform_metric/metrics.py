"""The reductions behind the ``cora_platform_metric`` gold tables.

Each function takes the Sync datasets as read and returns one Aggregate table;
nothing here reads or writes. ``case_stage_dwell`` and ``case_hold`` reduce the
observation history and so measure what the polls saw -- a change reversed
between two polls was never observed. Every table is stamped with Sync's own
``as_of_utc`` and open intervals are measured to it, so a re-run over the same
snapshot gives the same numbers.
"""

from __future__ import annotations

import datetime as dt
import json
from typing import Sequence

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

# How ``_finish`` types a measure column: counts are ``int64``, statistics are
# ``float64``, and everything else is a string dimension. Named here so the
# rule is one place rather than a suffix guess per table.
STATISTIC_SUFFIXES = ("_mean", "_p50", "_p90", "_max", "_total")
INT_MEASURES = frozenset({"actions_per_case_max", "weekday_order", "hour_of_day"})
FLOAT_MEASURES = frozenset({"share_of_cases", "no_conversation_share"})

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


def _filled(frame: pd.DataFrame, fills: dict[str, str]) -> pd.DataFrame:
    """``.where``, not ``fillna``: an all-null float64 column must land as
    object holding the literal, not stay float64 with the literal coerced."""
    return frame.assign(
        **{
            column: frame[column].where(frame[column].notna(), literal)
            for column, literal in fills.items()
        }
    )


def _stats(values: pd.Series, prefix: str) -> dict[str, float | None]:
    """Mean / p50 / p90 / max of ``values`` as ``<prefix>_<stat>``; None when
    there is nothing to summarise."""
    clean = values.dropna()
    if clean.empty:
        return {f"{prefix}_{s}": None for s in ("mean", "p50", "p90", "max")}
    return {
        f"{prefix}_mean": round(float(clean.mean()), 3),
        f"{prefix}_p50": round(float(clean.quantile(0.5)), 3),
        f"{prefix}_p90": round(float(clean.quantile(0.9)), 3),
        f"{prefix}_max": round(float(clean.max()), 3),
    }


def _finish(
    rows: list[dict[str, object]],
    columns: Sequence[str],
    *,
    as_of: str,
    sort_by: Sequence[str],
) -> Dataset:
    """Rows -> a stamped, sorted, typed frame in the declared column order.

    Typing is explicit so an empty result still carries the declared shape:
    string dimensions land as ``string``, counts as ``int64`` and statistics as
    ``float64`` (NaN where a group had nothing to summarise).
    """
    frame = pd.DataFrame(rows, columns=list(columns))
    frame[AS_OF_COLUMN] = as_of
    for column in columns:
        if column in INT_MEASURES or column.endswith("_count"):
            frame[column] = frame[column].astype("int64")
        elif column in FLOAT_MEASURES or column.endswith(STATISTIC_SUFFIXES):
            frame[column] = pd.to_numeric(frame[column]).astype("float64")
        else:
            frame[column] = frame[column].astype("string")
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
    if stamp_column is not None:
        stamped = _instants(pd.Series([first.get(stamp_column)])).iloc[0]
        if pd.notna(stamped) and stamped <= first["_modified"]:
            return stamped
    return first["_modified"]


# --- history metrics --------------------------------------------------------


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
    frame = _ordered_history(history)
    closed: list[tuple[str, str, float]] = []
    open_: list[tuple[str, str]] = []
    for _, observations in frame.groupby(list(HISTORY_KEY), sort=False):
        first = observations.iloc[0]
        case_type = first["case_type"]
        status = first["status"]
        entered = _entry_instant(first)
        for _, observation in observations.iloc[1:].iterrows():
            if observation["status"] == status:
                continue
            days = (
                observation["_modified"] - entered
            ).total_seconds() / SECONDS_PER_DAY
            closed.append((case_type, status, max(days, 0.0)))
            status = observation["status"]
            entered = observation["_modified"]
        if status not in TERMINAL_STATUSES:
            open_.append((case_type, status))

    closed_frame = pd.DataFrame(closed, columns=["case_type", "status", "days"])
    open_frame = pd.DataFrame(open_, columns=["case_type", "status"])
    keys = pd.concat(
        [closed_frame[["case_type", "status"]], open_frame], ignore_index=True
    ).drop_duplicates()
    rows = []
    for _, key in keys.iterrows():
        mask_closed = (closed_frame["case_type"] == key["case_type"]) & (
            closed_frame["status"] == key["status"]
        )
        mask_open = (open_frame["case_type"] == key["case_type"]) & (
            open_frame["status"] == key["status"]
        )
        rows.append(
            {
                "brand": UNKNOWN_BRAND,
                "case_type": key["case_type"],
                "status": key["status"],
                "interval_count": int(mask_closed.sum()),
                "open_interval_count": int(mask_open.sum()),
                **_stats(closed_frame.loc[mask_closed, "days"], "dwell_days"),
            }
        )
    return _finish(
        rows,
        (
            "brand",
            "case_type",
            "status",
            "interval_count",
            "open_interval_count",
            "dwell_days_mean",
            "dwell_days_p50",
            "dwell_days_p90",
            "dwell_days_max",
            AS_OF_COLUMN,
        ),
        as_of=snapshot_as_of(current),
        sort_by=("brand", "case_type", "status"),
    )


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
    frame = _ordered_history(history)
    holds: list[dict[str, object]] = []
    for key, observations in frame.groupby(list(HISTORY_KEY), sort=False):
        holding = False
        started: pd.Timestamp | None = None
        for _, observation in observations.iterrows():
            on_hold = (
                bool(observation["on_hold"])
                if pd.notna(observation["on_hold"])
                else False
            )
            if on_hold and not holding:
                stamped = _instants(pd.Series([observation["placed_on_hold_at"]])).iloc[
                    0
                ]
                started = stamped if pd.notna(stamped) else observation["_modified"]
                holding = True
            elif not on_hold and holding:
                holds.append(
                    _hold_row(
                        key, observations, started, observation["_modified"], False
                    )
                )
                holding = False
        if holding:
            holds.append(_hold_row(key, observations, started, as_of_instant, True))

    columns = (
        "brand",
        "case_type",
        "assigned_reviewer_name",
        "case_count",
        "hold_count",
        "open_hold_count",
        "held_days_total",
        "held_days_mean",
        AS_OF_COLUMN,
    )
    if not holds:
        return _finish([], columns, as_of=as_of, sort_by=columns[:3])
    held = pd.DataFrame(holds)
    grouped = held.groupby(["case_type", "assigned_reviewer_name"], sort=True)
    rows = [
        {
            "brand": UNKNOWN_BRAND,
            "case_type": case_type,
            "assigned_reviewer_name": reviewer,
            "case_count": int(group["case"].nunique()),
            "hold_count": int(len(group)),
            "open_hold_count": int(group["open"].sum()),
            "held_days_total": round(float(group["days"].sum()), 3),
            "held_days_mean": round(float(group["days"].mean()), 3),
        }
        for (case_type, reviewer), group in grouped
    ]
    return _finish(rows, columns, as_of=as_of, sort_by=columns[:3])


def _hold_row(key, observations, started, ended, is_open) -> dict[str, object]:
    reviewer = observations.iloc[-1]["assigned_reviewer_name"]
    return {
        "case": key,
        "case_type": key[0],
        "assigned_reviewer_name": reviewer
        if pd.notna(reviewer) and reviewer
        else UNASSIGNED,
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
    for sla_kind, due_column in (
        (REVIEW_SLA, "due_date"),
        (REMEDIATION_SLA, "remediation_due_date"),
    ):
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
            late = pd.to_numeric(group["_late"], errors="coerce")
            rows.append(
                {
                    "sla_kind": sla_kind,
                    "completed_month": month,
                    "brand": UNKNOWN_BRAND,
                    "case_type": case_type,
                    "assigned_reviewer_manager_name": manager,
                    "case_count": int(len(group)),
                    "on_time_count": int((late == 0).sum()),
                    "late_count": int((late > 0).sum()),
                    "no_due_date_count": int(late.isna().sum()),
                    **{
                        k: v
                        for k, v in _stats(late[late > 0], "late_working_days").items()
                        if k.endswith(("_mean", "_max"))
                    },
                }
            )
    columns = (
        "sla_kind",
        "completed_month",
        "brand",
        "case_type",
        "assigned_reviewer_manager_name",
        "case_count",
        "on_time_count",
        "late_count",
        "no_due_date_count",
        "late_working_days_mean",
        "late_working_days_max",
        AS_OF_COLUMN,
    )
    return _finish(rows, columns, as_of=as_of, sort_by=columns[:5])


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
            "case_count": int(len(group)),
            **{
                k: v
                for k, v in _stats(group["_age"], "age_at_void_days").items()
                if k.endswith(("_mean", "_max"))
            },
        }
        for (month, case_type, reason, by), group in voided.groupby(dims, sort=True)
    ]
    columns = (
        "void_month",
        "brand",
        "case_type",
        "void_reason",
        "voided_by_name",
        "case_count",
        "age_at_void_days_mean",
        "age_at_void_days_max",
        AS_OF_COLUMN,
    )
    return _finish(rows, columns, as_of=as_of, sort_by=columns[:5])


def answer_action_load(actions: Dataset, current: Dataset) -> Dataset:
    """Remediation Actions per question. **Grain: case_type x question_id.**

    ``share_of_cases`` divides by the current non-void Cases of the Case Type,
    so it reads as "this share of the Case Type's live Cases carry an Action on
    this question".
    """
    as_of = snapshot_as_of(current)
    cases = current.to_pandas()
    denominators = cases.loc[cases["status"].ne("Void")].groupby("case_type").size()
    frame = actions.to_pandas()
    per_case = (
        frame.groupby(["case_type", "question_id", CASE_ID_COLUMN], sort=True)
        .size()
        .reset_index(name="actions")
    )
    rows = []
    for (case_type, question_id), group in per_case.groupby(
        ["case_type", "question_id"], sort=True
    ):
        case_count = int(len(group))
        denominator = int(denominators.get(case_type, 0))
        rows.append(
            {
                "case_type": case_type,
                "question_id": question_id,
                "case_count": case_count,
                "action_count": int(group["actions"].sum()),
                "actions_per_case_mean": round(float(group["actions"].mean()), 3),
                "actions_per_case_max": int(group["actions"].max()),
                "share_of_cases": round(case_count / denominator, 4)
                if denominator
                else None,
            }
        )
    columns = (
        "case_type",
        "question_id",
        "case_count",
        "action_count",
        "actions_per_case_mean",
        "actions_per_case_max",
        "share_of_cases",
        AS_OF_COLUMN,
    )
    return _finish(rows, columns, as_of=as_of, sort_by=columns[:2])


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
            "answer_count": int(len(group)),
            "case_count": int(group[CASE_ID_COLUMN].nunique()),
        }
        for key, group in frame.groupby(dims, sort=True)
    ]
    columns = (*dims, "answer_count", "case_count", AS_OF_COLUMN)
    return _finish(rows, columns, as_of=as_of, sort_by=dims)


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
            "appeal_count": int(len(group)),
            "resolved_count": int(group["_cycle"].notna().sum()),
            **_stats(group["_cycle"], "cycle_days"),
        }
        for key, group in frame.groupby(dims, sort=True)
    ]
    columns = (
        *dims,
        "appeal_count",
        "resolved_count",
        "cycle_days_mean",
        "cycle_days_p50",
        "cycle_days_p90",
        "cycle_days_max",
        AS_OF_COLUMN,
    )
    return _finish(rows, columns, as_of=as_of, sort_by=dims)


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


def appeal_question_citations(appeals: Dataset, current: Dataset) -> Dataset:
    """Which questions get appealed. **Grain: case_type x question_id.**"""
    as_of = snapshot_as_of(current)
    frame = appeals.to_pandas()
    exploded = (
        frame.assign(question_id=frame["cited_question_ids_json"].map(_cited_questions))
        .explode("question_id")
        .dropna(subset=["question_id"])
    )
    rows = [
        {
            "case_type": case_type,
            "question_id": question_id,
            "appeal_count": int(group["appeal_id"].nunique()),
            "case_count": int(group[CASE_ID_COLUMN].nunique()),
        }
        for (case_type, question_id), group in exploded.groupby(
            ["case_type", "question_id"], sort=True
        )
    ]
    columns = ("case_type", "question_id", "appeal_count", "case_count", AS_OF_COLUMN)
    return _finish(rows, columns, as_of=as_of, sort_by=columns[:2])


def conversation_response_time(messages: Dataset, current: Dataset) -> Dataset:
    """How quickly Conversations are replied to. **Grain: brand x case_type.**

    Walks each Case's thread in ``seq`` order; a Message whose ``author_login``
    differs from the previous Message's is a reply, and its hours are measured
    from that previous Message. Two consecutive Messages by one author are one
    turn, not a reply to oneself. Author-agnostic by design: which *side*
    replied needs the bare-login-to-claims-login join the Sync subject refuses
    (see its data dictionary), and the source's own ``awaiting_since`` already
    says who is being waited on right now.
    """
    as_of = snapshot_as_of(current)
    frame = messages.to_pandas().copy()
    frame["_posted"] = _instants(frame["posted_at"])
    frame = frame.sort_values([CASE_ID_COLUMN, "seq"], kind="stable")
    replies: list[tuple[str, str, float]] = []
    for case_id, thread in frame.groupby(CASE_ID_COLUMN, sort=False):
        previous_author = None
        previous_posted = pd.NaT
        for _, message in thread.iterrows():
            author = message["author_login"]
            posted = message["_posted"]
            if (
                previous_author is not None
                and author != previous_author
                and pd.notna(posted)
                and pd.notna(previous_posted)
            ):
                hours = (posted - previous_posted).total_seconds() / SECONDS_PER_HOUR
                replies.append((message["case_type"], case_id, max(hours, 0.0)))
            previous_author, previous_posted = author, posted

    replied = pd.DataFrame(replies, columns=["case_type", CASE_ID_COLUMN, "hours"])
    rows = [
        {
            "brand": UNKNOWN_BRAND,
            "case_type": case_type,
            "thread_count": int(group[CASE_ID_COLUMN].nunique()),
            "reply_count": int(len(group)),
            **_stats(group["hours"], "reply_hours"),
        }
        for case_type, group in replied.groupby("case_type", sort=True)
    ]
    columns = (
        "brand",
        "case_type",
        "thread_count",
        "reply_count",
        "reply_hours_mean",
        "reply_hours_p50",
        "reply_hours_p90",
        "reply_hours_max",
        AS_OF_COLUMN,
    )
    return _finish(rows, columns, as_of=as_of, sort_by=columns[:2])


def _live_cases(current: Dataset) -> pd.DataFrame:
    """The current non-void Cases: the population a Conversation belongs to."""
    cases = current.to_pandas()
    return cases.loc[cases["status"].ne("Void"), [CASE_ID_COLUMN, "case_type"]]


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
    frame = messages.to_pandas()
    per_thread = (
        frame.loc[frame[CASE_ID_COLUMN].isin(live[CASE_ID_COLUMN])]
        .groupby(CASE_ID_COLUMN)
        .size()
        .rename("messages")
    )
    joined = live.join(per_thread, on=CASE_ID_COLUMN)
    rows = []
    for case_type, group in joined.groupby("case_type", sort=True):
        threads = group["messages"].dropna()
        case_count = int(len(group))
        thread_count = int(len(threads))
        rows.append(
            {
                "brand": UNKNOWN_BRAND,
                "case_type": case_type,
                "case_count": case_count,
                "thread_count": thread_count,
                "no_conversation_count": case_count - thread_count,
                "no_conversation_share": round(
                    (case_count - thread_count) / case_count, 4
                ),
                "message_count": int(threads.sum()),
                **_stats(threads, "messages_per_thread"),
            }
        )
    columns = (
        "brand",
        "case_type",
        "case_count",
        "thread_count",
        "no_conversation_count",
        "no_conversation_share",
        "message_count",
        "messages_per_thread_mean",
        "messages_per_thread_p50",
        "messages_per_thread_p90",
        "messages_per_thread_max",
        AS_OF_COLUMN,
    )
    return _finish(rows, columns, as_of=as_of, sort_by=columns[:2])


def _local_weekday_and_hour(instants: pd.Series) -> pd.DataFrame:
    """ISO weekday (1 = Monday) and hour of each instant on the local clock.

    Converted one instant at a time through the local-zone seam rather than
    with a fixed offset, so a thread spanning a summer-time change files each
    Message under the hour it was actually posted at.
    """
    zone = timestamps.local_timezone()
    local = [moment.to_pydatetime().astimezone(zone) for moment in instants]
    return pd.DataFrame(
        {
            "weekday_order": [moment.isoweekday() for moment in local],
            "hour_of_day": [moment.hour for moment in local],
        },
        index=instants.index,
    )


def conversation_posting_pattern(messages: Dataset, current: Dataset) -> Dataset:
    """When Messages get posted. **Grain: brand x case_type x weekday_order x
    hour_of_day.**

    Every Case Type with at least one counted Message gets the full 7 x 24
    grid, so a quiet cell is a row holding 0 rather than a hole a chart would
    have to infer. Weekday and hour are on the *local* clock, the same zone
    the calendar dates are expressed in; a Message with no parseable
    ``posted_at`` is not counted.
    """
    as_of = snapshot_as_of(current)
    live = _live_cases(current)
    frame = messages.to_pandas().copy()
    frame = frame.loc[frame[CASE_ID_COLUMN].isin(live[CASE_ID_COLUMN])]
    frame["_posted"] = _instants(frame["posted_at"])
    frame = frame.loc[frame["_posted"].notna()]
    posted = pd.concat([frame, _local_weekday_and_hour(frame["_posted"])], axis=1)
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
    columns = (
        "brand",
        "case_type",
        "weekday_order",
        "weekday",
        "hour_of_day",
        "message_count",
        AS_OF_COLUMN,
    )
    return _finish(rows, columns, as_of=as_of, sort_by=columns[:3] + columns[4:5])
