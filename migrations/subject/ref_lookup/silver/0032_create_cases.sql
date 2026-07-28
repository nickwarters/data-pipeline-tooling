-- generated from pipelines/ref_lookup's declared TABLES at declaration rev 0032
-- description: create ref_lookup/silver/cases
-- review this file; it is applied exactly as written

-- NOTE: this table declares primary_key=('case_ref',), which this generator
-- does not emit -- tools.schema.live diffs columns only, and this
-- table's Writer may replace the whole table on every run (Refresh /
-- AccumulateByRun), which would silently erase a migration-created
-- constraint on the very next pipeline write. Add it by hand only if
-- this table's Writer genuinely depends on it (see docs/migrations.md).

CREATE TABLE cases (
    case_ref TEXT,
    cust_ref TEXT,
    brand_id TEXT,
    channel_id TEXT,
    case_cat_1_id TEXT,
    case_cat_2_id TEXT,
    case_cat_3_id TEXT
);
