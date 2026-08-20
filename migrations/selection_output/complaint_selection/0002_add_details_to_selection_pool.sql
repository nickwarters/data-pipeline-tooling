-- Add the per-source Case Details column, landed as unparsed JSON text
-- (mirrors Sync's own `details` -- see docs/data-dictionary-sharepoint-cases.md).
--
-- An unmigrated database errors on the next write rather than degrading, so
-- this must be applied before that pipeline run -- see docs/selection.md.

ALTER TABLE "selection_pool" ADD COLUMN "details" TEXT;
