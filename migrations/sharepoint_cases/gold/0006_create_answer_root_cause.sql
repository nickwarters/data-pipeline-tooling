-- `answer_root_cause` republishes silver's root-cause rows for each Case's
-- winning observation, one row per Case x Question Definition x Root Cause
-- Field, stamped with the run's `as_of_utc` -- the twin of gold
-- `answer_capture`. Rebuilt whole on every publish.
--
-- No aggregate reads it yet: a count of Root Cause values is deferred, as a
-- count of capture values is, until a report asks for one.

CREATE TABLE "answer_root_cause" (
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
