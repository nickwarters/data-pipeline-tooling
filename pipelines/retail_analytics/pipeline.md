```python
"""Retail analytics DAG: orders + catalog → revenue / risk_signals / ops_queue (silver).

One ``dag_builder`` composes a single ``Pipeline`` whose execution graph fans out
to **eight concurrent data streams** and then converges to **three write terminuses**
in a single ``p.run()``.  The graph is intentionally non-linear: two independent
sources branch in different directions and reconverge via distinct fan-ins.

Execution graph (simplified)::

                              ┌─► filter_completed ─┬─► add_margin ──────────────────────────┐
                              │                      └─► tag_period ──────────────────────────┤
    orders ──► validate ──────┼─► filter_cancelled ────────────────────────────────────────── ┤
                              ├─► filter_pending ──────────────────────────────────────────── ┤
                              └─► filter_high_value ──────────────────────────────────────── ─┤
                                                                                               │
                              ┌─► filter_active ──────────────────────────────────────────── ─┤
    catalog ──► validate ─────┤                                                                │
                              └─► filter_low_stock ──────────────────────────────────────── ──┤
                                                                                               │
         ┌─ join(add_margin, filter_active) ──► coerce ──► validate ──► write_revenue  ◄──────┤
         ├─ stack(filter_cancelled, filter_low_stock) ──► coerce ──► validate ──► write_risk  ┤
         └─ stack(filter_pending, tag_period, filter_high_value) ──► coerce ──► validate ──► write_ops

The eight peak-width branches are::

    1. filter_completed   — from orders, status == completed
    2. filter_cancelled   — from orders, status == cancelled  → risk terminus
    3. filter_pending     — from orders, status == pending    → ops terminus
    4. filter_high_value  — from orders, value > threshold   → ops terminus
    5. add_margin         — from filter_completed, adds revenue column → revenue terminus
    6. tag_period         — from filter_completed, adds recent/historical tag → ops terminus
    7. filter_active      — from catalog, stock_qty > 0      → revenue terminus
    8. filter_low_stock   — from catalog, stock_qty == 0     → risk terminus

Run from the repo root::

    python -m pipelines.retail_analytics.pipeline [BASE_DIR]

or via the CLI::

    python -m cli run pipelines/retail_analytics [BASE_DIR]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from framework.core import (
    ColumnValidator,
    Dataset,
    PipelineError,
    SchemaValidator,
    format_failure,
)
from framework.io import CsvReader, Reader, Refresh, Writer
from framework.run import Pipeline, RunContext, RunLog
from framework.transform import Filter, SchemaCoercion
from tools.medallion import medallion
from tools.store import StoreRegistry

from .schema import CatalogRow, OpsRow, OrderRow, RevenueRow, RiskRow

FEED_NAME = "retail_analytics"
ORDERS_CSV = Path(__file__).parent / "sample_data" / "orders.csv"
CATALOG_CSV = Path(__file__).parent / "sample_data" / "catalog.csv"

HIGH_VALUE_THRESHOLD = 100.0
RECENT_CUTOFF = "2026-05-26"  # 30-day lookback relative to the example run date

UPSTREAMS = ()

_ORDER_COLUMNS = [f.name for f in OrderRow.__dataclass_fields__.values()]
_CATALOG_COLUMNS = [f.name for f in CatalogRow.__dataclass_fields__.values()]


# ── Fan-in processors (multiple Dataset inputs → one Dataset output) ──────────


def _add_margin(dataset: Dataset) -> Dataset:
    """Add a ``revenue`` column (qty × unit_price) to completed-order rows."""
    df = dataset.to_pandas()
    df["revenue"] = df["qty"] * df["unit_price"]
    return Dataset.from_pandas(df)


def _tag_period(dataset: Dataset) -> Dataset:
    """Add a ``period`` column: 'recent' if order_date >= RECENT_CUTOFF, else 'historical'."""
    df = dataset.to_pandas()
    df["period"] = df["order_date"].apply(
        lambda d: "recent" if str(d) >= RECENT_CUTOFF else "historical"
    )
    return Dataset.from_pandas(df)


def _join_orders_with_catalog(margin_ds: Dataset, catalog_ds: Dataset) -> Dataset:
    """Fan-in: inner-join margin-enriched completed orders with active catalog.

    Produces ``RevenueRow`` columns: adds ``product_name``, ``category``,
    ``cost_of_goods`` (qty × cost), and ``margin`` (revenue − cost_of_goods).
    Drops any order whose product_id is absent from the active catalog.
    """

    orders = margin_ds.to_pandas()
    catalog = catalog_ds.to_pandas()

    enriched_catalog = catalog[["product_id", "name", "category", "cost"]].rename(
        columns={"name": "product_name"}
    )
    merged = orders.merge(enriched_catalog, on="product_id", how="inner")
    merged["cost_of_goods"] = merged["qty"] * merged["cost"]
    merged["margin"] = merged["revenue"] - merged["cost_of_goods"]

    revenue_cols = [f.name for f in RevenueRow.__dataclass_fields__.values()]
    return Dataset.from_pandas(merged[revenue_cols])


def _stack_risk_signals(cancelled_ds: Dataset, low_stock_ds: Dataset) -> Dataset:
    """Fan-in: unify cancelled orders and out-of-stock products as risk signals.

    Produces ``RiskRow`` columns with a ``signal_type`` discriminator:
    cancelled orders become ``'cancelled_order'``; out-of-stock catalog items
    become ``'low_stock'``.
    """
    import pandas as pd

    cancelled = cancelled_ds.to_pandas()
    low_stock = low_stock_ds.to_pandas()

    # Build rows explicitly so string columns stay str-typed even when empty.
    rows: list[dict] = []
    for _, row in cancelled.iterrows():
        rows.append(
            {
                "signal_type": "cancelled_order",
                "entity_id": str(row["order_id"]),
                "product_id": str(row["product_id"]),
                "detail": "Order cancelled by customer",
                "region": str(row["region"]),
            }
        )
    for _, row in low_stock.iterrows():
        rows.append(
            {
                "signal_type": "low_stock",
                "entity_id": str(row["product_id"]),
                "product_id": str(row["product_id"]),
                "detail": f"Product out of stock: {row['name']}",
                "region": "",
            }
        )

    risk_cols = [f.name for f in RiskRow.__dataclass_fields__.values()]
    if rows:
        combined = pd.DataFrame(rows)[risk_cols]
    else:
        combined = pd.DataFrame(columns=risk_cols)

    return Dataset.from_pandas(combined)


def _stack_ops_queue(
    pending_ds: Dataset, period_ds: Dataset, high_value_ds: Dataset
) -> Dataset:
    """Fan-in: stack pending orders, period-tagged completions, and high-value orders.

    All three streams are given an ``ops_flag`` and a ``period`` column so the
    combined ops queue is self-describing.  Produces ``OpsRow`` columns.
    """
    import pandas as pd

    base_cols = [
        "order_id",
        "customer_id",
        "product_id",
        "qty",
        "unit_price",
        "order_date",
        "region",
        "status",
    ]

    pending = pending_ds.to_pandas()[base_cols].copy()
    pending["ops_flag"] = "pending"
    pending["period"] = "n/a"

    period = period_ds.to_pandas()[base_cols + ["period"]].copy()
    period["ops_flag"] = "completed"

    high_value = high_value_ds.to_pandas()[base_cols].copy()
    high_value["ops_flag"] = "high_value"
    high_value["period"] = "n/a"

    all_cols = base_cols + ["ops_flag", "period"]
    combined = pd.concat(
        [pending[all_cols], period[all_cols], high_value[all_cols]],
        ignore_index=True,
    )
    return Dataset.from_pandas(combined)


# ── The single DAG builder ────────────────────────────────────────────────────


def dag_builder(
    orders_reader: Reader,
    catalog_reader: Reader,
    revenue_writer: Writer,
    risk_writer: Writer,
    ops_writer: Writer,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the retail analytics DAG: two sources → eight branches → three terminuses.

    The returned ``Pipeline`` is fully wired but not yet executed; call
    ``.run()`` to materialise all three write terminuses in one pass.  Inject
    ``given_rows`` readers and ``RecordingWriter`` sinks in tests to exercise
    the whole graph in memory.
    """
    p = Pipeline(f"{FEED_NAME}:dag", run_log=run_log)

    # ── TWO SOURCES ───────────────────────────────────────────────────────────
    n_orders = p.read(orders_reader, name="read_orders")
    n_catalog = p.read(catalog_reader, name="read_catalog")

    # ── SOURCE VALIDATION ─────────────────────────────────────────────────────
    n_orders_val = p.validate(
        ColumnValidator(_ORDER_COLUMNS), n_orders, name="validate_orders"
    )
    n_catalog_val = p.validate(
        ColumnValidator(_CATALOG_COLUMNS), n_catalog, name="validate_catalog"
    )

    # ── FAN-OUT FROM ORDERS (four branches) ───────────────────────────────────
    #   Branch 1: completed orders — further splits into add_margin + tag_period
    n_completed = p.transform(
        Filter(lambda r: r["status"] == "completed"),
        n_orders_val,
        name="filter_completed",
    )
    #   Branch 2: cancelled orders → risk terminus
    n_cancelled = p.transform(
        Filter(lambda r: r["status"] == "cancelled"),
        n_orders_val,
        name="filter_cancelled",
    )
    #   Branch 3: pending orders → ops terminus
    n_pending = p.transform(
        Filter(lambda r: r["status"] == "pending"),
        n_orders_val,
        name="filter_pending",
    )
    #   Branch 4: high-value orders (any status) → ops terminus
    n_high_value = p.transform(
        Filter(lambda r: r["qty"] * r["unit_price"] > HIGH_VALUE_THRESHOLD),
        n_orders_val,
        name="filter_high_value",
    )

    # ── FURTHER FAN-OUT FROM n_completed (two more branches) ─────────────────
    #   Branch 5: add revenue column for the margin join → revenue terminus
    n_margin = p.transform(_add_margin, n_completed, name="add_margin")
    #   Branch 6: tag by recency period → ops terminus
    n_period_tagged = p.transform(_tag_period, n_completed, name="tag_period")

    # ── FAN-OUT FROM CATALOG (two branches) ───────────────────────────────────
    #   Branch 7: in-stock products → revenue terminus (join with completed orders)
    n_active = p.transform(
        Filter(lambda r: r["stock_qty"] > 0),
        n_catalog_val,
        name="filter_active",
    )
    #   Branch 8: out-of-stock products → risk terminus
    n_low_stock = p.transform(
        Filter(lambda r: r["stock_qty"] == 0),
        n_catalog_val,
        name="filter_low_stock",
    )

    # ── FAN-IN: TERMINUS 1 — revenue report ───────────────────────────────────
    # Branches 5 + 7 converge: completed-order revenue × active-catalog margin.
    n_revenue_joined = p.transform(
        _join_orders_with_catalog, n_margin, n_active, name="join_revenue"
    )
    n_revenue_coerced = p.transform(
        SchemaCoercion(RevenueRow), n_revenue_joined, name="coerce_revenue"
    )
    n_revenue_valid = p.validate(
        SchemaValidator(RevenueRow), n_revenue_coerced, name="validate_revenue"
    )
    p.write(revenue_writer, n_revenue_valid, name="write_revenue")

    # ── FAN-IN: TERMINUS 2 — risk signals ─────────────────────────────────────
    # Branches 2 + 8 converge: cancelled orders + out-of-stock products.
    n_risk_stacked = p.transform(
        _stack_risk_signals, n_cancelled, n_low_stock, name="stack_risk_signals"
    )
    n_risk_coerced = p.transform(
        SchemaCoercion(RiskRow), n_risk_stacked, name="coerce_risk"
    )
    n_risk_valid = p.validate(
        SchemaValidator(RiskRow), n_risk_coerced, name="validate_risk"
    )
    p.write(risk_writer, n_risk_valid, name="write_risk")

    # ── FAN-IN: TERMINUS 3 — operations queue ─────────────────────────────────
    # Branches 3 + 6 + 4 converge: pending + period-tagged completions + high-value.
    n_ops_stacked = p.transform(
        _stack_ops_queue, n_pending, n_period_tagged, n_high_value, name="stack_ops"
    )
    n_ops_coerced = p.transform(
        SchemaCoercion(OpsRow), n_ops_stacked, name="coerce_ops"
    )
    n_ops_valid = p.validate(
        SchemaValidator(OpsRow), n_ops_coerced, name="validate_ops"
    )
    p.write(ops_writer, n_ops_valid, name="write_ops")

    return p


# ── Orchestration ─────────────────────────────────────────────────────────────


def run(context: RunContext, *, describe: bool = False) -> list[Dataset]:
    """Execute the retail analytics DAG, writing three silver tables under *base_dir*."""
    med = medallion(StoreRegistry(context.base_dir), FEED_NAME)
    strategy = Refresh()

    p = dag_builder(
        orders_reader=CsvReader(ORDERS_CSV),
        catalog_reader=CsvReader(CATALOG_CSV),
        revenue_writer=med.silver.writer("revenue", strategy),
        risk_writer=med.silver.writer("risk_signals", strategy),
        ops_writer=med.silver.writer("ops_queue", strategy),
        run_log=context.run_log,
    )
    if describe:
        print(p.describe())
    result = p.run()
    return result if isinstance(result, list) else [result]


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m pipelines.retail_analytics.pipeline",
        description="Retail analytics DAG: orders + catalog → revenue / risk / ops.",
    )
    parser.add_argument(
        "base_dir",
        nargs="?",
        default=None,
        help="medallion root directory (default: ./data)",
    )
    parser.add_argument(
        "--describe",
        action="store_true",
        help="print the DAG plan before running",
    )
    args = parser.parse_args(argv[1:])
    base_dir = Path(args.base_dir) if args.base_dir else Path.cwd() / "data"

    from framework.run import PipelineRunner

    def handler(ctx: RunContext) -> list[Dataset]:
        return run(ctx, describe=args.describe)

    runner = PipelineRunner()
    runner.register(
        subject="",
        pipeline=FEED_NAME,
        handler=handler,
        freshness=UPSTREAMS,
    )

    try:
        runner.run("", FEED_NAME, base_dir=base_dir)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1

    print(
        f"Retail analytics DAG wrote revenue, risk_signals, and ops_queue under {base_dir / FEED_NAME}"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))

```
