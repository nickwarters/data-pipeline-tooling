-- generated from pipelines/selection's declared TABLES at declaration rev 0037
-- description: create cases/gold/selection_pool
-- review this file; it is applied exactly as written

-- NOTE: this table declares primary_key=('case_id',), which this generator
-- does not emit -- tools.schema.live diffs columns only, and this
-- table's Writer may replace the whole table on every run (Refresh /
-- AccumulateByRun), which would silently erase a migration-created
-- constraint on the very next pipeline write. Add it by hand only if
-- this table's Writer genuinely depends on it (see docs/migrations.md).

CREATE TABLE selection_pool (
    case_ref TEXT,
    adviser TEXT,
    activity_date TIMESTAMP,
    amount INTEGER,
    case_id TEXT NOT NULL,
    priority_score INTEGER NOT NULL,
    question_bank_id TEXT NOT NULL,
    logical_run_id TEXT NOT NULL,
    load_date TEXT NOT NULL,
    pipeline_run_id TEXT
);
