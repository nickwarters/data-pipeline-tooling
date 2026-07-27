"""The run-record schema is declared once, and every surface derives from it.

The declaration is a live on-disk contract: the JSONL key order and the stored
column order are what existing run logs and registry databases already contain.
These tests pin that contract literally, so a reordering or a dropped field
fails here rather than on the share.
"""

import json
import sqlite3

import pytest

from tools.observability.record_schema import (
    LOGGED_RUN_RECORD_FIELDS,
    RUN_RECORD_COLUMNS,
    RUN_RECORD_FIELDS,
    RUN_RECORD_PRIMARY_KEY,
    Field,
    build_run_record,
    console_parts,
    create_table_sql,
    ensure_columns,
    insert_sql,
    select_columns,
)

# The record as it exists on disk today, in order. Changing this list changes a
# live format: append, never reorder.
EXPECTED_LOGGED = [
    "timestamp",
    "pipeline_run_id",
    "logical_run_id",
    "pipeline",
    "step",
    "step_address",
    "status",
    "rows_in",
    "rows_out",
    "rows_quarantined",
    "rows_excluded",
    "duration",
    "errors",
    "error_category",
    "warn_hits",
    "committed",
    "params",
    "profile",
]

EXPECTED_COLUMNS = [
    ("timestamp", "TEXT"),
    ("pipeline_run_id", "TEXT"),
    ("logical_run_id", "TEXT"),
    ("pipeline", "TEXT"),
    ("step", "TEXT"),
    ("step_address", "TEXT"),
    ("step_ordinal", "INTEGER"),
    ("status", "TEXT"),
    ("rows_in", "INTEGER"),
    ("rows_out", "INTEGER"),
    ("rows_quarantined", "INTEGER"),
    ("rows_excluded", "INTEGER"),
    ("duration", "REAL"),
    ("errors", "TEXT"),
    ("error_category", "TEXT"),
    ("warn_hits", "TEXT"),
    ("committed", "INTEGER"),
    ("profile", "TEXT"),
]


def test_logged_fields_reproduce_the_jsonl_key_order():
    assert [f.name for f in LOGGED_RUN_RECORD_FIELDS] == EXPECTED_LOGGED


def test_stored_fields_reproduce_the_column_order_and_types():
    assert [(f.name, f.sql_type) for f in RUN_RECORD_COLUMNS] == EXPECTED_COLUMNS


def test_step_ordinal_is_stored_only_and_params_are_logged_only():
    by_name = {f.name: f for f in RUN_RECORD_FIELDS}
    assert not by_name["step_ordinal"].logged  # the store assigns it at ingest
    assert not by_name["params"].stored  # no column holds run parameters


def test_the_declared_table_matches_the_deployed_shape():
    # The derived DDL is compared against the statement the pre-change code
    # shipped, through the only thing that matters: the table SQLite builds.
    deployed = """
        CREATE TABLE run_records (
            timestamp        TEXT,
            pipeline_run_id  TEXT NOT NULL,
            logical_run_id   TEXT,
            pipeline         TEXT,
            step             TEXT NOT NULL,
            step_address     TEXT,
            step_ordinal     INTEGER NOT NULL,
            status           TEXT,
            rows_in          INTEGER,
            rows_out         INTEGER,
            rows_quarantined INTEGER,
            rows_excluded    INTEGER,
            duration         REAL,
            errors           TEXT,
            error_category   TEXT,
            warn_hits        TEXT,
            committed        INTEGER,
            profile          TEXT,
            PRIMARY KEY (pipeline_run_id, step, step_ordinal)
        )
    """

    def shape(sql: str) -> list[tuple]:
        con = sqlite3.connect(":memory:")
        con.execute(sql)
        info = con.execute("PRAGMA table_info(run_records)").fetchall()
        con.close()
        # (name, type, not-null, primary-key position)
        return [(row[1], row[2], row[3], row[5]) for row in info]

    derived = create_table_sql(
        "run_records", RUN_RECORD_COLUMNS, RUN_RECORD_PRIMARY_KEY
    )
    assert shape(derived) == shape(deployed)
    assert RUN_RECORD_PRIMARY_KEY == ("pipeline_run_id", "step", "step_ordinal")


def test_build_run_record_applies_the_declared_empty_defaults():
    record = build_run_record(pipeline_run_id="r1", step="read", status="ok")
    assert list(record) == EXPECTED_LOGGED
    assert record["errors"] == []
    assert record["warn_hits"] == []
    assert record["params"] == {}
    assert record["profile"] is None


def test_build_run_record_rejects_an_undeclared_field():
    with pytest.raises(TypeError, match="rows_ni"):
        build_run_record(pipeline_run_id="r1", step="read", rows_ni=3)


def test_encodings_round_trip_through_the_declaration():
    by_name = {f.name: f for f in RUN_RECORD_FIELDS}
    profile = {"row_count": 4, "columns": [{"name": "id", "null_rate": 0.0}]}
    cases = {
        "errors": (["boom"], ["boom"]),
        "warn_hits": ([], []),
        "committed": (True, True),
        "profile": (profile, profile),
        "rows_in": (3, 3),
    }
    for name, (value, expected) in cases.items():
        field = by_name[name]
        assert field.from_sql(field.to_sql(value)) == expected


def test_console_line_shows_only_the_fields_that_are_set():
    record = build_run_record(
        pipeline_run_id="r1",
        step="write",
        status="ok",
        rows_in=3,
        duration=0.5,
        committed=True,
    )
    assert console_parts(record) == ["rows_in=3", "0.500s", "committed"]


def _table_columns(con, table: str) -> list[str]:
    return [row[1] for row in con.execute(f"PRAGMA table_info({table})")]


def test_ensure_columns_adds_only_what_is_missing_and_names_it(tmp_path):
    con = sqlite3.connect(tmp_path / "old.db")
    con.execute("CREATE TABLE things (a TEXT NOT NULL, b TEXT)")
    fields = (
        Field("a", "TEXT", not_null=True),
        Field("b", "TEXT"),
        Field("c", "INTEGER"),
        Field("logged_only"),
    )

    assert ensure_columns(con, "things", fields) == {"c"}
    assert _table_columns(con, "things") == ["a", "b", "c"]
    # Idempotent: a second connection adds nothing and reports nothing added,
    # which is what lets a caller run a backfill only on the run that added it.
    assert ensure_columns(con, "things", fields) == set()
    con.close()


def test_a_new_field_reaches_every_surface_from_one_declaration(tmp_path):
    # The blast-radius proof: one entry, and the DDL, the migration, the INSERT,
    # the SELECT and the console line all carry it.
    base = (Field("name", "TEXT", not_null=True), Field("count", "INTEGER"))
    extended = base + (
        Field(
            "note",
            "TEXT",
            encode=json.dumps,
            decode=json.loads,
            console=lambda v: f"note={v}" if v else None,
        ),
    )

    con = sqlite3.connect(tmp_path / "blast.db")
    con.execute(create_table_sql("t", base))  # a store predating the new field
    assert ensure_columns(con, "t", extended) == {"note"}

    values = {"name": "a", "count": 2, "note": "hello"}
    con.execute(
        insert_sql("t", extended), tuple(f.to_sql(values[f.name]) for f in extended)
    )
    row = con.execute(f"SELECT {select_columns(extended)} FROM t").fetchone()
    con.close()

    decoded = {f.name: f.from_sql(row[i]) for i, f in enumerate(extended)}
    assert decoded == values
    # And the console form comes from the same entry — no display branch to edit.
    assert [f.console(values[f.name]) for f in extended if f.console] == ["note=hello"]
