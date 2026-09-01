-- The silver twin of raw's `VoidReasonNote`: the Reviewer's own words behind an
-- `other` Void Reason, landed as the source holds them.
--
-- Free text, so no value rule and nothing to group on -- `void_reason` stays
-- the grouping key and this column qualifies it.

ALTER TABLE "case_version" ADD COLUMN "void_reason_note" TEXT;
