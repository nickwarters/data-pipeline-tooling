-- Pass rate per question under each declared PassRule, judged against the
-- current Question Bank. The two booleans land as INTEGER 0/1, as SQLite
-- holds a bool. See docs/data-dictionary-cora-platform-metric.md.
CREATE TABLE "answer_pass_rate_current" (
"pass_rule" TEXT,
  "brand" TEXT,
  "case_type" TEXT,
  "question_id" TEXT,
  "question_group" TEXT,
  "deprecated" INTEGER,
  "can_fail" INTEGER,
  "answer_count" INTEGER,
  "unanswered_count" INTEGER,
  "na_count" INTEGER,
  "pass_count" INTEGER,
  "fail_count" INTEGER,
  "pass_rate" REAL,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);
