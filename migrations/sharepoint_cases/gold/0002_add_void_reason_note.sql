-- `case_current` carries silver's Case columns forward, so the Void Reason Note
-- reaches gold the same way `void_reason` beside it does.
--
-- Display copy on a Case, never an aggregate: nothing groups or counts on free
-- text, so no aggregate table gains a column here.

ALTER TABLE "case_current" ADD COLUMN "void_reason_note" TEXT;
