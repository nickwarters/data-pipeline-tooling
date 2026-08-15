"""Baseline DDL: what a table's shape *is*, written out as SQL.

A database's first migration has to describe the tables it already writes. That
description has to come from the code rather than from someone's memory of it,
which is what this module renders — and there are exactly two honest sources for
it, because the pipelines have two kinds of table:

*A declared dataclass*, for every table whose shape a feed states up front. The
declared Python type maps to the SQLite type ``pandas.to_sql`` would have created
for the dtype ``SchemaCoercion`` produces, so a generated baseline reproduces
today's physical shape rather than an idealised one.

*A live table*, for everything with no dataclass to declare it — a gold aggregate
whose columns are whatever its transform computed, a quarantine reject table, a
raw landing table. Introspecting a database a real run produced is the only
faithful answer for those, and it is faithful for the declared ones too, which is
why the generator cross-checks one against the other rather than choosing.

**Deterministic output.** Column order follows the source (declaration order, or
the table's own), formatting is fixed, and nothing is derived from a clock or a
path. Regenerating a baseline whose inputs have not changed produces a byte-
identical file, so the drift test can regenerate and diff.

Nothing here writes to a database or decides *which* tables a subject has. It
renders SQL text; :mod:`scripts.generate_baseline_migrations` knows the subjects
and :mod:`tools.migrations` applies the result.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import date, datetime

from framework._internal.schema import _declared_fields
from framework.core.protocols import RUN_PROVENANCE_COLUMN
from framework.io.sql import quote_identifier

__all__ = [
    "DEFAULT_COLUMN_TYPE",
    "PROVENANCE_COLUMN",
    "SQLITE_TYPES",
    "Column",
    "columns_of_schema",
    "columns_of_table",
    "render_create_table",
    "render_migration",
    "sqlite_type_for",
]

# Declared Python type -> the SQLite type ``pandas.to_sql`` creates for it today.
#
# Not a preference: it is what the current physical tables *are*. ``str`` reaches
# storage as an object column (TEXT), ``int``/``float`` as int64/float64
# (INTEGER/REAL), ``bool`` as pandas' nullable boolean, which pandas writes as
# INTEGER, and ``date``/``datetime`` as datetime64, which it writes as TIMESTAMP.
# SQLite's affinity rules mean the name matters less than the family, but a
# baseline that reproduces the existing names is one nobody has to reason about.
SQLITE_TYPES: dict[type, str] = {
    str: "TEXT",
    int: "INTEGER",
    float: "REAL",
    bool: "INTEGER",
    date: "TIMESTAMP",
    datetime: "TIMESTAMP",
}

# What an undeclared column gets. TEXT is SQLite's most permissive affinity, so a
# column whose type nobody stated stores whatever arrives rather than coercing it.
DEFAULT_COLUMN_TYPE = "TEXT"

# The reserved provenance column every table-backed Writer stamps (ADR-0020). It
# is the framework's column rather than the feed's, so no dataclass declares it
# and every baseline has to add it explicitly.
PROVENANCE_COLUMN = RUN_PROVENANCE_COLUMN


@dataclass(frozen=True)
class Column:
    """One column of a baseline: its name and the SQLite type it is declared as."""

    name: str
    type: str

    def render(self) -> str:
        return f"{quote_identifier(self.name)} {self.type}"


def sqlite_type_for(declared: type) -> str:
    """The SQLite type a declared Python type lands as, or TEXT if unknown.

    An unmapped type falls back rather than raising: a schema carrying one is a
    configuration error that :class:`~framework.core.schema.SchemaValidator`
    reports at build time naming the field, which is a better answer than this
    module refusing to describe the rest of the table.
    """
    return SQLITE_TYPES.get(declared, DEFAULT_COLUMN_TYPE)


def columns_of_schema(schema: type, *, provenance: bool = True) -> list[Column]:
    """The columns a declared row schema lands, in declaration order.

    ``provenance`` appends the reserved run-provenance column, which every
    table-backed Writer stamps and no dataclass declares. Pass ``False`` for a
    table nothing stamps.
    """
    columns = [
        Column(name, sqlite_type_for(declared))
        for name, declared in _declared_fields(schema)
    ]
    if provenance:
        columns.append(Column(PROVENANCE_COLUMN, "TEXT"))
    return columns


def columns_of_table(con: sqlite3.Connection, table: str) -> list[Column]:
    """The columns a live table actually has, in its own order.

    The faithful source for a table no dataclass declares. ``PRAGMA table_info``
    reports the declared type of each column, which for a pandas-created table is
    exactly the type this module's mapping is derived from — so introspecting a
    real run and generating from a schema agree where both are available, and
    the generator checks that they do.
    """
    rows = con.execute(f"PRAGMA table_info({quote_identifier(table)})").fetchall()
    # PRAGMA table_info yields (cid, name, type, notnull, default, pk).
    return [Column(row[1], row[2] or DEFAULT_COLUMN_TYPE) for row in rows]


def render_create_table(table: str, columns: list[Column]) -> str:
    """One ``CREATE TABLE`` statement, one column per line.

    No ``IF NOT EXISTS``: a baseline runs once against a database that does not
    have the table, and a migration that quietly does nothing when the table is
    already there would hide exactly the drift the ledger exists to catch.
    """
    if not columns:
        raise ValueError(f"cannot render {table!r}: no columns")
    body = ",\n".join(f"    {column.render()}" for column in columns)
    return f"CREATE TABLE {quote_identifier(table)} (\n{body}\n);"


def render_migration(tables: dict[str, list[Column]], *, header: str = "") -> str:
    """A whole baseline migration file: a header comment, then the tables.

    Table order is the caller's, not sorted here: a subject's tables read best in
    the order its pipeline writes them, and the caller is what knows that order.
    """
    parts = []
    if header:
        parts.append("\n".join(f"-- {line}".rstrip() for line in header.splitlines()))
    parts.extend(
        render_create_table(table, columns) for table, columns in tables.items()
    )
    return "\n\n".join(parts) + "\n"
