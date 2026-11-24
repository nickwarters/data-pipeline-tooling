-- `case_root_cause` republishes silver's Case Root Cause rows for each Case's
-- winning observation, one row per Case x Case Root Cause Field, stamped with
-- the run's `as_of_utc` -- `answer_root_cause`'s twin at Case grain. Rebuilt
-- whole on every publish.
--
-- No aggregate reads it yet: a count of Case Root Cause values is deferred, as
-- a count of per-Issue ones is, until a report asks for one.

CREATE TABLE "case_root_cause" (
"case_type" TEXT,
  "source_item_id" TEXT,
  "source_modified_at" TEXT,
  "source_version" TEXT,
  "source_observation_id" TEXT,
  "field_key" TEXT,
  "value_kind" TEXT,
  "value_text" TEXT,
  "person_login" TEXT,
  "person_display" TEXT,
  "pipeline_run_id" TEXT,
  "case_id" TEXT,
  "as_of_utc" TEXT
);
