-- Baseline for sharepoint_cases/gold.
--
-- Copied by scripts/generate_baseline_migrations.py out of a real run's
-- database: these are that database's own CREATE statements, not a
-- reconstruction of them. Maintained by hand from here — this file's
-- checksum is recorded when it is applied, so a shape change is a new
-- numbered migration rather than an edit to this one.

CREATE TABLE "answer" (
"case_type" TEXT,
  "source_item_id" TEXT,
  "source_modified_at" TEXT,
  "source_version" TEXT,
  "source_observation_id" TEXT,
  "question_id" TEXT,
  "value_json" TEXT,
  "justification" TEXT,
  "remediation_required" TEXT,
  "free_form_remediation" TEXT,
  "remediation_status" TEXT,
  "remediation_status_details" TEXT,
  "value_text" TEXT,
  "pipeline_run_id" TEXT,
  "case_id" TEXT,
  "as_of_utc" TEXT
);

CREATE TABLE "answer_action" (
"case_type" TEXT,
  "source_item_id" TEXT,
  "source_modified_at" TEXT,
  "source_version" TEXT,
  "source_observation_id" TEXT,
  "question_id" TEXT,
  "action_seq" INTEGER,
  "action_id" TEXT,
  "action_text" TEXT,
  "pipeline_run_id" TEXT,
  "case_id" TEXT,
  "as_of_utc" TEXT
);

CREATE TABLE "answer_capture" (
"case_type" TEXT,
  "source_item_id" TEXT,
  "source_modified_at" TEXT,
  "source_version" TEXT,
  "source_observation_id" TEXT,
  "question_id" TEXT,
  "field_key" TEXT,
  "value_kind" TEXT,
  "value_text" TEXT,
  "person_login" TEXT,
  "person_display" TEXT,
  "pipeline_run_id" TEXT,
  "case_id" TEXT,
  "as_of_utc" TEXT
);

CREATE TABLE "answer_remediation_current" (
"case_type" TEXT,
  "question_id" TEXT,
  "remediation_required" TEXT,
  "remediation_status" TEXT,
  "answer_count" INTEGER,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "appeal" (
"case_type" TEXT,
  "source_item_id" TEXT,
  "source_modified_at" TEXT,
  "source_version" TEXT,
  "source_observation_id" TEXT,
  "appeal_seq" INTEGER,
  "appeal_id" TEXT,
  "appellant" TEXT,
  "raised_at" TEXT,
  "rationale" TEXT,
  "state" TEXT,
  "cited_question_ids_json" TEXT,
  "resolution_verdict" TEXT,
  "resolution_rationale" TEXT,
  "resolution_resolver" TEXT,
  "resolution_at" TEXT,
  "pipeline_run_id" TEXT,
  "case_id" TEXT,
  "as_of_utc" TEXT
);

CREATE TABLE "appeal_outcomes_current" (
"case_type" TEXT,
  "state" TEXT,
  "resolution_verdict" TEXT,
  "appeal_count" INTEGER,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "case_age_buckets_current" (
"age_bucket" TEXT,
  "age_bucket_order" INTEGER,
  "status" TEXT,
  "case_count" INTEGER,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "case_counts_current" (
"assigned_reviewer_name" TEXT,
  "assigned_reviewer_manager_name" TEXT,
  "status" TEXT,
  "case_count" INTEGER,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "case_current" (
"id" INTEGER,
  "title" TEXT,
  "case_type" TEXT,
  "status" TEXT,
  "assigned_reviewer_name" TEXT,
  "assigned_at" TEXT,
  "responsible_party_name" TEXT,
  "responsible_party_title" TEXT,
  "assigned_reviewer_manager_name" TEXT,
  "responsible_party_manager_name" TEXT,
  "due_date" TEXT,
  "completed_at" TEXT,
  "reportable_at" TEXT,
  "remediation_due_date" TEXT,
  "related_date" TEXT,
  "created" TEXT,
  "has_open_appeal" INTEGER,
  "appeal_raised_at" TEXT,
  "awaiting_responsible_party" INTEGER,
  "awaiting_since" TEXT,
  "review_required" INTEGER,
  "on_hold" INTEGER,
  "placed_on_hold_at" TEXT,
  "voided_at" TEXT,
  "void_reason" TEXT,
  "voided_by_name" TEXT,
  "outcome" TEXT,
  "outcome_at_completion" TEXT,
  "had_remediation" REAL,
  "effective_outcome" TEXT,
  "effective_had_remediation" REAL,
  "outcome_overridden" INTEGER,
  "question_bank_version" TEXT,
  "case_justification" TEXT,
  "notes" TEXT,
  "source_list_name" TEXT,
  "source_item_id" TEXT,
  "source_modified_at" TEXT,
  "source_version" TEXT,
  "source_observation_id" TEXT,
  "pipeline_run_id" TEXT,
  "case_id" TEXT,
  "amended_outcome_id" TEXT,
  "amended_reason" TEXT,
  "amended_justification" TEXT,
  "amended_by" TEXT,
  "amended_at" TEXT,
  "amended_from_appeal_id" TEXT,
  "as_of_utc" TEXT
);

CREATE TABLE "case_detail" (
"case_type" TEXT,
  "source_item_id" TEXT,
  "source_modified_at" TEXT,
  "source_version" TEXT,
  "source_observation_id" TEXT,
  "field_key" TEXT,
  "value_text" TEXT,
  "pipeline_run_id" TEXT,
  "case_id" TEXT,
  "as_of_utc" TEXT
);

CREATE TABLE "case_throughput_daily" (
"terminal_date" TEXT,
  "terminal_status" TEXT,
  "case_count" INTEGER,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "conversation_message" (
"case_type" TEXT,
  "source_item_id" TEXT,
  "source_modified_at" TEXT,
  "source_version" TEXT,
  "source_observation_id" TEXT,
  "seq" INTEGER,
  "author_login" TEXT,
  "author_display_name" TEXT,
  "posted_at" TEXT,
  "body" TEXT,
  "pipeline_run_id" TEXT,
  "case_id" TEXT,
  "as_of_utc" TEXT
);

CREATE TABLE "general_answer" (
"case_type" TEXT,
  "source_item_id" TEXT,
  "source_modified_at" TEXT,
  "source_version" TEXT,
  "source_observation_id" TEXT,
  "general_key" TEXT,
  "value_json" TEXT,
  "value_text" TEXT,
  "pipeline_run_id" TEXT,
  "case_id" TEXT,
  "as_of_utc" TEXT
);
