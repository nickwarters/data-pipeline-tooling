"""Rendering a table's shape as SQL, from a declaration or from a live table."""

import sqlite3
from dataclasses import dataclass
from datetime import date, datetime

import pandas as pd
import pytest

from framework.core.protocols import RUN_PROVENANCE_COLUMN
from tools.baseline_ddl import (
    Column,
    columns_of_schema,
    columns_of_table,
    render_create_table,
    render_migration,
    sqlite_type_for,
)


@dataclass(frozen=True)
class EveryType:
    """One field per declared type the mapping covers."""

    text: str
    whole: int
    fractional: float
    flag: bool
    day: date
    instant: datetime


def test_every_declared_type_maps_to_the_type_pandas_would_have_created(tmp_path):
    # The mapping is not a preference — it is what the existing physical tables
    # *are*. So it is checked against pandas itself, on the dtypes SchemaCoercion
    # produces, rather than asserted from memory: if a pandas upgrade changed one,
    # a generated baseline would stop reproducing today's shape and this fails.
    frame = pd.DataFrame(
        {
            "text": pd.Series([], dtype="object"),
            "whole": pd.Series([], dtype="int64"),
            "fractional": pd.Series([], dtype="float64"),
            "flag": pd.Series([], dtype="boolean"),
            "day": pd.Series([], dtype="datetime64[ns]"),
            "instant": pd.Series([], dtype="datetime64[ns]"),
        }
    )
    con = sqlite3.connect(tmp_path / "t.db")
    try:
        frame.to_sql("t", con, if_exists="replace", index=False)
        by_pandas = {row[1]: row[2] for row in con.execute("PRAGMA table_info(t)")}
    finally:
        con.close()

    declared = {column.name: column.type for column in columns_of_schema(EveryType)}

    assert {k: declared[k] for k in by_pandas} == by_pandas


def test_an_unmapped_declared_type_falls_back_to_text():
    # A schema carrying an unsupported type is a configuration error the
    # SchemaValidator reports at build time naming the field. Refusing to
    # describe the rest of the table here would be a worse answer.
    assert sqlite_type_for(complex) == "TEXT"


def test_a_schema_lands_its_fields_in_declaration_order_plus_provenance(tmp_path):
    columns = columns_of_schema(EveryType)

    assert [c.name for c in columns] == [
        "text",
        "whole",
        "fractional",
        "flag",
        "day",
        "instant",
        RUN_PROVENANCE_COLUMN,
    ]


def test_provenance_can_be_left_off_for_a_table_nothing_stamps():
    columns = columns_of_schema(EveryType, provenance=False)

    assert RUN_PROVENANCE_COLUMN not in [c.name for c in columns]


def test_a_live_table_reports_its_own_columns_in_its_own_order(tmp_path):
    # The faithful source for a table no dataclass declares — a gold aggregate,
    # a quarantine reject table, a raw landing table.
    db = tmp_path / "gold.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE counts (reviewer TEXT, status TEXT, cases INTEGER)")
    con.commit()
    try:
        columns = columns_of_table(con, "counts")
    finally:
        con.close()

    assert [(c.name, c.type) for c in columns] == [
        ("reviewer", "TEXT"),
        ("status", "TEXT"),
        ("cases", "INTEGER"),
    ]


def test_a_column_with_no_declared_type_reads_as_text(tmp_path):
    con = sqlite3.connect(tmp_path / "t.db")
    con.execute("CREATE TABLE loose (whatever)")
    con.commit()
    try:
        assert columns_of_table(con, "loose") == [Column("whatever", "TEXT")]
    finally:
        con.close()


def test_a_rendered_table_is_valid_sql_that_creates_what_it_describes(tmp_path):
    # The test that matters: the text is not just plausible, it runs, and the
    # table it makes has the columns it named.
    sql = render_create_table("cases", columns_of_schema(EveryType))
    con = sqlite3.connect(tmp_path / "t.db")
    try:
        con.execute(sql)
        assert [c.name for c in columns_of_table(con, "cases")] == [
            c.name for c in columns_of_schema(EveryType)
        ]
    finally:
        con.close()


def test_a_rendered_table_does_not_say_if_not_exists():
    # A baseline runs once against a database that does not have the table. One
    # that quietly did nothing when the table was already there would hide
    # exactly the drift the ledger exists to catch.
    sql = render_create_table("cases", [Column("case_id", "TEXT")])

    assert "IF NOT EXISTS" not in sql


def test_rendering_a_table_with_no_columns_is_refused():
    with pytest.raises(ValueError, match="no columns"):
        render_create_table("cases", [])


def test_a_migration_keeps_the_callers_table_order_and_comments_its_header():
    sql = render_migration(
        {
            "case_version": [Column("case_id", "TEXT")],
            "answer": [Column("question_id", "TEXT")],
        },
        header="Baseline for cases/silver.\n\nMaintained by hand.",
    )

    assert sql.startswith("-- Baseline for cases/silver.\n--\n-- Maintained by hand.")
    assert sql.index("case_version") < sql.index("answer")
    assert sql.endswith(";\n")


def test_rendering_is_deterministic():
    # The drift test regenerates and diffs, so the same inputs must produce the
    # same bytes — nothing here may depend on a clock, a path or a set's order.
    first = render_migration({"cases": columns_of_schema(EveryType)}, header="x")
    second = render_migration({"cases": columns_of_schema(EveryType)}, header="x")

    assert first == second


def test_an_identifier_that_needs_quoting_gets_it(tmp_path):
    sql = render_create_table("odd table", [Column("select", "TEXT")])
    con = sqlite3.connect(tmp_path / "t.db")
    try:
        con.execute(sql)  # a bare identifier here would be a syntax error
        assert [c.name for c in columns_of_table(con, "odd table")] == ["select"]
    finally:
        con.close()
