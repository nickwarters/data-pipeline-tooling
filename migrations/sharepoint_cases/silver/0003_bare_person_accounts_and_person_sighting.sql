-- Person columns hold the lower-cased bare account from here on, not the
-- claims login: `i:0#.w|CONTOSO\A.Khan` becomes `a.khan`, the spelling the
-- platform's JSON and every other person column use. Rows already landed are
-- brought into line here so the history reads one way. Raw keeps the login.
--
-- Three steps per column, matching `shared.account_names.to_bare_account`:
-- drop the claims prefix; keep what follows the last backslash (`rtrim` with
-- every other character of the value strips back to that backslash, and
-- replacing that prefix with nothing leaves the rest); then trim, lower-case,
-- and turn an empty value into a null.
--
-- `person_sighting` records each person an observation names, with the
-- domain, display name and email it gave for them.

UPDATE "case_version" SET "assigned_reviewer_name" = substr("assigned_reviewer_name", 8) WHERE "assigned_reviewer_name" LIKE 'i:0#.w|%';
UPDATE "case_version" SET "assigned_reviewer_name" = replace("assigned_reviewer_name", rtrim("assigned_reviewer_name", replace("assigned_reviewer_name", '\', '')), '') WHERE "assigned_reviewer_name" LIKE '%\%';
UPDATE "case_version" SET "assigned_reviewer_name" = NULLIF(lower(trim("assigned_reviewer_name")), '');

UPDATE "case_version" SET "responsible_party_name" = substr("responsible_party_name", 8) WHERE "responsible_party_name" LIKE 'i:0#.w|%';
UPDATE "case_version" SET "responsible_party_name" = replace("responsible_party_name", rtrim("responsible_party_name", replace("responsible_party_name", '\', '')), '') WHERE "responsible_party_name" LIKE '%\%';
UPDATE "case_version" SET "responsible_party_name" = NULLIF(lower(trim("responsible_party_name")), '');

UPDATE "case_version" SET "assigned_reviewer_manager_name" = substr("assigned_reviewer_manager_name", 8) WHERE "assigned_reviewer_manager_name" LIKE 'i:0#.w|%';
UPDATE "case_version" SET "assigned_reviewer_manager_name" = replace("assigned_reviewer_manager_name", rtrim("assigned_reviewer_manager_name", replace("assigned_reviewer_manager_name", '\', '')), '') WHERE "assigned_reviewer_manager_name" LIKE '%\%';
UPDATE "case_version" SET "assigned_reviewer_manager_name" = NULLIF(lower(trim("assigned_reviewer_manager_name")), '');

UPDATE "case_version" SET "responsible_party_manager_name" = substr("responsible_party_manager_name", 8) WHERE "responsible_party_manager_name" LIKE 'i:0#.w|%';
UPDATE "case_version" SET "responsible_party_manager_name" = replace("responsible_party_manager_name", rtrim("responsible_party_manager_name", replace("responsible_party_manager_name", '\', '')), '') WHERE "responsible_party_manager_name" LIKE '%\%';
UPDATE "case_version" SET "responsible_party_manager_name" = NULLIF(lower(trim("responsible_party_manager_name")), '');

UPDATE "case_version" SET "voided_by_name" = substr("voided_by_name", 8) WHERE "voided_by_name" LIKE 'i:0#.w|%';
UPDATE "case_version" SET "voided_by_name" = replace("voided_by_name", rtrim("voided_by_name", replace("voided_by_name", '\', '')), '') WHERE "voided_by_name" LIKE '%\%';
UPDATE "case_version" SET "voided_by_name" = NULLIF(lower(trim("voided_by_name")), '');

CREATE TABLE "person_sighting" (
"case_type" TEXT,
  "source_item_id" TEXT,
  "source_modified_at" TIMESTAMP,
  "source_version" TEXT,
  "source_observation_id" TEXT,
  "account" TEXT,
  "domain" TEXT,
  "display_name" TEXT,
  "email" TEXT,
  "pipeline_run_id" TEXT
);
