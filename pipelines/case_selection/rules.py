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

from datetime import date
from typing import Any, Mapping, Sequence

# --- tunable thresholds (the spec's numbers, named in one place) -------------
RECENT_SALE_DAYS = 15  # a sale is a candidate if dated within this many days
MAX_CHECKS_PER_YEAR = 10  # rolling-12-month cap on checks per adviser
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


def at_check_capacity(
    reviews: Sequence[Row], as_of: date, *, max_checks: int = MAX_CHECKS_PER_YEAR
) -> bool:
    """Whether the adviser already has ``max_checks`` in the rolling year."""
    return checks_in_window(reviews, as_of) >= max_checks


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


def exclusion_reason(reviews: Sequence[Row], as_of: date) -> str | None:
    """The first gate (if any) that excludes the adviser, else ``None``.

    The order is the spec's order of mention; the first failing gate wins so the
    selection trace records one clear reason per excluded adviser.
    """
    if has_case_in_progress(reviews):
        return "a case is already in progress"
    if at_check_capacity(reviews, as_of):
        return f"at the {MAX_CHECKS_PER_YEAR}-check rolling-year capacity"
    if blocked_by_failed_review(reviews, as_of):
        return f"within the {FAILED_REVIEW_COOLDOWN_DAYS}-day failed-review cooldown"
    if too_soon_since_last_case(reviews, as_of):
        return f"within {MIN_DAYS_BETWEEN_CASES} days of the last completed case"
    return None


def assign_case_type(
    risk_score: int,
    reviews: Sequence[Row],
    as_of: date,
    *,
    max_checks: int = MAX_CHECKS_PER_YEAR,
    type_c_quota: int = TYPE_C_QUOTA,
) -> str:
    """The case type to record: the risk-derived type, raised to C to meet quota.

    The case type is normally derived from the risk score
    (:func:`case_type_for_score`). But each adviser must end the rolling year with
    ``type_c_quota`` of their ``max_checks`` as case type C. When the adviser's
    remaining slots in the year are no more than their outstanding type-C
    shortfall, this selection is forced to C so the quota is still reachable.
    """
    natural = case_type_for_score(risk_score)
    if natural == "C":
        return "C"
    done = checks_in_window(reviews, as_of)
    type_c_needed = max(0, type_c_quota - type_c_checks_in_window(reviews, as_of))
    slots_remaining = max_checks - done  # this selection fills one of them
    if 0 < slots_remaining <= type_c_needed:
        return "C"
    return natural
