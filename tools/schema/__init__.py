"""Declared table shapes and their drift against a live environment.

A Case Type's ``Schema`` dataclass (``framework.core.SchemaValidator``) is the
*validation* contract — column names, dtypes, and value rules, enforced as data
flows through a pipeline. This package declares a **sibling, storage-facing**
contract: which tables a feed *lands*, and their expected shape as a real
database sees it (columns, a primary key, indexes). The two contracts read the
same dataclasses where a feed has one, but they answer different questions —
"is this row valid?" versus "does the live table still look like we declared
it?" — and this package never extends or replaces the validation dataclasses.

``Table`` / ``Column`` / ``Index`` are the declaration vocabulary;
``columns_of`` / ``text_columns`` are the two ways a feed builds a ``Table``'s
column list (from a row dataclass, or as a flat list of ``TEXT`` columns for a
schema-light raw landing zone); ``diff_tables`` compares one declared ``Table``
against what a live database actually contains. ``tools.schema.emit`` is the
sibling that turns a declaration's drift into migration SQL text for
``migrations make`` (``tools.migrations``) to write -- authoring stays here,
next to the declaration it reads; applying lives in ``tools.migrations``.
Application infrastructure — a sibling ``tools`` package, not framework
vocabulary; see [`docs/schema-declaration.md`](../../docs/schema-declaration.md)
and [`docs/migrations.md`](../../docs/migrations.md).
"""

from __future__ import annotations

from tools.schema.declaration import (
    ACCUMULATE_BY_RUN_COLUMNS,
    ACCUMULATE_BY_RUN_CONTEXT_COLUMNS,
    Column,
    Index,
    Table,
    collect_declared_tables,
    columns_of,
    resolved_namespace,
    retype,
    text_columns,
)
from tools.schema.emit import (
    MigrationReplayError,
    generate_migration_sql,
    replay_tracked_shapes,
    slug_for,
    tracked_columns_for,
)
from tools.schema.live import LiveTable, TableDiff, diff_tables, read_live_table

__all__ = [
    "ACCUMULATE_BY_RUN_COLUMNS",
    "ACCUMULATE_BY_RUN_CONTEXT_COLUMNS",
    "Column",
    "Index",
    "Table",
    "collect_declared_tables",
    "columns_of",
    "resolved_namespace",
    "retype",
    "text_columns",
    "LiveTable",
    "TableDiff",
    "diff_tables",
    "read_live_table",
    "generate_migration_sql",
    "slug_for",
    "tracked_columns_for",
    "replay_tracked_shapes",
    "MigrationReplayError",
]
