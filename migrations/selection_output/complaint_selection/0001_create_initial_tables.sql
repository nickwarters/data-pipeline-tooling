-- Baseline for selection_output/complaint_selection.
--
-- Copied by scripts/generate_baseline_migrations.py out of a real run's
-- database: these are that database's own CREATE statements, not a
-- reconstruction of them. Maintained by hand from here — this file's
-- checksum is recorded when it is applied, so a shape change is a new
-- numbered migration rather than an edit to this one.

CREATE TABLE "selection_pool" (
"case_ref" TEXT,
  "case_type" TEXT,
  "priority_score" INTEGER,
  "question_bank_id" TEXT,
  "logical_run_id" TEXT,
  "load_date" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "selection_trace" (
"case_ref" TEXT,
  "verdict" TEXT,
  "reason" TEXT,
  "rank" REAL,
  "score" INTEGER,
  "logical_run_id" TEXT,
  "load_date" TEXT,
  "pipeline_run_id" TEXT
);
