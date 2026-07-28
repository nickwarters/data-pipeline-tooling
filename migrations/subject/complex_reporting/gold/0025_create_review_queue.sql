-- generated from pipelines/comprehensive_examples's declared TABLES at declaration rev 0025
-- description: create complex_reporting/gold/review_queue
-- review this file; it is applied exactly as written

-- NOTE: this table declares primary_key=('case_ref',), which this generator
-- does not emit -- tools.schema.live diffs columns only, and this
-- table's Writer may replace the whole table on every run (Refresh /
-- AccumulateByRun), which would silently erase a migration-created
-- constraint on the very next pipeline write. Add it by hand only if
-- this table's Writer genuinely depends on it (see docs/migrations.md).

CREATE TABLE review_queue (
    case_ref TEXT,
    customer_id TEXT,
    adviser_id TEXT,
    opened_date TEXT,
    risk_band TEXT,
    vulnerable_flag INTEGER,
    exposure_amount INTEGER,
    account_status TEXT,
    last_review_date TEXT,
    region TEXT,
    team TEXT,
    open_contact_count INTEGER,
    active_flag INTEGER,
    review_priority INTEGER NOT NULL,
    logical_run_id TEXT NOT NULL,
    load_date TEXT NOT NULL
);
