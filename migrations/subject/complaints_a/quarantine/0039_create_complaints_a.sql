-- generated from pipelines/complaints_a's declared TABLES at declaration rev 0039
-- description: create complaints_a/quarantine/complaints_a
-- review this file; it is applied exactly as written

CREATE TABLE "complaints_a" (
    "record_id" TEXT,
    "label" TEXT,
    "amount" INTEGER,
    "failed_rule" TEXT NOT NULL,
    "logical_run_id" TEXT NOT NULL,
    "load_date" TEXT NOT NULL,
    "pipeline_run_id" TEXT
);
