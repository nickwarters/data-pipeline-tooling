-- Baseline for sharepoint_cases/raw.
--
-- Copied by scripts/generate_baseline_migrations.py out of a real run's
-- database: these are that database's own CREATE statements, not a
-- reconstruction of them. Maintained by hand from here — this file's
-- checksum is recorded when it is applied, so a shape change is a new
-- numbered migration rather than an edit to this one.

CREATE TABLE "case_observation" (
"Id" INTEGER,
  "Title" TEXT,
  "CaseType" TEXT,
  "Status" TEXT,
  "AssignedReviewer/Name" TEXT,
  "AssignedAt" TEXT,
  "ResponsibleParty/Name" TEXT,
  "ResponsibleParty/Title" TEXT,
  "AssignedReviewerManager/Name" TEXT,
  "ResponsiblePartyManager/Name" TEXT,
  "DueDate" TEXT,
  "CompletedAt" TEXT,
  "ReportableAt" TEXT,
  "RemediationDueDate" TEXT,
  "RelatedDate" TEXT,
  "Created" TEXT,
  "HasOpenAppeal" INTEGER,
  "AppealRaisedAt" TEXT,
  "AwaitingResponsibleParty" INTEGER,
  "AwaitingSince" TEXT,
  "ReviewRequired" INTEGER,
  "OnHold" INTEGER,
  "PlacedOnHoldAt" TEXT,
  "VoidedAt" TEXT,
  "VoidReason" TEXT,
  "VoidedBy/Name" TEXT,
  "Outcome" TEXT,
  "OutcomeAtCompletion" TEXT,
  "HadRemediation" TEXT,
  "EffectiveOutcome" TEXT,
  "EffectiveHadRemediation" TEXT,
  "OutcomeOverridden" INTEGER,
  "QuestionBankVersion" TEXT,
  "CaseJustification" TEXT,
  "Notes" TEXT,
  "Answers" TEXT,
  "Conversation" TEXT,
  "Appeals" TEXT,
  "AmendedOutcome" TEXT,
  "Details" TEXT,
  "source_list_name" TEXT,
  "source_item_id" TEXT,
  "source_modified_at" TEXT,
  "source_version" TEXT,
  "source_observation_id" TEXT,
  "pipeline_run_id" TEXT
);
