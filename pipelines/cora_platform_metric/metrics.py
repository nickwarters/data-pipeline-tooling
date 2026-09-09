"""The reductions behind the ``cora_platform_metric`` gold tables.

Each function takes the Sync datasets as read and returns one Aggregate table;
nothing here reads or writes. ``case_stage_dwell`` and ``case_hold`` reduce the
observation history and so measure what the polls saw -- a change reversed
between two polls was never observed. Every table is stamped with Sync's own
``as_of_utc`` and open intervals are measured to it, so a re-run over the same
snapshot gives the same numbers.

Each reduction hands its rows to ``framework.transform.shaped`` with the
dataclass in ``schema`` that declares the table: that dataclass is the one
statement of a table's columns, their order and their types, so an empty result
still lands the shape the table's ``SchemaValidator`` gates. The statistics,
fills and instant arithmetic around each group-by are the shared aggregate
helpers; only the reduction itself is this module's.
"""

from __future__ import annotations

import datetime as dt
import json

import pandas as pd

from framework.core import Dataset
from framework.transform import (
    count_by,
    fill_dimensions,
    ratio,
    shaped,
    statistic,
    summarise,
)
from shared.reporting import UNASSIGNED, UNDECIDED, UNKNOWN_BRAND, UNRESOLVED, UNSTATED
from tools.calendar import WorkingDayCalendar
from tools.observability import timestamps
from tools.observability.timestamps import elapsed, instants, local_date, local_months

from .schema import (
    REMEDIATION_SLA,
    REVIEW_SLA,
    AnswerActionLoad,
    AnswerRemediationByManager,
    AppealCycleTime,
    AppealQuestionCitation,
    CaseHold,
    CaseSlaAttainmentMonthly,
    CaseStageDwell,
    CaseVoidMonthly,
    ConversationPostingPattern,
    ConversationResponseTime,
    ConversationVolume,
)

AS_OF_COLUMN = "as_of_utc"
CASE_ID_COLUMN = "case_id"

# The Sync subject's Case identity, as its history carries it. The history is
# read below the layer that derives ``case_id``, so the natural key stands in.
HISTORY_KEY = ("case_type", "source_item_id")

# The reporting fills (``UNKNOWN_BRAND`` & co.) come from ``shared.reporting``:
# literal keys rather than NULL so an aggregate's grain has no hole a reader may
# silently drop, spelled once for every subject that reports over them.

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


def _ordered_history(dataset: Dataset) -> pd.DataFrame:
    """The observation history in the order things happened, per Case.

    Ordered by the source's own ``Modified`` instant, then the observation id
    as a deterministic last resort. Sync's current-state rule additionally
    breaks a same-second tie on the parsed version; a tie that fine changes
    which of two sub-second observations is credited, not any measure here.
    """
    frame = dataset.to_pandas().copy()
    frame["_modified"] = instants(frame["source_modified_at"])
    return frame.sort_values(
        [*HISTORY_KEY, "_modified", "source_observation_id"], kind="stable"
    )


def _entry_instant(first: pd.Series) -> pd.Timestamp:
    """When a Case entered the status its *first* observation carries."""
    stamp_column = FIRST_OBSERVATION_ENTRY_STAMPS.get(first["status"])
    if stamp_column is None:
        return first["_modified"]
    stamped = instants(first.get(stamp_column))
    if pd.notna(stamped) and stamped <= first["_modified"]:
        return stamped
    return first["_modified"]


# --- history metrics --------------------------------------------------------


def case_stage_dwell(history: Dataset, *, as_of: str) -> Dataset:
    """How long Cases dwell in each status. **Grain: brand x case_type x
    status.**

    Walks each Case's observations in order; every change of ``status`` closes
    an interval at that observation's ``Modified`` and opens the next. A Case's
    last interval is *open* unless its status is terminal. Statistics are over
    closed intervals only -- an open one has no length yet, and measuring it to
    ``as_of`` would mix two different questions (the Sync subject's age-bucket
    aggregates already answer "how long has it been waiting").
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
            stays.append(
                (case_type, status, elapsed(entered, observation["_modified"]), False)
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
                **summarise(closed, "dwell_days"),
            }
        )
    return shaped(
        rows,
        CaseStageDwell,
        stamp={AS_OF_COLUMN: as_of},
        sort_by=("brand", "case_type", "status"),
    )


def case_hold(history: Dataset, *, as_of: str) -> Dataset:
    """How often and how long Cases are held. **Grain: brand x case_type x
    assigned_reviewer_name.**

    A hold opens at the first observation carrying ``on_hold`` (from the
    source's ``placed_on_hold_at`` where it has one, else that observation's
    ``Modified``) and closes at the first later observation without it. A hold
    still open at the last observation is measured to ``as_of`` and counted in
    ``open_hold_count``. Attributed to the Reviewer the Case's latest
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
        started = pd.NaT
        for _, observation in observations.iterrows():
            on_hold = pd.notna(observation["on_hold"]) and bool(observation["on_hold"])
            if on_hold and pd.isna(started):
                stamped = instants(observation["placed_on_hold_at"])
                started = stamped if pd.notna(stamped) else observation["_modified"]
            elif not on_hold and pd.notna(started):
                released = observation["_modified"]
                holds.append(
                    (case_type, item, reviewer, elapsed(started, released), False)
                )
                started = pd.NaT
        if pd.notna(started):
            holds.append(
                (case_type, item, reviewer, elapsed(started, as_of_instant), True)
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
            "held_days_total": statistic(group["days"].sum()),
            "held_days_mean": statistic(group["days"].mean()),
        }
        for (case_type, reviewer), group in held.groupby(
            ["case_type", "assigned_reviewer_name"], sort=True
        )
    ]
    return shaped(
        rows,
        CaseHold,
        stamp={AS_OF_COLUMN: as_of},
        sort_by=("brand", "case_type", "assigned_reviewer_name"),
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
    completed["_completed"] = instants(completed["completed_at"])
    completed = completed.loc[completed["_completed"].notna()]
    completed["completed_month"] = local_months(completed["_completed"])
    completed = fill_dimensions(
        completed, {"assigned_reviewer_manager_name": UNASSIGNED}
    )

    dims = ["completed_month", "case_type", "assigned_reviewer_manager_name"]
    rows = []
    for sla_kind, due_column in SLA_DUE_DATES:
        judged = completed.copy()
        judged["_due"] = instants(judged[due_column])
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
                    **summarise(overdue, "late_working_days", quantiles=()),
                }
            )
    return shaped(
        rows,
        CaseSlaAttainmentMonthly,
        stamp={AS_OF_COLUMN: as_of},
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
    voided["_voided"] = instants(voided["voided_at"])
    voided = voided.loc[voided["_voided"].notna()]
    voided["void_month"] = local_months(voided["_voided"])
    voided["_age"] = elapsed(instants(voided["created"]), voided["_voided"])
    voided = fill_dimensions(
        voided, {"void_reason": UNSTATED, "voided_by_name": UNASSIGNED}
    )

    dims = ["void_month", "case_type", "void_reason", "voided_by_name"]
    rows = [
        {
            "void_month": month,
            "brand": UNKNOWN_BRAND,
            "case_type": case_type,
            "void_reason": reason,
            "voided_by_name": by,
            "case_count": len(group),
            **summarise(group["_age"], "age_at_void_days", quantiles=()),
        }
        for (month, case_type, reason, by), group in voided.groupby(dims, sort=True)
    ]
    return shaped(
        rows,
        CaseVoidMonthly,
        stamp={AS_OF_COLUMN: as_of},
        sort_by=("void_month", "brand", "case_type", "void_reason", "voided_by_name"),
    )


def answer_action_load(actions: Dataset, current: Dataset, *, as_of: str) -> Dataset:
    """Remediation Actions per question. **Grain: case_type x question_id.**

    ``share_of_cases`` divides by the current non-void Cases of the Case Type,
    so it reads as "this share of the Case Type's live Cases carry an Action on
    this question".
    """
    live = _live_cases(current)
    live_counts = live.groupby("case_type").size()
    per_case = count_by(
        actions.to_pandas(),
        ("case_type", "question_id", CASE_ID_COLUMN),
        measure="actions",
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
                "actions_per_case_mean": statistic(group["actions"].mean()),
                "actions_per_case_max": int(group["actions"].max()),
                "share_of_cases": ratio(len(group), live_count),
            }
        )
    return shaped(
        rows,
        AnswerActionLoad,
        stamp={AS_OF_COLUMN: as_of},
        sort_by=("case_type", "question_id"),
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
    frame = fill_dimensions(
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
    return shaped(
        rows,
        AnswerRemediationByManager,
        stamp={AS_OF_COLUMN: as_of},
        sort_by=tuple(dims),
    )


def appeal_cycle_time(appeals: Dataset, *, as_of: str) -> Dataset:
    """How long Appeals take to resolve. **Grain: case_type x state x
    resolution_verdict.** Cycle days run from ``raised_at`` to
    ``resolution_at``, over the Appeals carrying both."""
    frame = appeals.to_pandas().copy()
    frame["_cycle"] = elapsed(
        instants(frame["raised_at"]), instants(frame["resolution_at"])
    )
    frame = fill_dimensions(
        frame, {"state": UNSTATED, "resolution_verdict": UNRESOLVED}
    )

    dims = ["case_type", "state", "resolution_verdict"]
    rows = [
        {
            "case_type": case_type,
            "state": state,
            "resolution_verdict": verdict,
            "appeal_count": len(group),
            "resolved_count": int(group["_cycle"].notna().sum()),
            **summarise(group["_cycle"], "cycle_days"),
        }
        for (case_type, state, verdict), group in frame.groupby(dims, sort=True)
    ]
    return shaped(
        rows, AppealCycleTime, stamp={AS_OF_COLUMN: as_of}, sort_by=tuple(dims)
    )


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
    return shaped(
        rows,
        AppealQuestionCitation,
        stamp={AS_OF_COLUMN: as_of},
        sort_by=("case_type", "question_id"),
    )


def conversation_response_time(messages: Dataset, *, as_of: str) -> Dataset:
    """How quickly Conversations are replied to. **Grain: brand x case_type.**

    Each Case's thread is read in ``seq`` order; a Message whose
    ``author_login`` differs from the previous Message's is a reply, and its
    hours are measured from that previous Message. Two consecutive Messages by
    one author are one turn, not a reply to oneself. Author-agnostic by design:
    which *side* replied needs the bare-login-to-claims-login join the Sync
    subject refuses (see its data dictionary), and the source's own
    ``awaiting_since`` already says who is being waited on right now.
    """
    frame = messages.to_pandas().copy()
    frame["_posted"] = instants(frame["posted_at"])
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
    replies["hours"] = elapsed(
        previous_posted.loc[replies.index], replies["_posted"], unit="hours"
    )

    rows = [
        {
            "brand": UNKNOWN_BRAND,
            "case_type": case_type,
            "thread_count": group[CASE_ID_COLUMN].nunique(),
            "reply_count": len(group),
            **summarise(group["hours"], "reply_hours"),
        }
        for case_type, group in replies.groupby("case_type", sort=True)
    ]
    return shaped(
        rows,
        ConversationResponseTime,
        stamp={AS_OF_COLUMN: as_of},
        sort_by=("brand", "case_type"),
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
                "no_conversation_share": ratio(without, len(group)),
                "message_count": int(lengths.sum()),
                **summarise(lengths, "messages_per_thread"),
            }
        )
    return shaped(
        rows,
        ConversationVolume,
        stamp={AS_OF_COLUMN: as_of},
        sort_by=("brand", "case_type"),
    )


def _live_messages(messages: Dataset, live: pd.DataFrame) -> pd.DataFrame:
    """The Messages whose Case is one of the live Cases."""
    frame = messages.to_pandas()
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
    posted = _live_messages(messages, _live_cases(current)).copy()
    posted["_posted"] = instants(posted["posted_at"])
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
        for hour in range(24)
    ]
    return shaped(
        rows,
        ConversationPostingPattern,
        stamp={AS_OF_COLUMN: as_of},
        sort_by=("brand", "case_type", "weekday_order", "hour_of_day"),
    )
