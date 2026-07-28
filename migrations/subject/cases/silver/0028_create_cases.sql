-- generated from pipelines/ingest's declared TABLES at declaration rev 0028
-- description: create cases/silver/cases
-- review this file; it is applied exactly as written

CREATE TABLE cases (
    case_ref TEXT,
    adviser TEXT,
    activity_date TIMESTAMP,
    amount INTEGER,
    logical_run_id TEXT NOT NULL,
    load_date TEXT NOT NULL,
    pipeline_run_id TEXT
);
