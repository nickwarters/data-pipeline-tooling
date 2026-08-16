-- Baseline for notifications/gold.
--
-- Copied by scripts/generate_baseline_migrations.py out of a real run's
-- database: these are that database's own CREATE statements, not a
-- reconstruction of them. Maintained by hand from here — this file's
-- checksum is recorded when it is applied, so a shape change is a new
-- numbered migration rather than an edit to this one.

CREATE TABLE "notified" (
"case_id" TEXT,
  "recipient" TEXT,
  "message_at" TEXT,
  "pipeline_run_id" TEXT
);
