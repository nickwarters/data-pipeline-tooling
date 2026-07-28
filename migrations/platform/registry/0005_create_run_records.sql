-- generated from tools/observability/record_schema.py (RUN_RECORD_FIELDS)
-- description: create the run_records table for a fresh registry database
-- review this file; it is applied exactly as written

-- This is the platform/registry scope's one job: give a *fresh* registry
-- database (one ``migrate`` creates before any pipeline has run) the same
-- run_records shape RunRegistry._migrate() would otherwise create lazily on
-- first open. RunRegistry keeps its own self-heal (tools/observability/run_registry.py)
-- as the safety net for every database this migration predates or that a
-- process opens without ever running `migrate` first -- this file does not
-- replace that, and RunRegistry's own migration is untouched by this step.
-- The column list is derived by hand from RUN_RECORD_FIELDS at the time this
-- file was written; a later field added there needs its own migration here,
-- exactly like any other table's drift (RunRegistry's self-heal covers it in
-- the meantime).
CREATE TABLE IF NOT EXISTS run_records (
    timestamp         TEXT,
    pipeline_run_id   TEXT NOT NULL,
    logical_run_id    TEXT,
    pipeline          TEXT,
    step              TEXT NOT NULL,
    step_address      TEXT,
    step_ordinal      INTEGER NOT NULL,
    status            TEXT,
    rows_in           INTEGER,
    rows_out          INTEGER,
    rows_quarantined  INTEGER,
    rows_excluded     INTEGER,
    duration          REAL,
    errors            TEXT,
    error_category    TEXT,
    warn_hits         TEXT,
    committed         INTEGER,
    profile           TEXT,
    PRIMARY KEY (pipeline_run_id, step, step_ordinal)
);
