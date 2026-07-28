-- generated from pipelines/complaints_b's declared TABLES at declaration rev 0040
-- description: create complaints_b/quarantine/complaints_b
-- review this file; it is applied exactly as written

CREATE TABLE "complaints_b" (
    "record_id" TEXT,
    "category" TEXT,
    "priority" TEXT,
    "failed_rule" TEXT NOT NULL,
    "logical_run_id" TEXT NOT NULL,
    "load_date" TEXT NOT NULL,
    "pipeline_run_id" TEXT
);
