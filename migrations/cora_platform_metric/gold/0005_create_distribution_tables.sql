-- Duration and open-age percentiles, first-time-right, Reviewer throughput,
-- and a daily history of Reviewer workload; plus an on-time rate on the SLA
-- table. case_open_age_daily and reviewer_workload_daily accumulate by run, so
-- they carry that strategy's logical_run_id and load_date.
-- See docs/data-dictionary-cora-platform-metric.md.
CREATE TABLE "case_duration_percentiles_daily" (
"as_of_date" TEXT,
  "window_days" INTEGER,
  "case_type" TEXT,
  "measure" TEXT,
  "n" INTEGER,
  "p50" REAL,
  "p90" REAL,
  "p95" REAL,
  "max" REAL,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "case_open_age_daily" (
"as_of_date" TEXT,
  "case_type" TEXT,
  "measure" TEXT,
  "n" INTEGER,
  "p50" REAL,
  "p90" REAL,
  "p95" REAL,
  "max" REAL,
  "as_of_utc" TEXT,
  "logical_run_id" TEXT,
  "load_date" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "case_first_time_right_monthly" (
"reportable_month" TEXT,
  "brand" TEXT,
  "case_type" TEXT,
  "assigned_reviewer_name" TEXT,
  "reportable_count" INTEGER,
  "first_time_right_count" INTEGER,
  "first_time_right_rate" REAL,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "reviewer_throughput_weekly" (
"iso_week" TEXT,
  "brand" TEXT,
  "case_type" TEXT,
  "active_reviewer_count" INTEGER,
  "completions_total" INTEGER,
  "completions_per_reviewer_p50" REAL,
  "completions_per_reviewer_p90" REAL,
  "completions_per_reviewer_max" REAL,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "reviewer_workload_daily" (
"as_of_date" TEXT,
  "brand" TEXT,
  "case_type" TEXT,
  "assigned_reviewer_name" TEXT,
  "in_progress_count" INTEGER,
  "in_progress_on_hold_count" INTEGER,
  "actions_in_progress_count" INTEGER,
  "oldest_in_progress_days" REAL,
  "reportable_last_28_days_count" INTEGER,
  "weeks_of_work" REAL,
  "as_of_utc" TEXT,
  "logical_run_id" TEXT,
  "load_date" TEXT,
  "pipeline_run_id" TEXT
);

ALTER TABLE "case_sla_attainment_monthly" ADD COLUMN "on_time_rate" REAL;
