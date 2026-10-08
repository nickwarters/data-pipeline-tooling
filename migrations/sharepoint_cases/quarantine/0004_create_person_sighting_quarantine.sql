-- Reject table for the silver person-sighting table.
--
-- `run()` hands the person-sighting step a `quarantine_writer` as it does
-- every other silver table, and this database will not create the table on
-- first write. `PersonSightingRow` declares no value rule today, so nothing
-- lands here yet; the table mirrors the silver row plus the rule it failed.

CREATE TABLE "person_sighting" (
"case_type" TEXT,
  "source_item_id" TEXT,
  "source_modified_at" TIMESTAMP,
  "source_version" TEXT,
  "source_observation_id" TEXT,
  "account" TEXT,
  "domain" TEXT,
  "display_name" TEXT,
  "email" TEXT,
  "failed_rule" TEXT,
  "logical_run_id" TEXT,
  "load_date" TEXT,
  "pipeline_run_id" TEXT
);
