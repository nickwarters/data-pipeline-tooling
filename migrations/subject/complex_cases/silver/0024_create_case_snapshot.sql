-- generated from pipelines/comprehensive_examples's declared TABLES at declaration rev 0024
-- description: create complex_cases/silver/case_snapshot
-- review this file; it is applied exactly as written

-- NOTE: this table declares primary_key=('case_ref',), which this generator
-- does not emit -- tools.schema.live diffs columns only, and this
-- table's Writer may replace the whole table on every run (Refresh /
-- AccumulateByRun), which would silently erase a migration-created
-- constraint on the very next pipeline write. Add it by hand only if
-- this table's Writer genuinely depends on it (see docs/migrations.md).

CREATE TABLE case_snapshot (
    case_ref TEXT,
    customer_id TEXT,
    adviser_id TEXT,
    opened_date TIMESTAMP,
    risk_band TEXT,
    vulnerable_flag INTEGER,
    exposure_amount INTEGER,
    account_status TEXT,
    last_review_date TIMESTAMP,
    region TEXT,
    team TEXT,
    open_contact_count INTEGER,
    active_flag INTEGER
);
