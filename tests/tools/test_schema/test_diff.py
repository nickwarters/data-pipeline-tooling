"""``diff_tables``: comparing a declaration against a live (or absent) table."""

from __future__ import annotations

from tools.schema.declaration import Column, Table
from tools.schema.live import LiveTable, diff_tables


def test_diff_of_a_never_landed_table_is_not_drift_but_not_clean_either():
    table = Table("raw", "widgets", columns=(Column("id", "TEXT"),))

    diff = diff_tables(table, None)

    assert not diff.landed
    assert not diff.drifted
    assert diff.render() == ["  widgets  (not yet landed)"]


def test_diff_of_a_matching_live_table_is_clean():
    table = Table(
        "raw", "widgets", columns=(Column("id", "TEXT"), Column("amount", "INTEGER"))
    )
    live = LiveTable(
        namespace="raw",
        name="widgets",
        columns=(Column("id", "TEXT"), Column("amount", "INTEGER")),
    )

    diff = diff_tables(table, live)

    assert diff.landed
    assert not diff.drifted
    assert diff.render() == []


def test_diff_reports_a_type_mismatch():
    table = Table("raw", "widgets", columns=(Column("amount", "TEXT"),))
    live = LiveTable(
        namespace="raw", name="widgets", columns=(Column("amount", "REAL"),)
    )

    diff = diff_tables(table, live)

    assert diff.drifted
    assert diff.render() == ["  ~ amount   declared TEXT, live REAL"]


def test_diff_reports_an_undeclared_live_only_column():
    table = Table("raw", "widgets", columns=(Column("id", "TEXT"),))
    live = LiveTable(
        namespace="raw",
        name="widgets",
        columns=(Column("id", "TEXT"), Column("adviser_code", "TEXT")),
    )

    diff = diff_tables(table, live)

    assert diff.drifted
    assert diff.render() == ["  + adviser_code   live only (undeclared)"]


def test_diff_reports_a_declared_column_missing_from_the_live_table():
    table = Table(
        "raw", "widgets", columns=(Column("id", "TEXT"), Column("case_status", "TEXT"))
    )
    live = LiveTable(namespace="raw", name="widgets", columns=(Column("id", "TEXT"),))

    diff = diff_tables(table, live)

    assert diff.drifted
    assert diff.render() == ["  - case_status   declared, missing"]


def test_diff_reports_every_kind_of_disagreement_together():
    table = Table(
        "raw",
        "widgets",
        columns=(
            Column("id", "TEXT"),
            Column("amount", "TEXT"),
            Column("status", "TEXT"),
        ),
    )
    live = LiveTable(
        namespace="raw",
        name="widgets",
        columns=(
            Column("id", "TEXT"),
            Column("amount", "REAL"),
            Column("extra", "TEXT"),
        ),
    )

    diff = diff_tables(table, live)

    assert diff.drifted
    assert set(diff.render()) == {
        "  ~ amount   declared TEXT, live REAL",
        "  + extra   live only (undeclared)",
        "  - status   declared, missing",
    }
