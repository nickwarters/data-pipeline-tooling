-- generated from pipelines/complaints_c's declared TABLES at declaration rev 0041
-- description: create complaints_c/quarantine/complaints_c
-- review this file; it is applied exactly as written

CREATE TABLE "complaints_c" (
    "record_id" TEXT,
    "department" TEXT,
    "resolution_days" INTEGER,
    "failed_rule" TEXT NOT NULL,
    "logical_run_id" TEXT NOT NULL,
    "load_date" TEXT NOT NULL,
    "pipeline_run_id" TEXT
);
