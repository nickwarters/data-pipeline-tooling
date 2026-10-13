```python
"""Schemas for the retail_analytics DAG: source types and each write terminus."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class OrderRow:
    order_id: str
    customer_id: str
    product_id: str
    qty: int
    unit_price: float
    order_date: str
    region: str
    status: str


@dataclass
class CatalogRow:
    product_id: str
    name: str
    category: str
    cost: float
    stock_qty: int


@dataclass
class RevenueRow:
    """Terminus 1: completed orders joined with active catalog for margin analysis."""

    order_id: str
    customer_id: str
    product_id: str
    product_name: str
    category: str
    qty: int
    unit_price: float
    revenue: float
    cost_of_goods: float
    margin: float
    order_date: str
    region: str


@dataclass
class RiskRow:
    """Terminus 2: cancelled orders and out-of-stock products as risk signals."""

    signal_type: str  # "cancelled_order" | "low_stock"
    entity_id: str  # order_id for cancelled; product_id for low_stock
    product_id: str
    detail: str
    region: str


@dataclass
class OpsRow:
    """Terminus 3: pending orders, period-tagged completions, and high-value orders."""

    order_id: str
    customer_id: str
    product_id: str
    qty: int
    unit_price: float
    order_date: str
    region: str
    status: str
    ops_flag: str  # "pending" | "completed" | "high_value"
    period: str  # "recent" | "historical" | "n/a"

```
