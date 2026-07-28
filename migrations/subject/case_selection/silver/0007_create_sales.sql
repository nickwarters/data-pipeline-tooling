-- generated from pipelines/case_selection's declared TABLES at declaration rev 0007
-- description: create case_selection/silver/sales
-- review this file; it is applied exactly as written

-- NOTE: this table declares primary_key=('sale_id',), which this generator
-- does not emit -- tools.schema.live diffs columns only, and this
-- table's Writer may replace the whole table on every run (Refresh /
-- AccumulateByRun), which would silently erase a migration-created
-- constraint on the very next pipeline write. Add it by hand only if
-- this table's Writer genuinely depends on it (see docs/migrations.md).

CREATE TABLE sales (
    sale_id TEXT,
    adviser TEXT,
    sale_date TIMESTAMP,
    risk_score INTEGER,
    category TEXT,
    product TEXT
);
