-- Second Notified ledger table for the Reportable-with-remediation trigger.
--
-- Keyed (case_id, recipient): reportable_at is frozen at the milestone and
-- never advances, so a third column would do no work distinguishing rows.

CREATE TABLE "notified_reportable" (
"case_id" TEXT,
  "recipient" TEXT,
  "pipeline_run_id" TEXT
);
