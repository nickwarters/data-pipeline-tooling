-- The reject table mirrors the silver row it holds aside, so it gains the same
-- two current-manager columns: a quarantined Case row must be the row as it
-- stood, not a narrowed copy of it.

ALTER TABLE "case_version" ADD COLUMN "current_reviewer_manager_name" TEXT;
ALTER TABLE "case_version" ADD COLUMN "current_responsible_party_manager_name" TEXT;
