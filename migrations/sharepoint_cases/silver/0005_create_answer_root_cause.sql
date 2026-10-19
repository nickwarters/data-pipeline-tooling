-- `answer_root_cause` holds the Responsible Party Manager's frontline root-cause
-- capture: one row per observation x Question Definition x Root Cause Field,
-- exploded from each failed Answer's `rcaCapture` map inside the `Answers`
-- blob. No new SharePoint column carries it, so raw and `case_version` do not
-- change.
--
-- The value is polymorphic exactly as `capture` is (text, or a person), so the
-- table is `answer_capture`'s twin column for column. It is a separate table,
-- not extra rows in `answer_capture`, because the two are different people's
-- records of different things: the Reviewer's Issue capture, and the Manager's
-- account of why the Issue happened.

CREATE TABLE "answer_root_cause" (
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
