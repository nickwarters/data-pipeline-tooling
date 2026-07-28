"""SQLite test scaffolding: give a migration-gated Writer somewhere to land.

Since #323 (on top of #322's migration runner), a table's existence is a
migration's job, not a Writer's: a Writer that would once have created its
target implicitly (``Refresh``, the merge strategies) now refuses with
``MissingTableError`` instead (see ``framework.io.writers._require_table``).
Two complementary helpers cover the two kinds of test that hit this:

- :func:`create_table` — a unit-level Writer test that drives a bare
  ``SqliteTruncateReloadWriter``/``SqliteUpsertWriter``/etc. directly against a
  throwaway ``tmp_path`` needs only *some* table with the right column names to
  land in; this mints one without pulling the migrations tree into a Writer
  test that has nothing to do with migrations.
- :func:`migrate_all` — a test that drives a *real* bundled feed (whose tables
  are already declared and migrated in this repo's own ``migrations/`` tree)
  wants those actual migrations applied, so it composes the same
  ``tools.migrations`` machinery ``python -m cli migrate`` does, in-process.

Re-exported from :mod:`tests.framework_testing`.
"""

from __future__ import annotations

import os
from pathlib import Path

from framework._internal.connection import connect
from framework.core.dataset import Dataset

__all__ = [
    "create_table",
    "migrate_all",
]

#: This repo's root — ``tests/framework_testing/sqlite.py``'s two parents up.
_REPO_ROOT = Path(__file__).resolve().parents[2]


def create_table(db_path: str | os.PathLike[str], table: str, dataset: Dataset) -> None:
    """Create ``table`` in ``db_path`` with ``dataset``'s columns, but no rows.

    A stand-in for what a migration now does: give a migration-gated Writer
    (``Refresh``, ``UpsertStrategy``, ``InsertOrIgnore``) a real table to write
    into, shaped from the very dataset the test is about to write, so the test
    stays about the Writer's behaviour rather than about migrations.

    It mints a *bare* table — column names, pandas-inferred storage types, no
    primary key, no index, no ``NOT NULL`` — which is deliberately less than a
    real migration builds. Use it for an ad hoc frame that matches no declared
    ``Table``; where the feed under test has committed migrations, prefer
    :func:`migrate_all`, which exercises the declared shape.
    """
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = connect(db_path, busy_timeout_ms=5000)
    try:
        dataset.to_pandas().iloc[:0].to_sql(table, con, if_exists="append", index=False)
        con.commit()
    finally:
        con.close()


#: The topology profile this repo's own declarations migrate under -- named
#: here rather than taken as an argument so no test has to know that topology
#: profiles exist, and so the single mention moves in one edit if they stop
#: existing. Only ``medallion`` can migrate this repo's declarations today
#: (``docs/migrations.md``), so a parameter would have exactly one legal value.
_PROFILE = "medallion"


def migrate_all(base_dir: str | os.PathLike[str]) -> None:
    """Apply every migration this repo's tree declares against ``base_dir``.

    In-process equivalent of ``python -m cli migrate --base-dir base_dir``
    (no ``--subject``/``--layer``/``--phase`` narrowing): a test that runs a
    real bundled feed end-to-end against a fresh ``tmp_path`` needs its tables
    brought into existence exactly as an operator would, rather than relying on
    a Writer to have minted them for itself.

    The coupling this buys is deliberate but real: a test using this depends on
    the committed migrations being right, so a broken migration file fails it
    for a reason unrelated to what it tests. That is the trade for exercising
    the *declared* table shape — constraints included — rather than the bare
    one :func:`create_table` mints. Prefer it wherever the feed under test has
    committed migrations; prefer :func:`create_table` for an ad hoc frame that
    matches no declaration.
    """
    from cli.migrate import DEFAULT_MIGRATIONS_ROOT
    from tools.migrations.discovery import discover_migrations
    from tools.migrations.runner import apply_database
    from tools.migrations.topology import resolve_databases

    base_dir = Path(base_dir)
    # ``DEFAULT_MIGRATIONS_ROOT`` is relative to the repo root (the CLI is run
    # from there); anchor it so a test does not depend on pytest's cwd.
    migrations = discover_migrations(_REPO_ROOT / DEFAULT_MIGRATIONS_ROOT)
    for database in resolve_databases(_PROFILE, migrations):
        apply_database(database, base_dir / database.relative_path)
