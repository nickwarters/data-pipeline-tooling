-- Two more Conversation aggregates: how much Conversation Cases carry, and
-- when Messages get posted (a 7 x 24 local-clock grid per Case Type).
-- See docs/data-dictionary-cora-platform-metric.md.
CREATE TABLE "conversation_volume_current" (
"brand" TEXT,
  "case_type" TEXT,
  "case_count" INTEGER,
  "thread_count" INTEGER,
  "no_conversation_count" INTEGER,
  "no_conversation_share" REAL,
  "message_count" INTEGER,
  "messages_per_thread_mean" REAL,
  "messages_per_thread_p50" REAL,
  "messages_per_thread_p90" REAL,
  "messages_per_thread_max" REAL,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);

CREATE TABLE "conversation_posting_pattern_current" (
"brand" TEXT,
  "case_type" TEXT,
  "weekday_order" INTEGER,
  "weekday" TEXT,
  "hour_of_day" INTEGER,
  "message_count" INTEGER,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);
