-- generated from pipelines/ref_lookup's declared TABLES at declaration rev 0030
-- description: create ref_lookup/raw/source
-- review this file; it is applied exactly as written

CREATE TABLE source (
    brand TEXT,
    channel TEXT,
    case_ref TEXT,
    cust_ref TEXT,
    case_cat_1 TEXT,
    case_cat_2 TEXT,
    case_cat_3 TEXT,
    logical_run_id TEXT NOT NULL,
    load_date TEXT NOT NULL,
    pipeline_run_id TEXT
);
