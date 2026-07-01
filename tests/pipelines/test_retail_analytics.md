```python
"""Tests for the retail_analytics DAG pipeline.

All tests go through the single ``dag_builder`` builder, exercising the full
eight-branch DAG in memory via ``given_rows`` readers and ``RecordingWriter``
sinks — no SQLite, no temp directories required.

Graph under test (abbreviated)::

    orders ─► validate ─┬─► filter_completed ─► add_margin ─► join_revenue
                        ├─► filter_completed ─► tag_period ─► stack_ops ─► write_ops
                        ├─► filter_cancelled ─► stack_risk ─► write_risk
                        ├─► filter_pending ─► stack_ops
                        └─► filter_high_value ─► stack_ops

    catalog ─► validate ┬─► filter_active ─► join_revenue
                        └─► filter_low_stock ─► stack_risk

    join_revenue ─► write_revenue   (fed by add_margin + filter_active)
"""

from __future__ import annotations

import pytest

from framework.core import ValidationError
from pipelines.retail_analytics.pipeline import (
    HIGH_VALUE_THRESHOLD,
    dag_builder,
)
from tests.framework_testing import (
    RecordingWriter,
    given_rows,
    rows_of,
)

# ── Shared fixtures ────────────────────────────────────────────────────────────

_ORDERS = [
    # Completed, not high-value (2 × 50 = 100.0, not > threshold)
    {
        "order_id": "O1",
        "customer_id": "C1",
        "product_id": "P1",
        "qty": 2,
        "unit_price": 50.0,
        "order_date": "2026-06-10",
        "region": "north",
        "status": "completed",
    },
    # Completed, high-value (1 × 250 = 250.0 > threshold), recent
    {
        "order_id": "O2",
        "customer_id": "C2",
        "product_id": "P2",
        "qty": 1,
        "unit_price": 250.0,
        "order_date": "2026-06-01",
        "region": "south",
        "status": "completed",
    },
    # Cancelled — feeds risk terminus only
    {
        "order_id": "O3",
        "customer_id": "C3",
        "product_id": "P3",
        "qty": 3,
        "unit_price": 20.0,
        "order_date": "2026-05-20",
        "region": "east",
        "status": "cancelled",
    },
    # Pending — feeds ops terminus only
    {
        "order_id": "O4",
        "customer_id": "C4",
        "product_id": "P1",
        "qty": 1,
        "unit_price": 50.0,
        "order_date": "2026-06-15",
        "region": "west",
        "status": "pending",
    },
]

_CATALOG = [
    # Active (stock_qty > 0) — feeds revenue terminus join
    {
        "product_id": "P1",
        "name": "Widget Alpha",
        "category": "Hardware",
        "cost": 25.0,
        "stock_qty": 50,
    },
    {
        "product_id": "P2",
        "name": "Gadget Beta",
        "category": "Software",
        "cost": 80.0,
        "stock_qty": 10,
    },
    # Out-of-stock — feeds risk terminus only
    {
        "product_id": "P3",
        "name": "Service Gamma",
        "category": "Services",
        "cost": 5.0,
        "stock_qty": 0,
    },
]


def _build_and_run(orders=None, catalog=None):
    """Build the DAG with three RecordingWriters; return (revenue, risk, ops)."""
    revenue_w = RecordingWriter()
    risk_w = RecordingWriter()
    ops_w = RecordingWriter()

    p = dag_builder(
        orders_reader=given_rows(orders or _ORDERS),
        catalog_reader=given_rows(catalog or _CATALOG),
        revenue_writer=revenue_w,
        risk_writer=risk_w,
        ops_writer=ops_w,
    )
    p.run()
    return revenue_w, risk_w, ops_w


# ── Happy-path: all three terminuses ──────────────────────────────────────────


def test_dag_runs_and_produces_three_writes():
    """All three RecordingWriters receive exactly one write each."""
    revenue_w, risk_w, ops_w = _build_and_run()
    assert len(revenue_w.writes) == 1, "revenue terminus received no write"
    assert len(risk_w.writes) == 1, "risk terminus received no write"
    assert len(ops_w.writes) == 1, "ops terminus received no write"


def test_revenue_terminus_joins_completed_orders_with_active_catalog():
    """Revenue rows are completed orders inner-joined with in-stock products."""
    revenue_w, _, _ = _build_and_run()
    revenue = rows_of(revenue_w)

    # Only completed orders whose product_id appears in the active catalog
    # O1→P1 (active), O2→P2 (active); O3 is cancelled, O4 is pending
    assert len(revenue) == 2

    by_order = {r["order_id"]: r for r in revenue}
    assert set(by_order) == {"O1", "O2"}

    o1 = by_order["O1"]
    assert o1["product_name"] == "Widget Alpha"
    assert o1["category"] == "Hardware"
    assert o1["revenue"] == pytest.approx(100.0)  # 2 × 50.0
    assert o1["cost_of_goods"] == pytest.approx(50.0)  # 2 × 25.0
    assert o1["margin"] == pytest.approx(50.0)  # 100.0 − 50.0

    o2 = by_order["O2"]
    assert o2["product_name"] == "Gadget Beta"
    assert o2["category"] == "Software"
    assert o2["revenue"] == pytest.approx(250.0)  # 1 × 250.0
    assert o2["cost_of_goods"] == pytest.approx(80.0)  # 1 × 80.0
    assert o2["margin"] == pytest.approx(170.0)  # 250.0 − 80.0


def test_risk_terminus_stacks_cancelled_orders_and_low_stock():
    """Risk rows combine cancelled orders and out-of-stock catalog items."""
    _, risk_w, _ = _build_and_run()
    risk = rows_of(risk_w)

    # 1 cancelled order (O3) + 1 out-of-stock product (P3)
    assert len(risk) == 2

    by_type = {}
    for r in risk:
        by_type.setdefault(r["signal_type"], []).append(r)

    assert len(by_type["cancelled_order"]) == 1
    cancelled = by_type["cancelled_order"][0]
    assert cancelled["entity_id"] == "O3"
    assert cancelled["product_id"] == "P3"
    assert cancelled["region"] == "east"

    assert len(by_type["low_stock"]) == 1
    low_stock = by_type["low_stock"][0]
    assert low_stock["entity_id"] == "P3"
    assert low_stock["product_id"] == "P3"
    assert "Service Gamma" in low_stock["detail"]
    assert low_stock["region"] == ""


def test_ops_terminus_stacks_pending_completed_and_high_value():
    """Ops rows: pending orders, period-tagged completions, high-value orders."""
    _, _, ops_w = _build_and_run()
    ops = rows_of(ops_w)

    # Pending:       O4 (1 row)
    # Period-tagged: O1, O2 completed (2 rows)
    # High-value:    O2 only (250.0 > 100.0 threshold; O1=100.0 is NOT > threshold)
    #                → 1 row with ops_flag="high_value"
    # Total: 4 rows
    assert len(ops) == 4

    flags = [r["ops_flag"] for r in ops]
    assert flags.count("pending") == 1
    assert flags.count("completed") == 2
    assert flags.count("high_value") == 1


def test_ops_pending_branch_has_correct_period():
    """Pending orders get period='n/a' (no time-window classification)."""
    _, _, ops_w = _build_and_run()
    pending_rows = [r for r in rows_of(ops_w) if r["ops_flag"] == "pending"]
    assert all(r["period"] == "n/a" for r in pending_rows)


def test_ops_completed_branch_tags_period_by_recency():
    """Completed orders are tagged 'recent' or 'historical' by RECENT_CUTOFF."""
    _, _, ops_w = _build_and_run()
    completed_rows = {
        r["order_id"]: r for r in rows_of(ops_w) if r["ops_flag"] == "completed"
    }

    # Both O1 (2026-06-10) and O2 (2026-06-01) are >= RECENT_CUTOFF (2026-05-26)
    assert completed_rows["O1"]["period"] == "recent"
    assert completed_rows["O2"]["period"] == "recent"


def test_ops_completed_historical_period():
    """Orders before RECENT_CUTOFF are tagged 'historical'."""
    orders = [
        {
            "order_id": "OLD1",
            "customer_id": "C1",
            "product_id": "P1",
            "qty": 1,
            "unit_price": 10.0,
            "order_date": "2026-04-01",  # before RECENT_CUTOFF
            "region": "north",
            "status": "completed",
        }
    ]
    catalog = [
        {
            "product_id": "P1",
            "name": "Widget",
            "category": "Hardware",
            "cost": 5.0,
            "stock_qty": 10,
        }
    ]
    _, _, ops_w = _build_and_run(orders=orders, catalog=catalog)
    completed_rows = [r for r in rows_of(ops_w) if r["ops_flag"] == "completed"]
    assert len(completed_rows) == 1
    assert completed_rows[0]["period"] == "historical"


def test_high_value_threshold_is_exclusive():
    """An order exactly at the threshold is NOT high-value (strictly greater-than)."""
    orders = [
        {
            "order_id": "EXACT",
            "customer_id": "C1",
            "product_id": "P1",
            "qty": 1,
            "unit_price": HIGH_VALUE_THRESHOLD,  # exactly at the threshold
            "order_date": "2026-06-01",
            "region": "north",
            "status": "pending",
        }
    ]
    catalog = [
        {
            "product_id": "P1",
            "name": "Widget",
            "category": "Hardware",
            "cost": 5.0,
            "stock_qty": 10,
        }
    ]
    _, _, ops_w = _build_and_run(orders=orders, catalog=catalog)
    high_value_rows = [r for r in rows_of(ops_w) if r["ops_flag"] == "high_value"]
    assert len(high_value_rows) == 0


def test_revenue_excludes_orders_for_out_of_stock_products():
    """Out-of-stock completed orders do not appear in the revenue terminus."""
    orders = [
        {
            "order_id": "O_OOS",
            "customer_id": "C1",
            "product_id": "P_OOS",
            "qty": 1,
            "unit_price": 50.0,
            "order_date": "2026-06-01",
            "region": "north",
            "status": "completed",
        }
    ]
    catalog = [
        {
            "product_id": "P_OOS",
            "name": "Gone",
            "category": "Hardware",
            "cost": 20.0,
            "stock_qty": 0,
        }
    ]
    revenue_w, risk_w, _ = _build_and_run(orders=orders, catalog=catalog)
    assert len(rows_of(revenue_w)) == 0
    # The out-of-stock product still appears in the risk terminus
    risk = rows_of(risk_w)
    low_stock = [r for r in risk if r["signal_type"] == "low_stock"]
    assert len(low_stock) == 1


# ── Column validation guards ───────────────────────────────────────────────────


def test_dag_builder_gates_missing_order_columns():
    """Missing a required order column aborts before any write."""
    revenue_w, risk_w, ops_w = RecordingWriter(), RecordingWriter(), RecordingWriter()

    p = dag_builder(
        orders_reader=given_rows(
            [{"order_id": "O1", "customer_id": "C1"}]
        ),  # missing columns
        catalog_reader=given_rows(_CATALOG),
        revenue_writer=revenue_w,
        risk_writer=risk_w,
        ops_writer=ops_w,
    )

    with pytest.raises(ValidationError, match="missing required column"):
        p.run()

    assert len(revenue_w.writes) == 0
    assert len(risk_w.writes) == 0
    assert len(ops_w.writes) == 0


def test_dag_builder_gates_missing_catalog_columns():
    """Missing a required catalog column aborts before any write."""
    revenue_w, risk_w, ops_w = RecordingWriter(), RecordingWriter(), RecordingWriter()

    p = dag_builder(
        orders_reader=given_rows(_ORDERS),
        catalog_reader=given_rows([{"product_id": "P1"}]),  # missing columns
        revenue_writer=revenue_w,
        risk_writer=risk_w,
        ops_writer=ops_w,
    )

    with pytest.raises(ValidationError, match="missing required column"):
        p.run()

    assert len(revenue_w.writes) == 0

```
