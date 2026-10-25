-- Index the key each append-only silver table is appended on, so a write costs
-- the size of the batch rather than the size of the history.
--
-- The append-only Writer matches every staged row to the target with
-- `EXISTS (SELECT 1 FROM target WHERE <key match>)`, twice per write (once to
-- refuse a changed row, once to insert only the unseen). With no index behind
-- the key each of those is a full scan of the table per staged row, so a poll
-- costs (rows in the batch) x (rows ever landed) and gets slower every day.
-- With one, each match is one lookup.
--
-- One index per table, on exactly the columns its `AppendOnly(...)` declares in
-- `pipelines/sharepoint_cases/pipeline.py` and in that order: `case_version` on
-- `source_observation_id`, and each Detail Table on its composite grain.
-- `person` is upserted on `account`, a different strategy, and is left alone.
--
-- Plain indexes, deliberately not UNIQUE: a UNIQUE index would refuse to build
-- if a database already held a duplicate key, and the migration would fail
-- half-way through a deployment. The Writer's own check is what enforces the
-- contract; these only make that check cheap. Making one UNIQUE is a later
-- migration, once every database is known to be clean.

CREATE INDEX "ix_case_version_key" ON "case_version" ("source_observation_id");
CREATE INDEX "ix_answer_key" ON "answer" ("source_observation_id", "question_id");
CREATE INDEX "ix_answer_capture_key" ON "answer_capture" ("source_observation_id", "question_id", "field_key");
CREATE INDEX "ix_answer_action_key" ON "answer_action" ("source_observation_id", "question_id", "action_id");
CREATE INDEX "ix_general_answer_key" ON "general_answer" ("source_observation_id", "general_key");
CREATE INDEX "ix_conversation_message_key" ON "conversation_message" ("source_observation_id", "seq");
CREATE INDEX "ix_appeal_key" ON "appeal" ("source_observation_id", "appeal_id");
CREATE INDEX "ix_case_detail_key" ON "case_detail" ("source_observation_id", "field_key");
