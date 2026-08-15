-- Baseline for reviewer_activity/gold.
--
-- Generated once by scripts/generate_baseline_migrations.py from a real
-- run's database, and maintained by hand from here: this file's checksum
-- is recorded when it is applied, so a shape change is a new numbered
-- migration rather than an edit to this one.

CREATE TABLE "reviewer_activity_daily" (
    "reviewer_account" TEXT,
    "reportable_date" DATE,
    "case_type" TEXT,
    "count" INTEGER,
    "as_of_utc" TEXT,
    "pipeline_run_id" TEXT
);
