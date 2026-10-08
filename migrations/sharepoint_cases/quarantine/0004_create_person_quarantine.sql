-- Reject table for the silver `person` table.
--
-- `run()` hands the person step a `quarantine_writer` as it does every other
-- silver table, and this database will not create the table on first write.
-- `PersonRow` declares no value rule today, so nothing lands here yet; the
-- table mirrors the silver row plus the rule it failed.

CREATE TABLE "person" (
"account" TEXT,
  "domain" TEXT,
  "display_name" TEXT,
  "email" TEXT,
  "first_seen_at" TIMESTAMP,
  "last_seen_at" TIMESTAMP,
  "failed_rule" TEXT,
  "logical_run_id" TEXT,
  "load_date" TEXT,
  "pipeline_run_id" TEXT
);
