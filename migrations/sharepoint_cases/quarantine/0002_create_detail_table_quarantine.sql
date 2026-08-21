-- Reject tables for the seven silver Detail Tables.
--
-- The baseline declared only `case_version`, but `run()` hands every Detail
-- Table step a `quarantine_writer` of its own. This database is under
-- migration control, so a Writer will not create a missing table: the first
-- Detail row to breach a value rule aborted the whole poll with a
-- `MissingTableError` instead of being routed aside, leaving silver *and*
-- gold unpublished and the watermark unadvanced -- the same window failing the
-- same way on every run after it.
--
-- Two of these can breach a rule today (`answer`'s remediation vocabulary,
-- `appeal`'s state); the other five carry no rule that can fire yet and are
-- declared anyway, because their quarantine step is already wired so that a
-- future rule needs no rewiring -- which only holds if the table it writes to
-- is there.
--
-- A reject row is the row as it stood at the quarantine step, plus the
-- `failed_rule` reason and the run stamps -- so `answer_capture` carries
-- `raw_value`, which its silver step drops only *after* quarantining, to keep
-- the offending value beside the reason.

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
  "failed_rule" TEXT,
  "logical_run_id" TEXT,
  "load_date" TEXT,
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
  "raw_value" TEXT,
  "value_kind" TEXT,
  "value_text" TEXT,
  "person_login" TEXT,
  "person_display" TEXT,
  "failed_rule" TEXT,
  "logical_run_id" TEXT,
  "load_date" TEXT,
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
  "failed_rule" TEXT,
  "logical_run_id" TEXT,
  "load_date" TEXT,
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
  "failed_rule" TEXT,
  "logical_run_id" TEXT,
  "load_date" TEXT,
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
  "failed_rule" TEXT,
  "logical_run_id" TEXT,
  "load_date" TEXT,
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
  "failed_rule" TEXT,
  "logical_run_id" TEXT,
  "load_date" TEXT,
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
  "failed_rule" TEXT,
  "logical_run_id" TEXT,
  "load_date" TEXT,
  "pipeline_run_id" TEXT
);
