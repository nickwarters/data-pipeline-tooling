-- generated from pipelines/ref_lookup's declared TABLES at declaration rev 0033
-- description: create ref_lookup/silver/customers
-- review this file; it is applied exactly as written

-- NOTE: this table declares primary_key=('cust_ref',), which this generator
-- does not emit -- tools.schema.live diffs columns only, and this
-- table's Writer may replace the whole table on every run (Refresh /
-- AccumulateByRun), which would silently erase a migration-created
-- constraint on the very next pipeline write. Add it by hand only if
-- this table's Writer genuinely depends on it (see docs/migrations.md).

CREATE TABLE customers (
    cust_ref TEXT
);
