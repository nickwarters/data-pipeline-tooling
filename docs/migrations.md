# SQL migrations — the shape of a medallion database

A medallion database's physical shape — its tables, primary keys, indexes and
`NOT NULL`s — is declared by numbered `.sql` files and applied by the migration
runner in [`tools/migrations.py`](../tools/migrations.py). This page covers the
runner: the layout it reads, the ledger it writes, and the rules it enforces.

> **Status.** The runner exists; nothing is under migration control yet. The
> `migrations/` tree, the `python -m cli migrate` command, and the writer
> behaviour that a migrated database earns are separate pieces of the same
> epic. Until a subject has a migrations directory, everything behaves exactly
> as it did before.

## Layout

```
migrations/
  <subject>/
    raw/0001_create_initial_tables.sql
    silver/0001_create_initial_tables.sql
    gold/0001_create_initial_tables.sql
```

One directory per **subject-layer**, mirroring the medallion's on-disk
`<base_dir>/<subject>/{raw,silver,gold}.db` — so a database and the files that
shape it are found the same way. `tools.migrations.migrations_directory(subject,
layer)` owns that mapping; `MIGRATIONS_ROOT` is the repository's `migrations/`
tree.

**A file is named `<0000>_<description>.sql`.** The four-digit version is
fixed-width so a directory listing, a shell glob and the runner all put the
files in the same order. A `.sql` file whose name does not parse is an error
naming the file, as are two files claiming one version — the classic accident of
two branches each adding an `0002`. Non-`.sql` entries (a `README.md`, the
`.DS_Store` a macOS checkout grows unasked) are ignored rather than rejected.

## The ledger

Each database carries its own record of what it has applied, in a
`schema_migrations` table inside it:

| Column | Meaning |
|--------|---------|
| `name` | The file name — the ledger key (`0001_create_initial_tables.sql`). |
| `checksum` | SHA-256 of the file's text, newline-normalised. |
| `applied_at` | The UTC instant it was applied, as ISO-8601 text. |

A database is therefore self-describing: what it has applied is stored *in* it,
not in a central register that could disagree with the file in front of you.
It is modelled on the `registry_migrations` ledger in
[`tools/observability/run_registry.py`](../tools/observability/run_registry.py),
with the checksum added.

**The ledger's presence is the opt-in.** A database carrying the table is under
migration control and is expected to have been shaped by SQL; one without it
behaves exactly as it always has. `is_under_migration_control(db_path)` is the
cheap, side-effect-free check for that — a database that does not exist is not
created just to answer `False`. That is what lets subjects convert one at a
time.

Run metadata is **out of scope**: `_registry/runs.db` and
`_orchestration/runs.db` self-migrate from `RUN_RECORD_FIELDS` and stay that
way. Two migration mechanisms on one file would be worse than one.

## Using the runner

```python
from tools.migrations import MigrationRunner, migrations_directory

runner = MigrationRunner(
    base_dir / "sharepoint_cases" / "silver.db",
    migrations_directory("sharepoint_cases", "silver"),
)

runner.pending()   # -> [Migration, ...]  what apply() would do; writes nothing
runner.apply()     # -> [Migration, ...]  what it did, in order
runner.applied()   # -> [AppliedMigration, ...]  the ledger's contents
```

`pending` is separate from `apply` so an operator can be told what is
outstanding without anything being written — no transaction, no database file
created, no ledger created. Nothing is written when the database is already
current, either: production is a UNC share where WAL is unavailable and a
writer's lock is exclusive, so a report that took a write lock would stall every
running pipeline.

## The three rules

**One transaction per file.** A file's statements *and* its ledger row commit
together, so a crash part-way leaves no row and the file is simply retried once
it is fixed — there is no manual ledger surgery in the recovery path. Each file
gets its own transaction rather than the whole batch sharing one, for the same
share-locking reason: a long batch holding a single transaction locks readers
out for its whole duration. The first failure aborts the run — the files before
it stay applied, the failing one leaves neither DDL nor a ledger row, and the
ones after it are untouched.

**An edited migration is an error.** An already-applied file whose checksum no
longer matches is refused, not silently skipped: it means the database and the
file that claims to describe it have quietly diverged. The check covers every
discovered file, not just the ones ahead of the first pending one — a newer
migration must not be applied on top of a database whose earlier shape is no
longer what its migration says. To change a table, add a migration; do not edit
one that has run. The converse — a ledger row whose file has since been
*deleted* — is deliberately not checked, since a file can be moved between
directories for reasons that are not drift.

**Line endings do not count as an edit.** The checksum is taken over the file's
text read with universal newlines, so a CRLF checkout on Windows and an LF one
on macOS agree. The framework deploys to Windows and is developed on macOS; a
checksum that disagreed across the two would make every migration look rewritten
on the other box.

## See also

- [`run-log-format.md`](run-log-format.md) — the run record schema and the
  registry's own, separate, self-migrating store.
- [`adr/0001-sqlite-per-subject-medallion-store.md`](adr/0001-sqlite-per-subject-medallion-store.md)
  — why a subject's layers are three SQLite files.
