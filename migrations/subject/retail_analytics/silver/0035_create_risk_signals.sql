-- generated from pipelines/retail_analytics's declared TABLES at declaration rev 0035
-- description: create retail_analytics/silver/risk_signals
-- review this file; it is applied exactly as written

CREATE TABLE risk_signals (
    signal_type TEXT,
    entity_id TEXT,
    product_id TEXT,
    detail TEXT,
    region TEXT
);
