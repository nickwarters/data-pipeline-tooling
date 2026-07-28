-- generated from pipelines/comprehensive_examples's declared TABLES at declaration rev 0021
-- description: create adviser_reference/raw/advisers
-- review this file; it is applied exactly as written

-- NOTE: raw is meant to be TEXT throughout (docs/schema-declaration.md);
-- the non-TEXT column(s) below reflect this repo's dtype-inferring
-- CsvReader, not the design intent. Do not read this file as declaring
-- that raw should be typed -- the fix belongs upstream, in the reader.

CREATE TABLE advisers (
    adviser_id TEXT,
    region TEXT,
    team TEXT,
    active_flag INTEGER
);
