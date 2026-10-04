-- Four Case-flow aggregates: daily intake and daily backlog at Case Type
-- level, and monthly lifecycle-leg durations and Outcomes down to the
-- Assigned Reviewer. See docs/data-dictionary-cora-platform-metric.md.
CREATE TABLE "case_intake_daily" (
"intake_date" TEXT,
  "brand" TEXT,
  "case_type" TEXT,
  "status" TEXT,
  "case_count" INTEGER,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "case_backlog_daily" (
"backlog_date" TEXT,
  "brand" TEXT,
  "case_type" TEXT,
  "status" TEXT,
  "case_count" INTEGER,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "case_lifecycle_duration_monthly" (
"leg" TEXT,
  "leg_order" INTEGER,
  "ended_month" TEXT,
  "brand" TEXT,
  "case_type" TEXT,
  "assigned_reviewer_name" TEXT,
  "case_count" INTEGER,
  "out_of_order_count" INTEGER,
  "days_total" REAL,
  "days_mean" REAL,
  "days_p50" REAL,
  "days_p90" REAL,
  "days_max" REAL,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "case_outcome_monthly" (
"reportable_month" TEXT,
  "brand" TEXT,
  "case_type" TEXT,
  "assigned_reviewer_name" TEXT,
  "effective_outcome" TEXT,
  "case_count" INTEGER,
  "remediation_count" INTEGER,
  "overridden_count" INTEGER,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);
