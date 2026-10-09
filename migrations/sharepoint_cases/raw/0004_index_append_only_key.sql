-- Index the key `case_observation` is appended on, so a write costs the size of
-- the batch rather than the size of the history.
--
-- The append-only Writer matches every staged row to the target with
-- `EXISTS (SELECT 1 FROM target WHERE <key match>)`, twice per write (once to
-- refuse a changed row, once to insert only the unseen). With no index behind
-- `source_observation_id` each of those is a full scan of the table per staged
-- row, so a poll costs (rows in the batch) x (rows ever landed) and gets slower
-- every day. With it, each match is one lookup.
--
-- A plain index, deliberately not UNIQUE: a UNIQUE index would refuse to build
-- if a database already held a duplicate key, and the migration would fail
-- half-way through a deployment. The Writer's own check is what enforces the
-- contract; this only makes that check cheap. Making it UNIQUE is a later
-- migration, once every database is known to be clean.

CREATE INDEX "ix_case_observation_key" ON "case_observation" ("source_observation_id");
