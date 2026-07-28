-- generated from pipelines/case_selection's declared TABLES at declaration rev 0010
-- description: create case_selection/gold/selection_pool
-- review this file; it is applied exactly as written

-- NOTE: this table declares primary_key=('adviser',), which this generator
-- does not emit -- tools.schema.live diffs columns only, and this
-- table's Writer may replace the whole table on every run (Refresh /
-- AccumulateByRun), which would silently erase a migration-created
-- constraint on the very next pipeline write. Add it by hand only if
-- this table's Writer genuinely depends on it (see docs/migrations.md).

CREATE TABLE selection_pool (
    adviser TEXT,
    sale_id TEXT,
    sale_date TIMESTAMP,
    risk_score INTEGER,
    category TEXT,
    case_type TEXT,
    selected_date TIMESTAMP,
    logical_run_id TEXT NOT NULL,
    load_date TEXT NOT NULL,
    pipeline_run_id TEXT
);
