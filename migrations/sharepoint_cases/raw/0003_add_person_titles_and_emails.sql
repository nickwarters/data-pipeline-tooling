-- Land every Person column's display name and email beside its login, so
-- `person_sighting` can record who each person is. Raw keeps the source's own
-- names, as for every other column; the Responsible Party's `Title` was
-- already landed.

ALTER TABLE "case_observation" ADD COLUMN "AssignedReviewer/Title" TEXT;
ALTER TABLE "case_observation" ADD COLUMN "AssignedReviewer/EMail" TEXT;
ALTER TABLE "case_observation" ADD COLUMN "ResponsibleParty/EMail" TEXT;
ALTER TABLE "case_observation" ADD COLUMN "AssignedReviewerManager/Title" TEXT;
ALTER TABLE "case_observation" ADD COLUMN "AssignedReviewerManager/EMail" TEXT;
ALTER TABLE "case_observation" ADD COLUMN "ResponsiblePartyManager/Title" TEXT;
ALTER TABLE "case_observation" ADD COLUMN "ResponsiblePartyManager/EMail" TEXT;
ALTER TABLE "case_observation" ADD COLUMN "VoidedBy/Title" TEXT;
ALTER TABLE "case_observation" ADD COLUMN "VoidedBy/EMail" TEXT;
