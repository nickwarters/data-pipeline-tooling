-- `case_current` carries silver's Case columns forward, so the two current
-- managers reach gold the same way the at-the-time pair beside them does. It is
-- rebuilt whole on the next publish, so nothing needs filling in here.
--
-- No aggregate gains a column: none groups on a manager today, and the
-- reporting subjects that do (`cora_platform_metric`) deliberately keep reading
-- the at-the-time record.

ALTER TABLE "case_current" ADD COLUMN "current_reviewer_manager_name" TEXT;
ALTER TABLE "case_current" ADD COLUMN "current_responsible_party_manager_name" TEXT;
