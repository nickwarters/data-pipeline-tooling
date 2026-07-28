-- generated from pipelines/selection's declared TABLES at declaration rev 0038
-- description: create cases/gold/selection_trace
-- review this file; it is applied exactly as written

-- NOTE: this table declares primary_key=('case_ref',), which this generator
-- does not emit -- tools.schema.live diffs columns only, and this
-- table's Writer may replace the whole table on every run (Refresh /
-- AccumulateByRun), which would silently erase a migration-created
-- constraint on the very next pipeline write. Add it by hand only if
-- this table's Writer genuinely depends on it (see docs/migrations.md).

CREATE TABLE selection_trace (
    case_ref TEXT,
    verdict TEXT,
    reason TEXT,
    rank REAL,
    score INTEGER,
    logical_run_id TEXT NOT NULL,
    load_date TEXT NOT NULL,
    pipeline_run_id TEXT
);
