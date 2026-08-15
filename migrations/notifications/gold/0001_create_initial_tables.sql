-- Baseline for notifications/gold.
--
-- Generated once by scripts/generate_baseline_migrations.py from a real
-- run's database, and maintained by hand from here: this file's checksum
-- is recorded when it is applied, so a shape change is a new numbered
-- migration rather than an edit to this one.

CREATE TABLE "notified" (
    "case_id" TEXT,
    "recipient" TEXT,
    "message_at" TEXT,
    "pipeline_run_id" TEXT
);
