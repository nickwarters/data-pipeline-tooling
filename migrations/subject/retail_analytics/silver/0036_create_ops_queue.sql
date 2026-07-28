-- generated from pipelines/retail_analytics's declared TABLES at declaration rev 0036
-- description: create retail_analytics/silver/ops_queue
-- review this file; it is applied exactly as written

CREATE TABLE ops_queue (
    order_id TEXT,
    customer_id TEXT,
    product_id TEXT,
    qty INTEGER,
    unit_price REAL,
    order_date TEXT,
    region TEXT,
    status TEXT,
    ops_flag TEXT,
    period TEXT
);
