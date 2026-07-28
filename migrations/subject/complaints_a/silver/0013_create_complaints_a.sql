-- generated from pipelines/complaints_a's declared TABLES at declaration rev 0013
-- description: create complaints_a/silver/complaints_a
-- review this file; it is applied exactly as written

-- NOTE: this table declares primary_key=('record_id',), which this generator
-- does not emit -- tools.schema.live diffs columns only, and this
-- table's Writer may replace the whole table on every run (Refresh /
-- AccumulateByRun), which would silently erase a migration-created
-- constraint on the very next pipeline write. Add it by hand only if
-- this table's Writer genuinely depends on it (see docs/migrations.md).

CREATE TABLE complaints_a (
    record_id TEXT,
    label TEXT,
    amount INTEGER,
    logical_run_id TEXT NOT NULL,
    load_date TEXT NOT NULL,
    pipeline_run_id TEXT
);
