```python
"""Whether a database declares its own shape — the one probe, and the one name.

A database carrying a ``schema_migrations`` ledger is **under migration
control**: its tables, keys and indexes are declared by the numbered SQL files
under ``migrations/<subject>/<database>/`` and applied by ``python -m cli
migrate``. One without the ledger has always had its shape born from Python —
``frame.to_sql(...)`` creating whatever the frame happened to carry — and keeps
behaving exactly that way.

The ledger's *presence* is the whole opt-in, which is why the probe lives here
rather than beside the runner that writes it. Both sides need it and they sit on
opposite sides of the framework/tools line: the Writers (``framework.io``) ask it
before deciding whether they may create a missing table, and ``tools.migrations``
asks it to report what a database is. The framework must not import the upper
``tools`` layer, so the shared fact — the table's name, and how to look for it —
is settled down here and ``tools.migrations`` imports it upward. That keeps one
definition of what "migrated" means; two would be a silent disagreement between
what the runner writes and what the Writers look for.
"""

from __future__ import annotations

import sqlite3

__all__ = ["LEDGER_TABLE", "under_migration_control"]

# The per-database ledger of applied migrations. Its presence is what marks a
# database as under migration control, so the name is a constant shared by the
# runner that creates it and the Writers that read it, never an inline literal.
LEDGER_TABLE = "schema_migrations"


def under_migration_control(con: sqlite3.Connection) -> bool:
    """Whether the database behind ``con`` carries the migrations ledger.

    One ``sqlite_master`` lookup, materialising nothing: cheap enough for a
    Writer to ask, and it never creates or alters anything, so asking the
    question about a database says nothing new about it.
    """
    row = con.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (LEDGER_TABLE,),
    ).fetchone()
    return row is not None

```
