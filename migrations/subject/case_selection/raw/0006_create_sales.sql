-- generated from pipelines/case_selection's declared TABLES at declaration rev 0006
-- description: create case_selection/raw/sales
-- review this file; it is applied exactly as written

-- NOTE: raw is meant to be TEXT throughout (docs/schema-declaration.md);
-- the non-TEXT column(s) below reflect this repo's dtype-inferring
-- CsvReader, not the design intent. Do not read this file as declaring
-- that raw should be typed -- the fix belongs upstream, in the reader.

CREATE TABLE sales (
    sale_id TEXT,
    adviser TEXT,
    sale_date TEXT,
    risk_score INTEGER,
    category TEXT,
    product TEXT
);
