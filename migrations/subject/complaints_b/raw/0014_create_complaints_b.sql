-- generated from pipelines/complaints_b's declared TABLES at declaration rev 0014
-- description: create complaints_b/raw/complaints_b
-- review this file; it is applied exactly as written

CREATE TABLE complaints_b (
    record_id TEXT,
    category TEXT,
    priority TEXT,
    logical_run_id TEXT NOT NULL,
    load_date TEXT NOT NULL,
    pipeline_run_id TEXT
);
