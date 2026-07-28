-- generated from pipelines/comprehensive_examples's declared TABLES at declaration rev 0018
-- description: create complex_cases/raw/cases
-- review this file; it is applied exactly as written

-- NOTE: raw is meant to be TEXT throughout (docs/schema-declaration.md);
-- the non-TEXT column(s) below reflect this repo's dtype-inferring
-- CsvReader, not the design intent. Do not read this file as declaring
-- that raw should be typed -- the fix belongs upstream, in the reader.

CREATE TABLE cases (
    case_ref TEXT,
    customer_id TEXT,
    adviser_id TEXT,
    opened_date TEXT,
    risk_band TEXT,
    vulnerable_flag INTEGER,
    exposure_amount INTEGER
);
