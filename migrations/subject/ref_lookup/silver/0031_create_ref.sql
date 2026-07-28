-- generated from pipelines/ref_lookup's declared TABLES at declaration rev 0031
-- description: create ref_lookup/silver/ref
-- review this file; it is applied exactly as written

-- NOTE: this table declares primary_key=('id',), which this generator
-- does not emit -- tools.schema.live diffs columns only, and this
-- table's Writer may replace the whole table on every run (Refresh /
-- AccumulateByRun), which would silently erase a migration-created
-- constraint on the very next pipeline write. Add it by hand only if
-- this table's Writer genuinely depends on it (see docs/migrations.md).

CREATE TABLE ref (
    id TEXT,
    ref_group TEXT,
    value TEXT
);
