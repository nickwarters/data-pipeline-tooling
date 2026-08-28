-- Baseline for pipeline_run_metric/gold.
--
-- Copied by scripts/generate_baseline_migrations.py out of a real run's
-- database: these are that database's own CREATE statements, not a
-- reconstruction of them. Maintained by hand from here — this file's
-- checksum is recorded when it is applied, so a shape change is a new
-- numbered migration rather than an edit to this one.

CREATE TABLE "pipeline_run_summary" (
"run_id" TEXT,
  "pipeline" TEXT,
  "logical_run_id" TEXT,
  "run_date" TEXT,
  "started_at" TEXT,
  "finished_at" TEXT,
  "wall_clock_seconds" REAL,
  "step_duration_seconds" REAL,
  "step_count" INTEGER,
  "failed_step_count" INTEGER,
  "committed_step_count" INTEGER,
  "warn_hit_count" INTEGER,
  "status" TEXT,
  "error_category" TEXT,
  "attempt_number" INTEGER,
  "is_latest_attempt" INTEGER,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "step_duration_trend_daily" (
"pipeline" TEXT,
  "step_address" TEXT,
  "run_date" TEXT,
  "execution_count" INTEGER,
  "duration_p50" REAL,
  "duration_p95" REAL,
  "duration_max" REAL,
  "trailing_p50_median" REAL,
  "delta_seconds" REAL,
  "delta_ratio" REAL,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "step_row_flow" (
"run_id" TEXT,
  "pipeline" TEXT,
  "step_address" TEXT,
  "run_date" TEXT,
  "execution_count" INTEGER,
  "rows_in" REAL,
  "rows_out" REAL,
  "rows_quarantined" REAL,
  "rows_excluded" REAL,
  "out_ratio" REAL,
  "quarantine_ratio" REAL,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);
