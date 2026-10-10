-- Rolling percentiles per pipeline and step, the scheduled batch's finish
-- time, and the run record's new retry and orchestration fields carried into
-- the existing tables. A per-day p95 of a step that runs once a day is its
-- only value, so step_duration_trend_daily drops it: the percentiles live in
-- duration_percentiles_daily now.
-- See docs/data-dictionary-pipeline-run-metric.md.
CREATE TABLE "duration_percentiles_daily" (
"as_of_date" TEXT,
  "level" TEXT,
  "pipeline" TEXT,
  "step_address" TEXT,
  "window_days" INTEGER,
  "execution_count" INTEGER,
  "ok_count" INTEGER,
  "duration_p50" REAL,
  "duration_p90" REAL,
  "duration_p95" REAL,
  "duration_max" REAL,
  "failure_rate" REAL,
  "retry_rate" REAL,
  "rows_per_second_p50" REAL,
  "p50_change_ratio_28d" REAL,
  "p90_change_ratio_28d" REAL,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "batch_finish_daily" (
"run_date" TEXT,
  "pass_count" INTEGER,
  "started_at" TEXT,
  "finished_at" TEXT,
  "finished_after_midnight_seconds" REAL,
  "finish_p50_28d" REAL,
  "finish_p90_28d" REAL,
  "items_run" INTEGER,
  "items_succeeded" INTEGER,
  "items_failed" INTEGER,
  "items_blocked" INTEGER,
  "queue_wait_max_seconds" REAL,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

ALTER TABLE "pipeline_run_summary" ADD COLUMN "orchestration_run_id" TEXT;
ALTER TABLE "pipeline_run_summary" ADD COLUMN "overhead_seconds" REAL;
ALTER TABLE "pipeline_run_summary" ADD COLUMN "retry_attempts" REAL;
ALTER TABLE "pipeline_run_summary" ADD COLUMN "retry_wait_seconds" REAL;

ALTER TABLE "step_row_flow" ADD COLUMN "duration_seconds" REAL;
ALTER TABLE "step_row_flow" ADD COLUMN "rows_per_second" REAL;

ALTER TABLE "step_duration_trend_daily" DROP COLUMN "duration_p95";
