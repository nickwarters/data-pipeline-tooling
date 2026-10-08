-- `case_current` carries silver's Person columns, so it takes the same bare
-- accounts silver's 0003 settles on, by the same expression. The aggregates
-- keyed on `assigned_reviewer_name` are not touched: they are rebuilt whole on
-- the next publish, and rewriting them here could merge two rows of one grain.

UPDATE "case_current" SET "assigned_reviewer_name" = substr("assigned_reviewer_name", 8) WHERE "assigned_reviewer_name" LIKE 'i:0#.w|%';
UPDATE "case_current" SET "assigned_reviewer_name" = replace("assigned_reviewer_name", rtrim("assigned_reviewer_name", replace("assigned_reviewer_name", '\', '')), '') WHERE "assigned_reviewer_name" LIKE '%\%';
UPDATE "case_current" SET "assigned_reviewer_name" = NULLIF(lower(trim("assigned_reviewer_name")), '');

UPDATE "case_current" SET "responsible_party_name" = substr("responsible_party_name", 8) WHERE "responsible_party_name" LIKE 'i:0#.w|%';
UPDATE "case_current" SET "responsible_party_name" = replace("responsible_party_name", rtrim("responsible_party_name", replace("responsible_party_name", '\', '')), '') WHERE "responsible_party_name" LIKE '%\%';
UPDATE "case_current" SET "responsible_party_name" = NULLIF(lower(trim("responsible_party_name")), '');

UPDATE "case_current" SET "assigned_reviewer_manager_name" = substr("assigned_reviewer_manager_name", 8) WHERE "assigned_reviewer_manager_name" LIKE 'i:0#.w|%';
UPDATE "case_current" SET "assigned_reviewer_manager_name" = replace("assigned_reviewer_manager_name", rtrim("assigned_reviewer_manager_name", replace("assigned_reviewer_manager_name", '\', '')), '') WHERE "assigned_reviewer_manager_name" LIKE '%\%';
UPDATE "case_current" SET "assigned_reviewer_manager_name" = NULLIF(lower(trim("assigned_reviewer_manager_name")), '');

UPDATE "case_current" SET "responsible_party_manager_name" = substr("responsible_party_manager_name", 8) WHERE "responsible_party_manager_name" LIKE 'i:0#.w|%';
UPDATE "case_current" SET "responsible_party_manager_name" = replace("responsible_party_manager_name", rtrim("responsible_party_manager_name", replace("responsible_party_manager_name", '\', '')), '') WHERE "responsible_party_manager_name" LIKE '%\%';
UPDATE "case_current" SET "responsible_party_manager_name" = NULLIF(lower(trim("responsible_party_manager_name")), '');

UPDATE "case_current" SET "voided_by_name" = substr("voided_by_name", 8) WHERE "voided_by_name" LIKE 'i:0#.w|%';
UPDATE "case_current" SET "voided_by_name" = replace("voided_by_name", rtrim("voided_by_name", replace("voided_by_name", '\', '')), '') WHERE "voided_by_name" LIKE '%\%';
UPDATE "case_current" SET "voided_by_name" = NULLIF(lower(trim("voided_by_name")), '');
