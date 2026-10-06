-- Land the Previous Completions a Maintainer's Reopen records beside
-- `AmendedOutcome`.
--
-- The list column is a JSON blob of the completions a Case has had set aside,
-- oldest first. It must exist on every Cases list before this feed polls: the
-- feed names every column it reads, so a list without it fails the poll.
-- See platform_frontend/docs/adr/0058-a-maintainer-can-reopen-a-reportable-case.md.

ALTER TABLE "case_observation" ADD COLUMN "PreviousCompletions" TEXT;
