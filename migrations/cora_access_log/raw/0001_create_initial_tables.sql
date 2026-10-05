-- Baseline for cora_access_log/raw.
--
-- Copied by scripts/generate_baseline_migrations.py out of a real run's
-- database: these are that database's own CREATE statements, not a
-- reconstruction of them. Maintained by hand from here — this file's
-- checksum is recorded when it is applied, so a shape change is a new
-- numbered migration rather than an edit to this one.

CREATE TABLE "access_log_entry" (
"Id" INTEGER,
  "Title" TEXT,
  "TargetName" TEXT,
  "AccessAction" TEXT,
  "AccessRole" TEXT,
  "CaseType" TEXT,
  "Reason" TEXT,
  "Changes" TEXT,
  "Outcome" TEXT,
  "RelatesTo" TEXT,
  "Created" TEXT,
  "Author/Name" TEXT,
  "Author/Title" TEXT,
  "source_list_name" TEXT,
  "source_item_id" TEXT,
  "source_modified_at" TEXT,
  "source_version" TEXT,
  "source_observation_id" TEXT,
  "pipeline_run_id" TEXT
);
