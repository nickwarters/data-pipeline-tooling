-- The silver twins of raw's `CurrentReviewerManager/Name` and
-- `CurrentResponsiblePartyManager/Name`: the current managers, as the
-- lower-cased bare account every other Person column holds. Their display
-- names and emails go to the `person` table, whose shape does not change.
--
-- `assigned_reviewer_manager_name` and `responsible_party_manager_name` stay
-- what they were -- the at-the-time record reporting reads. Rows stored before
-- this hold nulls here, which is faithful: those observations never carried
-- the columns. Nothing is backfilled from the record, because a copy of it
-- would claim a currency the feed never observed.

ALTER TABLE "case_version" ADD COLUMN "current_reviewer_manager_name" TEXT;
ALTER TABLE "case_version" ADD COLUMN "current_responsible_party_manager_name" TEXT;
