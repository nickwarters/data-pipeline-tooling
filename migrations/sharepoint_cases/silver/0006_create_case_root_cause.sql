-- `case_root_cause` holds what the Responsible Party Manager records once about
-- the whole Case on the Root Cause tab: one row per observation x Case Root
-- Cause Field, exploded from the `rcaCapture` map of the `case:rootCause` entry
-- inside the `Answers` blob. No new SharePoint column carries it, so raw and
-- `case_version` do not change.
--
-- `answer_root_cause`'s twin less `question_id`: the entry is about the Case,
-- not an Issue, so its grain is the observation and the field alone. The
-- per-question tables exclude the `case:` namespace, so these values land here
-- and nowhere else.

CREATE TABLE "case_root_cause" (
"case_type" TEXT,
  "source_item_id" TEXT,
  "source_modified_at" TIMESTAMP,
  "source_version" TEXT,
  "source_observation_id" TEXT,
  "field_key" TEXT,
  "value_kind" TEXT,
  "value_text" TEXT,
  "person_login" TEXT,
  "person_display" TEXT,
  "pipeline_run_id" TEXT
);
