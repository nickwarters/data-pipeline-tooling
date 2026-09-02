-- The reject table mirrors the silver row it holds aside, so it gains the same
-- column: a quarantined Case row must be the row as it stood, not a narrowed
-- copy of it.

ALTER TABLE "case_version" ADD COLUMN "void_reason_note" TEXT;
