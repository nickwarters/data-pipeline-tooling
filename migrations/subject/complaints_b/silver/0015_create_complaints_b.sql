-- generated from pipelines/complaints_b's declared TABLES at declaration rev 0015
-- description: create complaints_b/silver/complaints_b
-- review this file; it is applied exactly as written

-- NOTE: this table declares primary_key=('record_id',), which this generator
-- does not emit -- tools.schema.live diffs columns only, and this
-- table's Writer may replace the whole table on every run (Refresh /
-- AccumulateByRun), which would silently erase a migration-created
-- constraint on the very next pipeline write. Add it by hand only if
-- this table's Writer genuinely depends on it (see docs/migrations.md).

CREATE TABLE complaints_b (
    record_id TEXT,
    category TEXT,
    priority TEXT,
    logical_run_id TEXT NOT NULL,
    load_date TEXT NOT NULL,
    pipeline_run_id TEXT
);
