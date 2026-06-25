"""Plain-Python selection rules for the case-selection example.

Every business rule the selection applies is a small, pure, named function here,
so each can be unit-tested with a row ``dict`` and a date — no Pipeline, no
pandas, no IO. :mod:`pipelines.case_selection.selection` composes them into the
per-adviser decision; :mod:`pipelines.case_selection.pipeline` only wires IO.

A "review" is a ``dict`` with at least ``status`` / ``outcome`` / ``case_type``
and the *parsed* dates ``selected_date`` / ``completed_date`` (a ``date`` or
``None``). A "sale" is a ``dict`` with ``risk_score`` / ``category`` /
``sale_date`` / ``sale_id``.
"""

from __future__ import annotations

import math
from datetime import date
from typing import Any, Mapping, Sequence

# --- tunable thresholds (the spec's numbers, named in one place) -------------
RECENT_SALE_DAYS = 15  # a sale is a candidate if dated within this many days
FULL_YEAR_CHECK_TARGET = 10  # the check target over 12 *active* months...
CHECK_TARGET_MONTHS = 12  # ...pro-rata'd by active months below this many
TYPE_C_QUOTA = 2  # of those checks, this many must be case type C
MIN_DAYS_BETWEEN_CASES = 21  # last completed case -> next selection
FAILED_REVIEW_COOLDOWN_DAYS = 28  # extra wait after a failed review
RISK_BAND_A_MAX = 150  # risk score < 150 -> case type A
RISK_BAND_B_MAX = 250  # risk score < 250 -> case type B, else C

Row = Mapping[str, Any]


def case_type_for_score(risk_score: int) -> str:
    """Classify a sale's risk score into a check case type.

    ``< 150`` -> ``A``, ``< 250`` -> ``B``, ``>= 250`` -> ``C`` (the spec's "under
    150 / under 250 / over 250", with the 250 boundary landing in ``C``).
    """
    if risk_score < RISK_BAND_A_MAX:
        return "A"
    if risk_score < RISK_BAND_B_MAX:
        return "B"
    return "C"


def category_priority(category: str) -> int:
    """Rank a sale's product category for tie-breaking: ``A`` beats ``B``."""
    return {"A": 1, "B": 0}.get(category, -1)


def is_recent_sale(
    sale_date: date, as_of: date, *, within_days: int = RECENT_SALE_DAYS
) -> bool:
    """Whether a sale falls within the last ``within_days`` on or before ``as_of``."""
    delta = (as_of - sale_date).days
    return 0 <= delta < within_days


def best_sale(sales: Sequence[Row]) -> Row:
    """The sale to check for an adviser: highest risk, then category A over B.

    A final ``sale_id`` tie-break keeps the choice deterministic when two sales
    are otherwise identical.
    """
    return sorted(
        sales,
        key=lambda s: (
            -int(s["risk_score"]),
            -category_priority(s["category"]),
            s["sale_id"],
        ),
    )[0]


# --- rolling-12-month window, counted by calendar month, not by exact day ----
def rolling_months(as_of: date, *, count: int = 12) -> set[tuple[int, int]]:
    """The ``count`` ``(year, month)`` buckets ending with ``as_of``'s month."""
    months: set[tuple[int, int]] = set()
    year, month = as_of.year, as_of.month
    for _ in range(count):
        months.add((year, month))
        month -= 1
        if month == 0:
            month, year = 12, year - 1
    return months


def in_rolling_window(day: date, as_of: date, *, count: int = 12) -> bool:
    """Whether ``day``'s calendar month is one of the last ``count`` months."""
    return (day.year, day.month) in rolling_months(as_of, count=count)


def checks_in_window(reviews: Sequence[Row], as_of: date) -> int:
    """Count an adviser's checks selected within the rolling-12-month window."""
    return sum(1 for r in reviews if in_rolling_window(r["selected_date"], as_of))


def type_c_checks_in_window(reviews: Sequence[Row], as_of: date) -> int:
    """Count the case-type-C checks within the rolling-12-month window."""
    return sum(
        1
        for r in reviews
        if r["case_type"] == "C" and in_rolling_window(r["selected_date"], as_of)
    )


def _completed(reviews: Sequence[Row]) -> list[Row]:
    return [
        r
        for r in reviews
        if r["status"] == "completed" and r["completed_date"] is not None
    ]


# --- per-adviser eligibility gates ------------------------------------------
def has_case_in_progress(reviews: Sequence[Row]) -> bool:
    """An adviser may have only one case in progress at a time."""
    return any(r["status"] == "in_progress" for r in reviews)


def _round_half_up(value: float) -> int:
    return math.floor(value + 0.5)


def active_months(sales: Sequence[Row], as_of: date) -> int:
    """Count an adviser's *active* months: rolling-window months with >= 1 sale."""
    window = rolling_months(as_of, count=CHECK_TARGET_MONTHS)
    return len(
        {
            (s["sale_date"].year, s["sale_date"].month)
            for s in sales
            if (s["sale_date"].year, s["sale_date"].month) in window
        }
    )


def check_target(sales: Sequence[Row], as_of: date) -> int:
    """The adviser's check target: 10 over 12 active months, pro-rata below that.

    The target of ``FULL_YEAR_CHECK_TARGET`` (10) applies to a full 12 active
    months; an adviser active in fewer months has it scaled pro-rata to their
    active months (rounded half up), so a less-active adviser isn't held to a
    full-year target.
    """
    scaled = FULL_YEAR_CHECK_TARGET * active_months(sales, as_of) / CHECK_TARGET_MONTHS
    return _round_half_up(scaled)


def at_check_capacity(
    reviews: Sequence[Row], sales: Sequence[Row], as_of: date
) -> bool:
    """Whether the adviser already has their (pro-rata) target of checks."""
    return checks_in_window(reviews, as_of) >= check_target(sales, as_of)


def blocked_by_failed_review(
    reviews: Sequence[Row],
    as_of: date,
    *,
    cooldown_days: int = FAILED_REVIEW_COOLDOWN_DAYS,
) -> bool:
    """Whether a recent ``fail`` outcome still bars a new selection.

    After a failed review there must be ``cooldown_days`` clear before the next
    case is selected, measured from the failed review's completion.
    """
    failures = [r for r in _completed(reviews) if r["outcome"] == "fail"]
    if not failures:
        return False
    most_recent = max(r["completed_date"] for r in failures)
    return (as_of - most_recent).days < cooldown_days


def too_soon_since_last_case(
    reviews: Sequence[Row],
    as_of: date,
    *,
    min_gap_days: int = MIN_DAYS_BETWEEN_CASES,
) -> bool:
    """Whether the last completed case is too recent for a new selection."""
    completed = _completed(reviews)
    if not completed:
        return False
    most_recent = max(r["completed_date"] for r in completed)
    return (as_of - most_recent).days < min_gap_days


def exclusion_reason(
    reviews: Sequence[Row], sales: Sequence[Row], as_of: date
) -> str | None:
    """The first gate (if any) that excludes the adviser, else ``None``.

    The first failing gate wins, so the trace records one clear reason. The order
    follows the agreed rule priority: an in-progress case first, then the
    (pro-rata) check capacity, then the 21-day gap between cases, then the longer
    28-day cooldown that a failed review adds on top. The 21-day gap is checked
    before the 28-day cooldown so an adviser still inside the general gap is
    reported as such rather than as a failed-review case.
    """
    if has_case_in_progress(reviews):
        return "a case is already in progress"
    if at_check_capacity(reviews, sales, as_of):
        return (
            f"at the rolling-year check capacity "
            f"({checks_in_window(reviews, as_of)} of a pro-rata "
            f"{check_target(sales, as_of)})"
        )
    if too_soon_since_last_case(reviews, as_of):
        return f"within {MIN_DAYS_BETWEEN_CASES} days of the last completed case"
    if blocked_by_failed_review(reviews, as_of):
        return f"within the {FAILED_REVIEW_COOLDOWN_DAYS}-day failed-review cooldown"
    return None


def assign_case_type(
    risk_score: int,
    reviews: Sequence[Row],
    sales: Sequence[Row],
    as_of: date,
    *,
    type_c_quota: int = TYPE_C_QUOTA,
) -> str:
    """The case type to record: the risk-derived type, raised to C to meet quota.

    The case type is normally derived from the risk score
    (:func:`case_type_for_score`). But each adviser must end the rolling year with
    ``type_c_quota`` of their checks as case type C. When the adviser's remaining
    slots — against their (pro-rata) :func:`check_target` — are no more than their
    outstanding type-C shortfall, this selection is forced to C so the quota is
    still reachable.
    """
    natural = case_type_for_score(risk_score)
    if natural == "C":
        return "C"
    done = checks_in_window(reviews, as_of)
    type_c_needed = max(0, type_c_quota - type_c_checks_in_window(reviews, as_of))
    slots_remaining = check_target(sales, as_of) - done  # this fills one of them
    if 0 < slots_remaining <= type_c_needed:
        return "C"
    return natural
