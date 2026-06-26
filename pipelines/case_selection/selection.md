```python
"""The selection algorithm: sales + case-review history -> the SelectionPool.

The criteria are cross-row and stateful (one row per adviser, highest-risk sale,
rolling-year quotas and cooldowns), so this is one orchestrating pure function
over plain row ``dict``s — :func:`select_cases` — wrapped by a thin framework
:class:`~framework.core.protocols.Processor`, :class:`SelectCasesToCheck`, that
adapts it across the :class:`~framework.core.dataset.Dataset` seam.

Keeping the decision in :func:`select_cases` (and the gates in
:mod:`pipelines.case_selection.rules`) means the whole policy is testable with
in-memory rows and no pandas. The processor only parses the round-trip-lossy date
columns and re-frames the result.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any, Mapping, Sequence

import pandas as pd

from framework.core import Dataset

from .rules import assign_case_type, best_sale, exclusion_reason, is_recent_sale

Row = Mapping[str, Any]

# The deliverable's columns, fixed so an empty SelectionPool still has shape.
POOL_COLUMNS = [
    "adviser",
    "sale_id",
    "sale_date",
    "risk_score",
    "category",
    "case_type",
    "selected_date",
]
# The sibling trace: one row per *considered* adviser, with the verdict + reason.
TRACE_COLUMNS = ["adviser", "verdict", "reason", "sale_id", "risk_score", "case_type"]


def select_cases(
    sales: Sequence[Row],
    reviews: Sequence[Row],
    as_of: date,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Choose at most one Case to check per adviser; return ``(pool, trace)``.

    The considered population is every adviser with a sale in the last 15 days.
    For each, the adviser's review history either excludes them (with a reason)
    or their highest-risk recent sale is selected and assigned a case type. The
    pool is ordered highest-risk first so a downstream "top N" reads cleanly.
    """
    reviews_by_adviser: dict[str, list[Row]] = defaultdict(list)
    for review in reviews:
        reviews_by_adviser[review["adviser"]].append(review)

    # All of an adviser's sales (not just recent ones) — the full history feeds
    # the active-month / pro-rata capacity arithmetic; recency only picks the
    # candidate sale.
    sales_by_adviser: dict[str, list[Row]] = defaultdict(list)
    for sale in sales:
        sales_by_adviser[sale["adviser"]].append(sale)

    pool: list[dict[str, Any]] = []
    trace: list[dict[str, Any]] = []
    for adviser in sorted(sales_by_adviser):
        adviser_sales = sales_by_adviser[adviser]
        recent = [s for s in adviser_sales if is_recent_sale(s["sale_date"], as_of)]
        if not recent:
            continue  # no sale in the last 15 days -> not a candidate
        adviser_reviews = reviews_by_adviser.get(adviser, [])
        sale = best_sale(recent)

        reason = exclusion_reason(adviser_reviews, adviser_sales, as_of)
        if reason is not None:
            trace.append(
                {
                    "adviser": adviser,
                    "verdict": "excluded",
                    "reason": reason,
                    "sale_id": sale["sale_id"],
                    "risk_score": int(sale["risk_score"]),
                    "case_type": "",
                }
            )
            continue

        case_type = assign_case_type(
            int(sale["risk_score"]), adviser_reviews, adviser_sales, as_of
        )
        pool.append(
            {
                "adviser": adviser,
                "sale_id": sale["sale_id"],
                "sale_date": sale["sale_date"],
                "risk_score": int(sale["risk_score"]),
                "category": sale["category"],
                "case_type": case_type,
                "selected_date": as_of,
            }
        )
        trace.append(
            {
                "adviser": adviser,
                "verdict": "selected",
                "reason": f"highest-risk recent sale -> case type {case_type}",
                "sale_id": sale["sale_id"],
                "risk_score": int(sale["risk_score"]),
                "case_type": case_type,
            }
        )

    pool.sort(key=lambda r: (-r["risk_score"], r["adviser"]))
    return pool, trace


def _parsed_rows(
    frame: "pd.DataFrame", *, date_columns: Sequence[str]
) -> list[dict[str, Any]]:
    """Frame -> row dicts with the named date columns parsed to ``date``/``None``.

    Silver stores dates as text (a SQLite round-trip), so the columns come back as
    strings; parse them once here, behind the seam, before the pure rules see
    them. A blank (an in-progress review's ``completed_date``) becomes ``None``.
    """
    frame = frame.copy()
    present = [column for column in date_columns if column in frame.columns]
    for column in present:
        frame[column] = pd.to_datetime(frame[column], errors="coerce")
    rows: list[dict[str, Any]] = []
    for record in frame.to_dict("records"):
        for column in present:
            value = record[column]
            record[column] = None if pd.isna(value) else value.date()
        rows.append(record)
    return rows


class SelectCasesToCheck:
    """Processor: narrow the sales feed to the SelectionPool, using review history.

    Reads the case-review history from an explicit read-only ``reviews_reader``
    (the same dependency shape as a join), runs :func:`select_cases`, and returns
    the SelectionPool dataset. The per-adviser **trace** is a side output exposed
    on :attr:`trace` after the call, so the pipeline can land it alongside.
    """

    def __init__(self, reviews_reader: Any, as_of: date) -> None:
        self._reviews_reader = reviews_reader
        self._as_of = as_of
        self.trace: list[dict[str, Any]] = []

    def __call__(self, dataset: Dataset) -> Dataset:
        sales = _parsed_rows(dataset.to_pandas(), date_columns=["sale_date"])
        reviews = _parsed_rows(
            self._reviews_reader.read().to_pandas(),
            date_columns=["selected_date", "completed_date"],
        )
        pool, self.trace = select_cases(sales, reviews, self._as_of)
        return Dataset.from_pandas(pd.DataFrame(pool, columns=POOL_COLUMNS))

    def trace_dataset(self) -> Dataset:
        """The trace captured by the last call, as a ``Dataset`` ready to write."""
        return Dataset.from_pandas(pd.DataFrame(self.trace, columns=TRACE_COLUMNS))

```
