"""``PersonTargetedSelection`` — choose who is due a check, and which Case.

A Selection processor: it takes an Adviser roster's sales as a ``Dataset`` and
returns the Cases chosen, so it slots into a Selection pipeline as a
``transform`` step like any framework processor. What it chooses is declared by
a :class:`PersonTargetedSelectionConfig` (ADR-0022, as amended by ADR-0033):

- An **Adviser** owes a **Check target** (10) per rolling 12 months across a
  **Selection group**'s Case Types, pro-rata by **active months**. The target
  is also the cap: an Adviser at target is not selectable.
- A **Case Type quota** (2) of those places is **reserved** for the group's
  quota Case Type: only the other 8 are open to the rest, so once an Adviser
  has taken 8 from other Case Types only quota Case Type sales are eligible.
- The **Check cadence** runs from the previous check reaching Reportable:
  selectable after 20 working days, or 10 while **Behind** (2 or more short);
  **overdue** after 25. One outstanding check per Adviser across the group.
- Within one Adviser's eligible sales, **highest risk score always wins**; the
  Case Type the Adviser has had fewest checks in breaks equal-score ties.

Every rule is a small pure function of plain rows (``dict`` s with parsed
``date`` s) plus the config, so each is testable on its own; the processor only
parses and re-frames (see ``docs/person-targeted-selection.md``). Three inputs:
the **sales** (the processor's input, a full rolling window of them, since the
same rows decide active months), Sync's monthly **check counts**, and Sync's
per-Case-Type **current state**.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Collection, Iterable, Mapping, Sequence

import pandas as pd

from framework.core import Dataset
from tools.calendar import WorkingDayCalendar

Row = Mapping[str, Any]
Month = tuple[int, int]

SELECTED = "selected"
AT_TARGET = "at target"
WITHIN_CADENCE = "within cadence"
NO_ELIGIBLE_CASE = "no eligible case"

SALE_COLUMNS = ("adviser", "case_type", "sale_id", "sale_date", "risk_score")
CHECK_COLUMNS = ("adviser", "case_type", "month", "status", "check_count")
CURRENT_COLUMNS = (
    "adviser",
    "case_type",
    "outstanding_case_count",
    "last_reportable_date",
)
STATE_COLUMNS = (
    "adviser",
    "active_months",
    "target",
    "checks",
    "shortfall",
    "quota_target",
    "quota_checks",
    "quota_shortfall",
    "other_room",
    "is_behind",
    "last_reportable_date",
    "next_eligible_date",
    "due_date",
    "overdue",
    "verdict",
    "reason",
    "sale_id",
    "unservable_since",
)


@dataclass(frozen=True)
class PersonTargetedSelectionConfig:
    """What :class:`PersonTargetedSelection` chooses — see the module docstring.

    ``case_types`` is the Selection group; ``quota_case_type`` must be one of
    them. Durations are **working** days after the previous check reached
    Reportable: ``catch_up_cadence_days <= cadence_days <= due_days``.
    """

    case_types: tuple[str, ...]
    quota_case_type: str
    check_target: int = 10
    case_type_quota: int = 2
    target_months: int = 12
    behind_band: int = 2
    cadence_days: int = 20
    catch_up_cadence_days: int = 10
    due_days: int = 25
    sale_window_days: int = 15
    countable_statuses: tuple[str, ...] = ("Actions In Progress", "Completed")

    def __post_init__(self) -> None:
        if not self.case_types:
            raise ValueError(
                "PersonTargetedSelectionConfig needs at least one case type"
            )
        if len(set(self.case_types)) != len(self.case_types):
            raise ValueError(f"`case_types` {self.case_types!r} must not repeat")
        if self.quota_case_type not in self.case_types:
            raise ValueError(
                f"`quota_case_type` {self.quota_case_type!r} must be one of "
                f"`case_types` {self.case_types!r}"
            )
        if self.check_target < 0:
            raise ValueError(
                f"`check_target` must not be negative, got {self.check_target!r}"
            )
        if not 0 <= self.case_type_quota <= self.check_target:
            raise ValueError(
                f"`case_type_quota` {self.case_type_quota!r} must be between 0 and "
                f"`check_target` {self.check_target!r}"
            )
        if self.target_months < 1:
            raise ValueError(
                f"`target_months` must be at least 1, got {self.target_months!r}"
            )
        if self.behind_band < 1:
            raise ValueError(
                f"`behind_band` must be at least 1, got {self.behind_band!r}"
            )
        if not 0 <= self.catch_up_cadence_days <= self.cadence_days <= self.due_days:
            raise ValueError(
                "cadence must satisfy 0 <= catch_up_cadence_days <= cadence_days "
                f"<= due_days, got {self.catch_up_cadence_days!r}, "
                f"{self.cadence_days!r}, {self.due_days!r}"
            )
        if self.sale_window_days < 1:
            raise ValueError(
                f"`sale_window_days` must be at least 1, got {self.sale_window_days!r}"
            )
        if not self.countable_statuses:
            raise ValueError("`countable_statuses` must name at least one status")

    @property
    def other_case_types(self) -> frozenset[str]:
        return frozenset(self.case_types) - {self.quota_case_type}


# --- 1. Activity and the pro-rata basis --------------------------------------


def rolling_months(as_of: date, count: int) -> set[Month]:
    """The ``count`` ``(year, month)`` buckets ending with ``as_of``'s month."""
    months: set[Month] = set()
    year, month = as_of.year, as_of.month
    for _ in range(count):
        months.add((year, month))
        month -= 1
        if month == 0:
            month, year = 12, year - 1
    return months


def active_months(
    sales: Sequence[Row], as_of: date, config: PersonTargetedSelectionConfig
) -> int:
    """Window months with at least one sale in any of the group's Case Types."""
    window = rolling_months(as_of, config.target_months)
    return len(
        {
            (s["sale_date"].year, s["sale_date"].month)
            for s in sales
            if s["case_type"] in config.case_types
            and (s["sale_date"].year, s["sale_date"].month) in window
        }
    )


def pro_rata(
    full_year_value: int, months: int, config: PersonTargetedSelectionConfig
) -> int:
    """Scale a full-year figure to ``months`` of activity, rounded half up.

    One rounding rule for the target and the quota, so the quota can never round
    above the target it sits inside.
    """
    return math.floor(full_year_value * months / config.target_months + 0.5)


# --- 3. Counting checks -------------------------------------------------------


def checks_in_window(
    counts: Sequence[Row],
    as_of: date,
    config: PersonTargetedSelectionConfig,
    *,
    case_types: Collection[str] | None = None,
) -> int:
    """Countable checks in the window, across the group or just ``case_types``.

    Counts are bucketed by the month a Case became Reportable, so a voided Case
    never appears and needs no subtracting.
    """
    window = rolling_months(as_of, config.target_months)
    wanted = config.case_types if case_types is None else case_types
    return sum(
        int(c["check_count"])
        for c in counts
        if c["month"] in window
        and c["case_type"] in wanted
        and c["status"] in config.countable_statuses
    )


def checks_by_case_type(
    counts: Sequence[Row], as_of: date, config: PersonTargetedSelectionConfig
) -> dict[str, int]:
    """Countable checks in the window for each of the group's Case Types."""
    return {
        case_type: checks_in_window(counts, as_of, config, case_types={case_type})
        for case_type in config.case_types
    }


# --- 4. Standing: shortfall, the reserved quota, and Behind ------------------


def target(
    sales: Sequence[Row], as_of: date, config: PersonTargetedSelectionConfig
) -> int:
    return pro_rata(config.check_target, active_months(sales, as_of, config), config)


def quota_target(
    sales: Sequence[Row], as_of: date, config: PersonTargetedSelectionConfig
) -> int:
    return pro_rata(config.case_type_quota, active_months(sales, as_of, config), config)


def shortfall(
    counts: Sequence[Row],
    sales: Sequence[Row],
    as_of: date,
    config: PersonTargetedSelectionConfig,
) -> int:
    """Pro-rata target minus checks in the window, floored at 0.

    The capacity gate (0 means at target, so not selectable — which is also what
    caps an Adviser at the target) and the cross-Adviser sort key.
    """
    return max(
        0, target(sales, as_of, config) - checks_in_window(counts, as_of, config)
    )


def quota_shortfall(
    counts: Sequence[Row],
    sales: Sequence[Row],
    as_of: date,
    config: PersonTargetedSelectionConfig,
) -> int:
    """Pro-rata quota minus the quota Case Type's checks, floored at 0."""
    quota_checks = checks_in_window(
        counts, as_of, config, case_types={config.quota_case_type}
    )
    return max(0, quota_target(sales, as_of, config) - quota_checks)


def other_room(
    counts: Sequence[Row],
    sales: Sequence[Row],
    as_of: date,
    config: PersonTargetedSelectionConfig,
) -> int:
    """How many more checks may come from Case Types other than the quota's.

    ``pro-rata target - pro-rata quota - other checks in window`` (8 at a full
    year). The quota is reserved, not preferred: at 0, only quota Case Type
    sales are eligible.
    """
    allowance = target(sales, as_of, config) - quota_target(sales, as_of, config)
    others = checks_in_window(counts, as_of, config, case_types=config.other_case_types)
    return max(0, allowance - others)


def is_behind(
    counts: Sequence[Row],
    sales: Sequence[Row],
    as_of: date,
    config: PersonTargetedSelectionConfig,
) -> bool:
    """Short by at least ``behind_band`` — the trigger for the catch-up cadence."""
    return shortfall(counts, sales, as_of, config) >= config.behind_band


# --- 5. Cadence ---------------------------------------------------------------


def latest_reportable(currents: Sequence[Row]) -> date | None:
    """The latest ``last_reportable_date`` across the group's Case Types."""
    dates = [c["last_reportable_date"] for c in currents if c["last_reportable_date"]]
    return max(dates) if dates else None


def next_eligible_date(
    last_reportable: date | None,
    behind: bool,
    config: PersonTargetedSelectionConfig,
    calendar: WorkingDayCalendar,
) -> date | None:
    """20 working days after the last Reportable, or 10 while Behind.

    ``None`` when the Adviser has never had a check: eligible now.
    """
    if last_reportable is None:
        return None
    days = config.catch_up_cadence_days if behind else config.cadence_days
    return calendar.add_working_days(last_reportable, days)


def due_date(
    last_reportable: date | None,
    config: PersonTargetedSelectionConfig,
    calendar: WorkingDayCalendar,
) -> date | None:
    """25 working days after the last Reportable — a reporting line, not a gate."""
    if last_reportable is None:
        return None
    return calendar.add_working_days(last_reportable, config.due_days)


def is_overdue(
    shortfall_: int,
    last_reportable: date | None,
    as_of: date,
    config: PersonTargetedSelectionConfig,
    calendar: WorkingDayCalendar,
) -> bool:
    """Under target and past the due line. At target, an Adviser never is."""
    due = due_date(last_reportable, config, calendar)
    return shortfall_ > 0 and due is not None and as_of > due


def has_outstanding_check(currents: Sequence[Row]) -> bool:
    """Any Case outstanding in any of the group's Case Types.

    Outstanding begins at delivery, so a Case still in the Hopper counts.
    """
    return any(
        not _is_null(c["outstanding_case_count"])
        and int(c["outstanding_case_count"]) > 0
        for c in currents
    )


def within_cadence(
    currents: Sequence[Row],
    behind: bool,
    as_of: date,
    config: PersonTargetedSelectionConfig,
    calendar: WorkingDayCalendar,
) -> bool:
    """Blocked by pacing: something outstanding, or the gap not yet elapsed."""
    if has_outstanding_check(currents):
        return True
    nxt = next_eligible_date(latest_reportable(currents), behind, config, calendar)
    return nxt is not None and as_of < nxt


# --- 6. Which Case ------------------------------------------------------------


def sale_window_start(
    as_of: date, config: PersonTargetedSelectionConfig, calendar: WorkingDayCalendar
) -> date:
    """The earliest selectable sale date: ``sale_window_days`` working days back."""
    return calendar.last_n_working_days(config.sale_window_days, as_of)[-1]


def is_selectable_sale(
    sale: Row,
    as_of: date,
    config: PersonTargetedSelectionConfig,
    calendar: WorkingDayCalendar,
) -> bool:
    """In one of the group's Case Types, and within the working-day sale window."""
    return (
        sale["case_type"] in config.case_types
        and sale_window_start(as_of, config, calendar) <= sale["sale_date"] <= as_of
    )


def eligible_cases(
    sales: Sequence[Row],
    other_room_: int,
    as_of: date,
    config: PersonTargetedSelectionConfig,
    calendar: WorkingDayCalendar,
    *,
    voided_sale_ids: Collection[str] = (),
) -> list[Row]:
    """Selectable sales, only the quota Case Type's once ``other_room_`` is 0.

    A sale that already produced a voided Case is never re-selected: it would
    mint the same ``case_id`` and reproduce a ``duplicate`` void.
    """
    start = sale_window_start(as_of, config, calendar)
    return [
        s
        for s in sales
        if s["case_type"] in config.case_types
        and start <= s["sale_date"] <= as_of
        and (other_room_ > 0 or s["case_type"] == config.quota_case_type)
        and s["sale_id"] not in voided_sale_ids
    ]


def best_case(cases: Sequence[Row], checks_by_case_type_: Mapping[str, int]) -> Row:
    """Highest risk score; then the Case Type with fewest checks; then ``sale_id``.

    The quota is already enforced by :func:`eligible_cases`, so nothing here
    overrides risk.
    """
    return sorted(
        cases,
        key=lambda s: (
            -int(s["risk_score"]),
            checks_by_case_type_.get(s["case_type"], 0),
            str(s["sale_id"]),
        ),
    )[0]


# --- 7. The verdict, and the run ---------------------------------------------


def check_verdict(
    counts: Sequence[Row],
    sales: Sequence[Row],
    currents: Sequence[Row],
    as_of: date,
    config: PersonTargetedSelectionConfig,
    calendar: WorkingDayCalendar,
    *,
    voided_sale_ids: Collection[str] = (),
) -> tuple[str, str, Row | None]:
    """``(verdict, reason, chosen sale)`` — the first gate to hold wins."""
    short = shortfall(counts, sales, as_of, config)
    if short == 0:
        return (
            AT_TARGET,
            f"at the pro-rata target of {target(sales, as_of, config)}",
            None,
        )

    behind = short >= config.behind_band
    if has_outstanding_check(currents):
        return WITHIN_CADENCE, "a check is outstanding", None
    if within_cadence(currents, behind, as_of, config, calendar):
        nxt = next_eligible_date(latest_reportable(currents), behind, config, calendar)
        return WITHIN_CADENCE, f"next eligible {nxt.isoformat()}", None

    room = other_room(counts, sales, as_of, config)
    cases = eligible_cases(
        sales, room, as_of, config, calendar, voided_sale_ids=voided_sale_ids
    )
    if not cases:
        if room == 0:
            reason = (
                f"other Case Types used; no {config.quota_case_type} sale within "
                f"{config.sale_window_days} working days"
            )
        else:
            reason = f"no sale within {config.sale_window_days} working days"
        return NO_ELIGIBLE_CASE, reason, None

    chosen = best_case(cases, checks_by_case_type(counts, as_of, config))
    return SELECTED, f"shortfall {short}, risk score {chosen['risk_score']}", chosen


def unservable_since(previous: Row | None, verdict: str, as_of: date) -> date | None:
    """The first run date of an unbroken ``no eligible case`` streak."""
    if verdict != NO_ELIGIBLE_CASE:
        return None
    if previous and previous.get("verdict") == NO_ELIGIBLE_CASE:
        return previous.get("unservable_since") or as_of
    return as_of


def selection_order(state_rows: Sequence[Row], chosen: Mapping[str, Row]) -> list[str]:
    """Selected Advisers, largest shortfall first, then the chosen Case's risk."""
    selected = [r for r in state_rows if r["verdict"] == SELECTED]
    return [
        r["adviser"]
        for r in sorted(
            selected,
            key=lambda r: (
                -r["shortfall"],
                -int(chosen[r["adviser"]]["risk_score"]),
                str(r["adviser"]),
            ),
        )
    ]


def plan_checks(
    sales: Sequence[Row],
    counts: Sequence[Row],
    currents: Sequence[Row],
    as_of: date,
    config: PersonTargetedSelectionConfig,
    calendar: WorkingDayCalendar,
    *,
    voided_sale_ids: Collection[str] = (),
    previous: Sequence[Row] = (),
) -> tuple[list[Row], list[dict[str, Any]]]:
    """``(selected sales in selection order, one state row per Adviser)``.

    The roster is every Adviser with a sale in one of the group's Case Types —
    one with no sales has a target of 0 and would be at target trivially.
    """
    sales_by = _by_adviser(s for s in sales if s["case_type"] in config.case_types)
    counts_by = _by_adviser(counts)
    currents_by = _by_adviser(
        c for c in currents if c["case_type"] in config.case_types
    )
    previous_by = {p["adviser"]: p for p in previous}

    state_rows: list[dict[str, Any]] = []
    chosen: dict[str, Row] = {}
    for adviser in sorted(sales_by, key=str):
        a_sales = sales_by[adviser]
        a_counts = counts_by.get(adviser, [])
        a_currents = currents_by.get(adviser, [])
        verdict, reason, sale = check_verdict(
            a_counts,
            a_sales,
            a_currents,
            as_of,
            config,
            calendar,
            voided_sale_ids=voided_sale_ids,
        )
        if sale is not None:
            chosen[adviser] = sale
        state_rows.append(
            _state_row(
                adviser,
                a_counts,
                a_sales,
                a_currents,
                as_of,
                config,
                calendar,
                verdict=verdict,
                reason=reason,
                sale=sale,
                previous=previous_by.get(adviser),
            )
        )
    order = selection_order(state_rows, chosen)
    return [chosen[adviser] for adviser in order], state_rows


def _state_row(
    adviser: Any,
    counts: Sequence[Row],
    sales: Sequence[Row],
    currents: Sequence[Row],
    as_of: date,
    config: PersonTargetedSelectionConfig,
    calendar: WorkingDayCalendar,
    *,
    verdict: str,
    reason: str,
    sale: Row | None,
    previous: Row | None,
) -> dict[str, Any]:
    short = shortfall(counts, sales, as_of, config)
    behind = short >= config.behind_band
    last = latest_reportable(currents)
    return {
        "adviser": adviser,
        "active_months": active_months(sales, as_of, config),
        "target": target(sales, as_of, config),
        "checks": checks_in_window(counts, as_of, config),
        "shortfall": short,
        "quota_target": quota_target(sales, as_of, config),
        "quota_checks": checks_in_window(
            counts, as_of, config, case_types={config.quota_case_type}
        ),
        "quota_shortfall": quota_shortfall(counts, sales, as_of, config),
        "other_room": other_room(counts, sales, as_of, config),
        "is_behind": behind,
        "last_reportable_date": last,
        "next_eligible_date": next_eligible_date(last, behind, config, calendar),
        "due_date": due_date(last, config, calendar),
        "overdue": is_overdue(short, last, as_of, config, calendar),
        "verdict": verdict,
        "reason": reason,
        "sale_id": None if sale is None else sale["sale_id"],
        "unservable_since": unservable_since(previous, verdict, as_of),
    }


def _is_null(value: Any) -> bool:
    # None, NaN, NaT and pd.NA all read as missing; pd.isna is only asked about
    # scalars, so a date or a string is never mistaken for an array.
    # NaT is checked by identity because it is itself a ``datetime``.
    if value is None or value is pd.NaT:
        return True
    return not isinstance(value, (str, date)) and bool(pd.isna(value))


def _by_adviser(rows: Iterable[Row]) -> dict[Any, list[Row]]:
    grouped: dict[Any, list[Row]] = defaultdict(list)
    for row in rows:
        grouped[row["adviser"]].append(row)
    return grouped


# --- The processor ------------------------------------------------------------


@dataclass(frozen=True)
class CheckPlan:
    """Both outputs of one run: the Cases chosen, and every Adviser's standing."""

    selected: Dataset
    advisers: Dataset


class PersonTargetedSelection:
    """Choose, per Adviser, whether a check is due and which Case to take.

    ``checks`` (Sync's monthly aggregate) and ``current`` (Sync's per-Case-Type
    current state) are already-read Datasets; ``previous`` is the last run's
    state table, read to carry ``unservable_since`` forward. ``voided_sale_ids``
    are the sales that already produced a voided Case.
    """

    trace_role = "sample"
    trace_name = "person-targeted selection"

    def __init__(
        self,
        config: PersonTargetedSelectionConfig,
        *,
        checks: Dataset,
        current: Dataset,
        as_of: date,
        calendar: WorkingDayCalendar | None = None,
        voided_sale_ids: Collection[str] = (),
        previous: Dataset | None = None,
    ) -> None:
        self._config = config
        self._checks = checks
        self._current = current
        self._as_of = as_of
        self._calendar = calendar or WorkingDayCalendar()
        self._voided_sale_ids = frozenset(voided_sale_ids)
        self._previous = previous

    def __call__(self, dataset: Dataset) -> Dataset:
        return self.plan(dataset).selected

    def plan(self, dataset: Dataset) -> CheckPlan:
        frame = dataset.to_pandas()
        _require(frame, SALE_COLUMNS, "sales")
        sales = [
            {**row, "sale_date": _as_date(row["sale_date"]), "_position": position}
            for position, row in enumerate(frame[list(SALE_COLUMNS)].to_dict("records"))
        ]
        selected, state_rows = plan_checks(
            sales,
            self._check_rows(),
            self._current_rows(),
            self._as_of,
            self._config,
            self._calendar,
            voided_sale_ids=self._voided_sale_ids,
            previous=self._previous_rows(),
        )
        positions = [row["_position"] for row in selected]
        chosen = frame.iloc[positions].reset_index(drop=True)
        advisers = pd.DataFrame(state_rows, columns=list(STATE_COLUMNS))
        return CheckPlan(Dataset.from_pandas(chosen), Dataset.from_pandas(advisers))

    def _check_rows(self) -> list[dict[str, Any]]:
        frame = self._checks.to_pandas()
        _require(frame, CHECK_COLUMNS, "checks")
        return [
            {**row, "month": _as_month(row["month"])}
            for row in frame[list(CHECK_COLUMNS)].to_dict("records")
        ]

    def _current_rows(self) -> list[dict[str, Any]]:
        frame = self._current.to_pandas()
        _require(frame, CURRENT_COLUMNS, "current")
        return [
            {**row, "last_reportable_date": _as_date(row["last_reportable_date"])}
            for row in frame[list(CURRENT_COLUMNS)].to_dict("records")
        ]

    def _previous_rows(self) -> list[dict[str, Any]]:
        if self._previous is None:
            return []
        frame = self._previous.to_pandas()
        _require(frame, ("adviser", "verdict", "unservable_since"), "previous")
        return [
            {**row, "unservable_since": _as_date(row["unservable_since"])}
            for row in frame[["adviser", "verdict", "unservable_since"]].to_dict(
                "records"
            )
        ]

    def describe(self) -> str:
        c = self._config
        return (
            f"PersonTargetedSelection(case_types={list(c.case_types)!r}, "
            f"quota_case_type={c.quota_case_type!r}, check_target={c.check_target!r}, "
            f"case_type_quota={c.case_type_quota!r}, behind_band={c.behind_band!r}, "
            f"cadence_days={c.cadence_days!r}, "
            f"catch_up_cadence_days={c.catch_up_cadence_days!r}, "
            f"due_days={c.due_days!r}, sale_window_days={c.sale_window_days!r}, "
            f"as_of={self._as_of.isoformat()!r})"
        )


def _require(frame: Any, columns: Sequence[str], name: str) -> None:
    missing = [c for c in columns if c not in frame.columns]
    if missing:
        raise ValueError(
            f"PersonTargetedSelection: column(s) not found in {name}: {missing!r}. "
            f"Available columns: {list(frame.columns)!r}"
        )


def _as_date(value: Any) -> date | None:
    """A ``date`` from a date, datetime, pandas Timestamp or ISO string; else None."""
    if _is_null(value):
        return None
    if isinstance(value, datetime):  # also a pandas Timestamp
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        return date.fromisoformat(value[:10]) if value else None
    raise ValueError(f"PersonTargetedSelection: cannot read {value!r} as a date")


def _as_month(value: Any) -> Month:
    """A ``(year, month)`` from a tuple, a date, or a ``YYYY-MM`` string."""
    if isinstance(value, tuple):
        return int(value[0]), int(value[1])
    if isinstance(value, (date, datetime)):
        return value.year, value.month
    if isinstance(value, str):
        year, month = value[:7].split("-")
        return int(year), int(month)
    raise ValueError(f"PersonTargetedSelection: cannot read {value!r} as a month")
