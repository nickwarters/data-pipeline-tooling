-- Baseline for cora_platform_metric/gold.
--
-- Copied by scripts/generate_baseline_migrations.py out of a real run's
-- database: these are that database's own CREATE statements, not a
-- reconstruction of them. Maintained by hand from here — this file's
-- checksum is recorded when it is applied, so a shape change is a new
-- numbered migration rather than an edit to this one.

CREATE TABLE "answer_action_load_current" (
"case_type" TEXT,
  "question_id" TEXT,
  "case_count" INTEGER,
  "action_count" INTEGER,
  "actions_per_case_mean" REAL,
  "actions_per_case_max" INTEGER,
  "share_of_cases" REAL,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "answer_remediation_by_manager_current" (
"case_type" TEXT,
  "responsible_party_manager_name" TEXT,
  "remediation_required" TEXT,
  "remediation_status" TEXT,
  "answer_count" INTEGER,
  "case_count" INTEGER,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "appeal_cycle_time_current" (
"case_type" TEXT,
  "state" TEXT,
  "resolution_verdict" TEXT,
  "appeal_count" INTEGER,
  "resolved_count" INTEGER,
  "cycle_days_mean" REAL,
  "cycle_days_p50" REAL,
  "cycle_days_p90" REAL,
  "cycle_days_max" REAL,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "appeal_question_citations_current" (
"case_type" TEXT,
  "question_id" TEXT,
  "appeal_count" INTEGER,
  "case_count" INTEGER,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "case_hold_current" (
"brand" TEXT,
  "case_type" TEXT,
  "assigned_reviewer_name" TEXT,
  "case_count" INTEGER,
  "hold_count" INTEGER,
  "open_hold_count" INTEGER,
  "held_days_total" REAL,
  "held_days_mean" REAL,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "case_sla_attainment_monthly" (
"sla_kind" TEXT,
  "completed_month" TEXT,
  "brand" TEXT,
  "case_type" TEXT,
  "assigned_reviewer_manager_name" TEXT,
  "case_count" INTEGER,
  "on_time_count" INTEGER,
  "late_count" INTEGER,
  "no_due_date_count" INTEGER,
  "late_working_days_mean" REAL,
  "late_working_days_max" REAL,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "case_stage_dwell_current" (
"brand" TEXT,
  "case_type" TEXT,
  "status" TEXT,
  "interval_count" INTEGER,
  "open_interval_count" INTEGER,
  "dwell_days_mean" REAL,
  "dwell_days_p50" REAL,
  "dwell_days_p90" REAL,
  "dwell_days_max" REAL,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "case_void_monthly" (
"void_month" TEXT,
  "brand" TEXT,
  "case_type" TEXT,
  "void_reason" TEXT,
  "voided_by_name" TEXT,
  "case_count" INTEGER,
  "age_at_void_days_mean" REAL,
  "age_at_void_days_max" REAL,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "conversation_response_time_current" (
"brand" TEXT,
  "case_type" TEXT,
  "thread_count" INTEGER,
  "reply_count" INTEGER,
  "reply_hours_mean" REAL,
  "reply_hours_p50" REAL,
  "reply_hours_p90" REAL,
  "reply_hours_max" REAL,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);
