-- The silver twin of raw's `PreviousCompletions`: the blob of completions a
-- Reopen set aside, landed as the source holds it.
--
-- Like every other blob it stays unparsed text here, the faithful observation
-- history, and gold does not republish it: nothing measures reopens yet, so
-- there is no Detail Table to build it into.

ALTER TABLE "case_version" ADD COLUMN "previous_completions" TEXT;
