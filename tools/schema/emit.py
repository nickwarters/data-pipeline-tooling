"""Turn a declared ``Table``'s drift into migration SQL text.

``migrations make`` cannot diff a declaration against a *live* database the
way ``tools.schema.live`` does -- a migration file is one artifact shared by
every environment, and no single environment's live shape is the right
baseline for it. Instead it diffs against the shape the migrations tree has
already **committed to writing**, obtained by *applying* that scope's
committed migrations to a throwaway in-memory SQLite database and reading the
result back with ``PRAGMA table_info`` -- the same read
``tools.schema.live.read_live_table`` performs against a real environment.

**SQLite is the parser.** The cheaper alternative -- a narrow
regular-expression parser over the ``CREATE TABLE`` /
``ALTER TABLE ADD COLUMN`` statements this generator writes -- looks sufficient,
because the generator wrote every statement it needs to read. It is wrong the
moment a file is hand-edited, which the workflow expects: a hand-added backfill
is normal, and ``migrations/README.md`` documents SQLite's 12-step table-rebuild
recipe for the changes ``ALTER TABLE`` cannot express. A rebuild
(``CREATE TABLE t_new`` / ``INSERT`` / ``DROP TABLE t`` /
``ALTER TABLE t_new RENAME TO t``), a ``DROP COLUMN`` or a ``RENAME COLUMN``
are all invisible to such a parser, which then *silently* reports a stale
shape -- making ``migrations make`` emit a duplicate ``ADD COLUMN`` that fails
at apply time, or skip a column the database genuinely needs. Replaying
through SQLite itself gets every one of those right, for free, and anything
SQLite rejects is a hard error naming the file
(:class:`MigrationReplayError`) rather than a guess.

Only the mechanical column-level diff is ever emitted:

- a never-created table -> ``CREATE TABLE`` from its declared columns;
- a declared column missing from the tracked shape -> ``ALTER TABLE ... ADD COLUMN``.

A type change (SQLite's ``ALTER TABLE`` cannot retype a column) and an
undeclared extra column emit nothing mechanical -- see
``migrations/README.md``'s 12-step rebuild recipe for the former; the
generated file names the file and leaves it to a human either way.

Two things this module is careful never to do silently (see
``docs/schema-declaration.md``):

- **Bake in the raw-is-not-yet-TEXT accident.** A raw ``Table`` whose declared
  columns aren't all ``TEXT`` reflects the dtype-inferring ``CsvReader``, not
  the design intent (raw is meant to be TEXT throughout) -- the generated file
  says so loudly rather than presenting the type as intended.
- **Auto-emit ``primary_key``/``indexes``.** ``tools.schema.live`` diffs
  columns only (see its docstring), and several bundled tables land via a
  Writer that replaces the whole table on every run (``Refresh`` /
  ``AccumulateByRun`` -- ``frame.to_sql(if_exists="replace")`` recreates a bare
  table with no constraints), which would silently erase a migration-created
  ``PRIMARY KEY``/index on the very next pipeline run. Emitting a constraint
  ``schema diff`` never re-verifies, that the table's own Writer may then
  immediately erase, would be actively misleading rather than merely
  incomplete -- so the generator never emits them; it leaves a comment naming
  what is declared and why it was left out, for a human to add only where the
  table's Writer strategy genuinely depends on it (e.g. an ``InsertOrIgnore``
  target's conflict resolution).
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterable
from typing import TYPE_CHECKING

from framework._internal.connection import connect

# The one place a migration file's statement boundaries are decided, reused so
# a replay splits a file exactly the way ``migrate`` will apply it.
from tools.migrations.runner import split_sql_statements
from tools.schema.declaration import Column, Table
from tools.schema.live import TableDiff

if TYPE_CHECKING:  # pragma: no cover - typing only
    from tools.migrations.discovery import Migration

__all__ = [
    "MigrationReplayError",
    "replay_tracked_shapes",
    "tracked_columns_for",
    "slug_for",
    "generate_migration_sql",
]


class MigrationReplayError(Exception):
    """A committed migration could not be replayed to read the tracked shape."""


def _columns_of(con: sqlite3.Connection, table: str) -> tuple[Column, ...]:
    # PRAGMA table_info yields (cid, name, type, notnull, dflt_value, pk) --
    # read the same way tools.schema.live reads a real environment.
    rows = con.execute(f'PRAGMA table_info("{table}")').fetchall()
    return tuple(
        Column(row[1], (row[2] or "TEXT").upper(), nullable=not bool(row[3]))
        for row in rows
    )


def replay_tracked_shapes(
    migrations: Iterable[Migration],
) -> dict[str, tuple[Column, ...]]:
    """Every table shape ``migrations`` build, by applying them to a scratch database.

    ``migrations`` is the scope's committed files in version order (see
    ``tools.migrations.topology.compose_for_subject_layer``). They are applied
    to a throwaway in-memory SQLite database -- so SQLite, not a regex, decides
    what each statement means -- and the resulting tables are read back with
    ``PRAGMA table_info``. Hand-added DML (a backfill) simply runs against an
    empty table and changes no shape; a 12-step rebuild, a ``DROP COLUMN`` or a
    ``RENAME COLUMN`` is reflected exactly.

    Raises :class:`MigrationReplayError`, naming the file, for anything SQLite
    refuses -- which is the same refusal ``migrate`` would hit against a real
    database, surfaced at authoring time instead of at apply time. Never
    guesses: a file this cannot replay stops the command.
    """
    con = connect(":memory:")
    try:
        for migration in migrations:
            try:
                statements = split_sql_statements(migration.sql_text())
            except ValueError as exc:
                raise MigrationReplayError(f"{migration.path}: {exc}") from exc
            for statement in statements:
                try:
                    con.execute(statement)
                except sqlite3.Error as exc:
                    raise MigrationReplayError(
                        f"{migration.path}: SQLite rejected this statement while "
                        f"replaying the committed migrations tree to work out the "
                        f"shape it already tracks: {exc}. A committed migration "
                        "must be valid SQL that applies cleanly on top of the "
                        "migrations before it -- fix the file (or the one it "
                        f"depends on) and re-run. Statement: {statement.strip()!r}"
                    ) from exc
        names = [
            row[0]
            for row in con.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
            )
        ]
        return {name: _columns_of(con, name) for name in names}
    finally:
        con.close()


def tracked_columns_for(
    table_name: str, migrations: Iterable[Migration]
) -> tuple[Column, ...] | None:
    """One table's tracked shape, or ``None`` if ``migrations`` never create it.

    ``None`` is "pending", in the same sense ``tools.schema.live`` uses the word
    for a table that has never landed live. A convenience over
    :func:`replay_tracked_shapes` for a caller interested in a single table;
    replay the scope once and index the result when there are several.
    """
    return replay_tracked_shapes(migrations).get(table_name)


def slug_for(table: Table, diff: TableDiff) -> str:
    """A mechanical, filename-safe slug describing what this migration does."""
    if not diff.landed:
        return f"create_{table.name}"
    if diff.missing_column_names:
        return ("add_" + "_".join(diff.missing_column_names))[:60]
    return f"update_{table.name}"  # pragma: no cover - unreachable: no other diff kind


def _looks_like_raw_type_drift(table: Table) -> bool:
    """Whether ``table`` is a raw landing site declared with a non-TEXT column.

    Heuristic, not exact -- it flags any raw ``Table`` that isn't pure
    ``text_columns(...)``, which is exactly the population
    ``docs/schema-declaration.md`` says reflects the current dtype-inferring
    ``CsvReader`` rather than the design intent.
    """
    is_raw = table.namespace.rsplit("/", 1)[-1] == "raw"
    return is_raw and any(column.sql_type != "TEXT" for column in table.columns)


def _raw_text_caveat() -> str:
    return (
        "-- NOTE: raw is meant to be TEXT throughout (docs/schema-declaration.md);\n"
        "-- the non-TEXT column(s) below reflect this repo's dtype-inferring\n"
        "-- CsvReader, not the design intent. Do not read this file as declaring\n"
        "-- that raw should be typed -- the fix belongs upstream, in the reader.\n"
        "-- Once it is fixed, correcting this table is a *new* forward migration\n"
        "-- (a 12-step rebuild -- see migrations/README.md), not an edit here.\n"
    )


def _pk_index_caveat(table: Table) -> str:
    bits = []
    if table.primary_key:
        bits.append(f"primary_key={table.primary_key!r}")
    if table.indexes:
        bits.append(f"indexes={table.indexes!r}")
    return (
        f"-- NOTE: this table declares {' and '.join(bits)}, which this generator\n"
        "-- does not emit -- tools.schema.live diffs columns only, and this\n"
        "-- table's Writer may replace the whole table on every run (Refresh /\n"
        "-- AccumulateByRun), which would silently erase a migration-created\n"
        "-- constraint on the very next pipeline write. Add it by hand only if\n"
        "-- this table's Writer genuinely depends on it (see docs/migrations.md).\n"
    )


def generate_migration_sql(
    table: Table,
    feed: str,
    diff: TableDiff,
    *,
    version: str,
    namespace: str | None = None,
) -> str | None:
    """The full migration file text for ``table``'s pending drift, or ``None``.

    ``None`` when there is nothing mechanical to emit: a live-only
    (undeclared) column (never auto-dropped) or a pure type mismatch (SQLite's
    ``ALTER TABLE`` cannot retype a column in place -- see the 12-step rebuild
    recipe in ``migrations/README.md``). Both leave the table's drift for a
    human to resolve by hand rather than generating something wrong.
    """
    label = f"{namespace or table.namespace}/{table.name}"
    statements: list[str]
    description: str
    if not diff.landed:
        clauses = [
            f"    {column.name} {column.sql_type}"
            + ("" if column.nullable else " NOT NULL")
            for column in table.columns
        ]
        statements = [f"CREATE TABLE {table.name} (\n" + ",\n".join(clauses) + "\n);"]
        description = f"create {label}"
    elif diff.missing_column_names:
        added_names = diff.missing_column_names
        by_name = {column.name: column for column in table.columns}
        statements = []
        for name in added_names:
            column = by_name[name]
            clause = (
                f"ALTER TABLE {table.name} ADD COLUMN {column.name} {column.sql_type}"
            )
            if not column.nullable:
                # SQLite refuses a NOT NULL column added to a populated table
                # with no DEFAULT; a mechanical, always-valid placeholder --
                # review (and very likely replace) before committing.
                placeholder = "''" if column.sql_type == "TEXT" else "0"
                clause += f" NOT NULL DEFAULT {placeholder}"
            statements.append(clause + ";")
        description = f"add {', '.join(added_names)} to {label}"
    else:
        return None

    preamble = ""
    if _looks_like_raw_type_drift(table):
        preamble += _raw_text_caveat() + "\n"
    if table.primary_key or table.indexes:
        preamble += _pk_index_caveat(table) + "\n"

    header = (
        f"-- generated from pipelines/{feed}'s declared TABLES at declaration "
        f"rev {version}\n"
        f"-- description: {description}\n"
        "-- review this file; it is applied exactly as written\n\n"
    )
    return header + preamble + "\n".join(statements) + "\n"
