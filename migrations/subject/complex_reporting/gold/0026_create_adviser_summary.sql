-- generated from pipelines/comprehensive_examples's declared TABLES at declaration rev 0026
-- description: create complex_reporting/gold/adviser_summary
-- review this file; it is applied exactly as written

-- NOTE: this table declares primary_key=('adviser_id', 'region'), which this generator
-- does not emit -- tools.schema.live diffs columns only, and this
-- table's Writer may replace the whole table on every run (Refresh /
-- AccumulateByRun), which would silently erase a migration-created
-- constraint on the very next pipeline write. Add it by hand only if
-- this table's Writer genuinely depends on it (see docs/migrations.md).

CREATE TABLE adviser_summary (
    adviser_id TEXT NOT NULL,
    region TEXT NOT NULL,
    selected_cases INTEGER NOT NULL,
    total_exposure INTEGER NOT NULL,
    total_open_contacts INTEGER NOT NULL,
    logical_run_id TEXT NOT NULL,
    load_date TEXT NOT NULL
);
