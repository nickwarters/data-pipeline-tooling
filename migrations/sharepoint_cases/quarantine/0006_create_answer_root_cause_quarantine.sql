-- Reject table for the silver `answer_root_cause` Detail Table.
--
-- `run()` hands its step a `quarantine_writer` as it does every Detail Table,
-- and this database will not create the table on first write. A value the
-- discriminator cannot model (`value_kind` `unsupported`) is routed here, so
-- the reject row keeps `raw_value` beside the reason, exactly as
-- `answer_capture`'s does.

CREATE TABLE "answer_root_cause" (
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
