-- Baseline for cora_access_log/silver.
--
-- Copied by scripts/generate_baseline_migrations.py out of a real run's
-- database: these are that database's own CREATE statements, not a
-- reconstruction of them. Maintained by hand from here — this file's
-- checksum is recorded when it is applied, so a shape change is a new
-- numbered migration rather than an edit to this one.

CREATE TABLE "access_log_entry" (
"id" INTEGER,
  "target_login" TEXT,
  "target_name" TEXT,
  "access_action" TEXT,
  "access_role" TEXT,
  "case_type" TEXT,
  "reason" TEXT,
  "changes" TEXT,
  "outcome" TEXT,
  "relates_to" TEXT,
  "created" TIMESTAMP,
  "author_name" TEXT,
  "author_title" TEXT,
  "source_list_name" TEXT,
  "source_item_id" TEXT,
  "source_modified_at" TIMESTAMP,
  "source_version" TEXT,
  "source_observation_id" TEXT,
  "pipeline_run_id" TEXT
);
