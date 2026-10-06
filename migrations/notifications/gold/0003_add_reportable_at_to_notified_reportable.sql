-- Key the Reportable-with-remediation ledger on the Case's `reportable_at` too.
--
-- 0002 keyed it (case_id, recipient) on the reasoning that `reportable_at` is
-- stamped once and never moves. A Maintainer's Reopen clears it and sending the
-- actions again stamps a new one, so a re-send must be a new row for the
-- Responsible Party to be told again. See
-- platform_frontend/docs/adr/0058-a-maintainer-can-reopen-a-completed-case.md.
--
-- Rows already in the table stay NULL here: the value is the Case's, held in
-- another subject's database, which a migration on this one cannot read. The
-- pipeline gives each of them the `reportable_at` its Case holds on its next
-- run (a legacy row stands for the one the notification was sent for, because
-- it never moved before this column existed), so nobody in flight is told twice.

ALTER TABLE "notified_reportable" ADD COLUMN "reportable_at" TEXT;
