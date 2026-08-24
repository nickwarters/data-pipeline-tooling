-- The SelectionPool carries no Question Bank reference. The review platform
-- derives which bank to present from its own Case Type configuration;
-- nothing Selection knows feeds that choice, so the column an earlier shape
-- stamped (one hardcoded id per run) is dropped rather than left half-true.
ALTER TABLE "selection_pool" DROP COLUMN "question_bank_id";
