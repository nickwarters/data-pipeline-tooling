-- Land the Void Reason Note the review application now writes beside
-- `VoidReason`.
--
-- The `Other` reason names nothing on its own -- the note is what it means --
-- so a Case voided under it lands with no reason at all unless this column
-- comes with it. See platform_frontend/docs/adr/0046-void-status-and-reason-vocabulary.md.

ALTER TABLE "case_observation" ADD COLUMN "VoidReasonNote" TEXT;
