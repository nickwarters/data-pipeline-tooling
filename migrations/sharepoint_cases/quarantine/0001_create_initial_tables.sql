-- Baseline for sharepoint_cases/quarantine.
--
-- Copied by scripts/generate_baseline_migrations.py out of a real run's
-- database: these are that database's own CREATE statements, not a
-- reconstruction of them. Maintained by hand from here — this file's
-- checksum is recorded when it is applied, so a shape change is a new
-- numbered migration rather than an edit to this one.

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
  "failed_rule" TEXT,
  "logical_run_id" TEXT,
  "load_date" TEXT,
  "pipeline_run_id" TEXT
);
