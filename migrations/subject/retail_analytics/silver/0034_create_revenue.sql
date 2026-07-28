-- generated from pipelines/retail_analytics's declared TABLES at declaration rev 0034
-- description: create retail_analytics/silver/revenue
-- review this file; it is applied exactly as written

-- NOTE: this table declares primary_key=('order_id',), which this generator
-- does not emit -- tools.schema.live diffs columns only, and this
-- table's Writer may replace the whole table on every run (Refresh /
-- AccumulateByRun), which would silently erase a migration-created
-- constraint on the very next pipeline write. Add it by hand only if
-- this table's Writer genuinely depends on it (see docs/migrations.md).

CREATE TABLE revenue (
    order_id TEXT,
    customer_id TEXT,
    product_id TEXT,
    product_name TEXT,
    category TEXT,
    qty INTEGER,
    unit_price REAL,
    revenue REAL,
    cost_of_goods REAL,
    margin REAL,
    order_date TEXT,
    region TEXT
);
