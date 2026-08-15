-- Baseline for sharepoint_cases/silver.
--
-- Generated once by scripts/generate_baseline_migrations.py from a real
-- run's database, and maintained by hand from here: this file's checksum
-- is recorded when it is applied, so a shape change is a new numbered
-- migration rather than an edit to this one.

CREATE TABLE "answer" (
    "case_type" TEXT,
    "source_item_id" TEXT,
    "source_modified_at" TIMESTAMP,
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
    "pipeline_run_id" TEXT
);

CREATE TABLE "answer_action" (
    "case_type" TEXT,
    "source_item_id" TEXT,
    "source_modified_at" TIMESTAMP,
    "source_version" TEXT,
    "source_observation_id" TEXT,
    "question_id" TEXT,
    "action_seq" INTEGER,
    "action_id" TEXT,
    "action_text" TEXT,
    "pipeline_run_id" TEXT
);

CREATE TABLE "answer_capture" (
    "case_type" TEXT,
    "source_item_id" TEXT,
    "source_modified_at" TIMESTAMP,
    "source_version" TEXT,
    "source_observation_id" TEXT,
    "question_id" TEXT,
    "field_key" TEXT,
    "value_kind" TEXT,
    "value_text" TEXT,
    "person_login" TEXT,
    "person_display" TEXT,
    "pipeline_run_id" TEXT
);

CREATE TABLE "appeal" (
    "case_type" TEXT,
    "source_item_id" TEXT,
    "source_modified_at" TIMESTAMP,
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
    "pipeline_run_id" TEXT
);

CREATE TABLE "case_detail" (
    "case_type" TEXT,
    "source_item_id" TEXT,
    "source_modified_at" TIMESTAMP,
    "source_version" TEXT,
    "source_observation_id" TEXT,
    "field_key" TEXT,
    "value_text" TEXT,
    "pipeline_run_id" TEXT
);

CREATE TABLE "case_version" (
    "id" INTEGER,
    "title" TEXT,
    "case_type" TEXT,
    "status" TEXT,
    "assigned_reviewer_name" TEXT,
    "assigned_at" TIMESTAMP,
    "responsible_party_name" TEXT,
    "responsible_party_title" TEXT,
    "assigned_reviewer_manager_name" TEXT,
    "responsible_party_manager_name" TEXT,
    "due_date" TIMESTAMP,
    "completed_at" TIMESTAMP,
    "reportable_at" TIMESTAMP,
    "remediation_due_date" TIMESTAMP,
    "related_date" TIMESTAMP,
    "created" TIMESTAMP,
    "has_open_appeal" INTEGER,
    "appeal_raised_at" TIMESTAMP,
    "awaiting_responsible_party" INTEGER,
    "awaiting_since" TIMESTAMP,
    "review_required" INTEGER,
    "on_hold" INTEGER,
    "placed_on_hold_at" TIMESTAMP,
    "voided_at" TIMESTAMP,
    "void_reason" TEXT,
    "voided_by_name" TEXT,
    "outcome" TEXT,
    "outcome_at_completion" TEXT,
    "had_remediation" INTEGER,
    "effective_outcome" TEXT,
    "effective_had_remediation" INTEGER,
    "outcome_overridden" INTEGER,
    "question_bank_version" TEXT,
    "case_justification" TEXT,
    "notes" TEXT,
    "answers" TEXT,
    "conversation" TEXT,
    "appeals" TEXT,
    "amended_outcome" TEXT,
    "details" TEXT,
    "source_list_name" TEXT,
    "source_item_id" TEXT,
    "source_modified_at" TIMESTAMP,
    "source_version" TEXT,
    "source_observation_id" TEXT,
    "pipeline_run_id" TEXT
);

CREATE TABLE "conversation_message" (
    "case_type" TEXT,
    "source_item_id" TEXT,
    "source_modified_at" TIMESTAMP,
    "source_version" TEXT,
    "source_observation_id" TEXT,
    "seq" INTEGER,
    "author_login" TEXT,
    "author_display_name" TEXT,
    "posted_at" TEXT,
    "body" TEXT,
    "pipeline_run_id" TEXT
);

CREATE TABLE "general_answer" (
    "case_type" TEXT,
    "source_item_id" TEXT,
    "source_modified_at" TIMESTAMP,
    "source_version" TEXT,
    "source_observation_id" TEXT,
    "general_key" TEXT,
    "value_json" TEXT,
    "value_text" TEXT,
    "pipeline_run_id" TEXT
);
