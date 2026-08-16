-- Baseline for reviewer_activity/gold.
--
-- Copied by scripts/generate_baseline_migrations.py out of a real run's
-- database: these are that database's own CREATE statements, not a
-- reconstruction of them. Maintained by hand from here — this file's
-- checksum is recorded when it is applied, so a shape change is a new
-- numbered migration rather than an edit to this one.

CREATE TABLE "reviewer_activity_daily" (
"reviewer_account" TEXT,
  "reportable_date" DATE,
  "case_type" TEXT,
  "count" INTEGER,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);
