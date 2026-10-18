-- Land the two current-manager Person columns the review application now
-- provisions beside `AssignedReviewerManager` and `ResponsiblePartyManager`.
--
-- The existing pair is a record: who managed the Reviewer / Responsible Party
-- when they were set on the Case. The platform writes the current pair with the
-- same value at the same moment, and never again; a process outside it keeps
-- them current, and the platform decides manager access from them. Each is
-- landed as every other Person column is -- login, display name and email, in
-- the source's own names. Observations landed before this hold nulls: the
-- columns did not exist on the list when they were read.

ALTER TABLE "case_observation" ADD COLUMN "CurrentReviewerManager/Name" TEXT;
ALTER TABLE "case_observation" ADD COLUMN "CurrentReviewerManager/Title" TEXT;
ALTER TABLE "case_observation" ADD COLUMN "CurrentReviewerManager/EMail" TEXT;
ALTER TABLE "case_observation" ADD COLUMN "CurrentResponsiblePartyManager/Name" TEXT;
ALTER TABLE "case_observation" ADD COLUMN "CurrentResponsiblePartyManager/Title" TEXT;
ALTER TABLE "case_observation" ADD COLUMN "CurrentResponsiblePartyManager/EMail" TEXT;
