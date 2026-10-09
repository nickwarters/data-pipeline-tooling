-- `person_current` republishes silver `person` -- one row per bare account,
-- user details only -- stamped with the run's `as_of_utc`, so consumers read
-- people from gold like every other table this feed publishes.

CREATE TABLE "person_current" (
  "account" TEXT,
  "domain" TEXT,
  "display_name" TEXT,
  "email" TEXT,
  "first_seen_at" TIMESTAMP,
  "last_seen_at" TIMESTAMP,
  "as_of_utc" TEXT,
  "pipeline_run_id" TEXT
);
