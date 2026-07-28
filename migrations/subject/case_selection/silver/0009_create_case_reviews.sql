-- generated from pipelines/case_selection's declared TABLES at declaration rev 0009
-- description: create case_selection/silver/case_reviews
-- review this file; it is applied exactly as written

-- NOTE: this table declares primary_key=('case_id',), which this generator
-- does not emit -- tools.schema.live diffs columns only, and this
-- table's Writer may replace the whole table on every run (Refresh /
-- AccumulateByRun), which would silently erase a migration-created
-- constraint on the very next pipeline write. Add it by hand only if
-- this table's Writer genuinely depends on it (see docs/migrations.md).

CREATE TABLE case_reviews (
    case_id TEXT,
    adviser TEXT,
    case_type TEXT,
    status TEXT,
    outcome TEXT,
    selected_date TIMESTAMP,
    completed_date TIMESTAMP
);
