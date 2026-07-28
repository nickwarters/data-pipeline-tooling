-- generated from pipelines/ingest's declared TABLES at declaration rev 0027
-- description: create cases/raw/cases
-- review this file; it is applied exactly as written

-- NOTE: raw is meant to be TEXT throughout (docs/schema-declaration.md);
-- the non-TEXT column(s) below reflect this repo's dtype-inferring
-- CsvReader, not the design intent. Do not read this file as declaring
-- that raw should be typed -- the fix belongs upstream, in the reader.

CREATE TABLE cases (
    case_ref TEXT,
    adviser TEXT,
    activity_date TEXT,
    amount INTEGER,
    logical_run_id TEXT NOT NULL,
    load_date TEXT NOT NULL,
    pipeline_run_id TEXT
);
