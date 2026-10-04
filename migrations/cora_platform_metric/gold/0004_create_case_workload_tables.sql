-- Four forward-looking and calibration aggregates, each down to the Assigned
-- Reviewer: open Cases by due bucket, remediation outstanding past its
-- Remediation Due Date, Reviewer workload, and Appeal rate by Reportable
-- month. See docs/data-dictionary-cora-platform-metric.md.
CREATE TABLE "case_due_profile_current" (
"sla_kind" TEXT,
  "brand" TEXT,
  "case_type" TEXT,
  "assigned_reviewer_name" TEXT,
  "due_bucket" TEXT,
  "due_bucket_order" INTEGER,
  "case_count" INTEGER,
  "on_hold_count" INTEGER,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "remediation_overdue_current" (
"brand" TEXT,
  "case_type" TEXT,
  "assigned_reviewer_name" TEXT,
  "responsible_party_name" TEXT,
  "days_over_bucket" TEXT,
  "days_over_bucket_order" INTEGER,
  "case_count" INTEGER,
  "outstanding_answer_count" INTEGER,
  "outstanding_action_count" INTEGER,
  "days_over_max" INTEGER,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "reviewer_workload_current" (
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
  "pipeline_run_id" TEXT
);

CREATE TABLE "appeal_rate_by_reviewer_monthly" (
"reportable_month" TEXT,
  "brand" TEXT,
  "case_type" TEXT,
  "assigned_reviewer_name" TEXT,
  "reportable_count" INTEGER,
  "appealed_case_count" INTEGER,
  "appeal_count" INTEGER,
  "open_appeal_count" INTEGER,
  "agreed_appeal_count" INTEGER,
  "rejected_appeal_count" INTEGER,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);
