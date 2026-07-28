# The migrations tree

**Directory path is scope. Filename is a globally ordered version + slug.
Nothing else carries meaning** — there is no manifest to keep in step with the
filesystem; `tools.migrations.discovery.discover_migrations` walks this tree
directly.

```
migrations/
  README.md
  _shared/                                          # (empty today)
  layer/{raw,silver,gold}/                          # (empty today)
  phase/{ingest,selection,sync,reporting}/          # (empty today)
  subject/complaints_a/raw/    0012_create_complaints_a.sql
  subject/complaints_a/silver/ 0013_create_complaints_a.sql
  platform/registry/           0005_create_run_records.sql
```

**The `_shared` / `layer` / `phase` scope directories are deliberately empty.**
They are recognised scopes (see the table below) and a real migration can land
in any of them, but nothing in this repo needs one yet — and a *decorative*
example there would not be decorative: everything committed under
`migrations/` is applied to every database the scope reaches, in every
environment, so an illustrative "audit columns" migration would create a real
table in production that nothing writes and nothing reads. An empty directory
is the honest state; because git does not track empty directories, they exist
in this README rather than on disk until a real migration needs one.

## The five recognised scopes

| Directory | Scope | Composed into |
|---|---|---|
| `_shared/` | Shared | **every** database, in every topology profile |
| `layer/<raw\|silver\|gold>/` | Layer | every database of that generic medallion layer |
| `phase/<ingest\|selection\|sync\|reporting>/` | Phase | every database of that phase of the Ingest → Selection → Sync → Reporting loop (`CONTEXT.md`) |
| `subject/<subject>/<raw\|silver\|gold>/` | Subject-layer | one subject's one layer — the finest-grained scope; a declared `Table` resolves here (`tools.schema.resolved_namespace`) |
| `platform/<name>/` | Platform | a fixed database outside the medallion (today: `platform/registry`, the run registry's own file) |

Any other directory shape (a typo'd layer/phase name, a stray extra segment)
fails discovery loudly — `MigrationTreeError`, naming the path — rather than
being silently skipped or silently composed into the wrong database.

**Scopes compose.** A physical database is not "one scope" — a *topology
profile* (`tools/migrations/topology.py`) decides which scopes bundle into
which file, interleaved in **version order**. Because several scopes can land
in one physical file, **versions are one sequence repo-wide, never reused** —
`discover_migrations` fails the build on a duplicate version anywhere in the
tree, and on a malformed filename.

## Filenames

`<version>_<slug>.sql` — `version` is digits (four or more, zero-padded,
e.g. `0031`), `slug` is lowercase `snake_case`. No uppercase, no spaces, no
`*` — the last is illegal in a Windows path, and this tree is Windows-first.

## A generated migration

```sql
-- generated from pipelines/complaints_a/schema.py at declaration rev 0031
-- description: add case_status to the silver case table
-- review this file; it is applied exactly as written

ALTER TABLE cases ADD COLUMN case_status TEXT;

UPDATE cases SET case_status = 'unknown' WHERE case_status IS NULL;
```

`python -m cli migrations make` writes the mechanical part — the `ALTER
TABLE`/`CREATE TABLE` from a declared table's column drift. A backfill like
the second statement above is **hand-added before commit**; the generator
never writes DML. Review every generated file before committing it — the
header says so, and means it.

**Forward-only.** There is no generated "down" migration; `migrate --to
<version>` truncates which migrations apply, which covers staging a partial
rollout and bisecting a bad file — it does not undo a migration already
applied to a database beyond that version.

One consequence worth stating: a declaration change touching **silver and
gold** emits **two** files, because scope maps to a target database and those
are two different databases (`<subject>/silver.db` and `<subject>/gold.db`
under the medallion profile). Within one database it stays one file.

## What `migrations make` does not emit

- **`primary_key` / `indexes`.** `tools.schema.live` diffs columns only, and
  several tables here land via a Writer that replaces the whole table on every
  run (`Refresh` / `AccumulateByRun`), which would silently erase a
  migration-created constraint on the very next pipeline write. The generated
  file names what is declared and left out in a comment; add it by hand only
  where a table's Writer strategy genuinely depends on it (e.g.
  `InsertOrIgnore`'s conflict resolution reads the target's own constraints).
- **A type change.** SQLite's `ALTER TABLE` cannot retype a column in place.
  See the rebuild recipe below.
- **Dropping an undeclared column.** A live-only column is surfaced by `schema
  diff`, never auto-removed.

## SQLite's 12-step table-rebuild recipe

For the changes `ALTER TABLE` cannot express — retyping a column, dropping one,
adding/removing a constraint — hand-write the file using SQLite's own
documented procedure (<https://www.sqlite.org/lang_altertable.html>):

1. `CREATE TABLE new_table (...)` with the desired final shape.
2. `INSERT INTO new_table SELECT ... FROM old_table;` (casting/mapping columns
   as needed).
3. `DROP TABLE old_table;`
4. `ALTER TABLE new_table RENAME TO old_table;`
5. Recreate every index that named the old table.
6. Recreate every trigger that named the old table (none exist in this repo
   today, but a future one would need this step).
7. Recreate every view that referenced the old table.
8. Re-run `python -m cli schema diff` against a throwaway copy before trusting
   the rebuild against a real environment.

> **Do not write `BEGIN` / `COMMIT` / `ROLLBACK` (or `PRAGMA foreign_keys`) in
> a migration file.** SQLite's published recipe wraps its steps in an explicit
> transaction and toggles `PRAGMA foreign_keys` around it, because it is
> written for a script run against a bare connection. Here the **runner owns
> the transaction**: `tools.migrations.runner.apply_database` issues one
> `BEGIN`, runs every statement in the file, inserts the ledger row, and
> commits once. A `COMMIT;` inside the file would end that transaction early,
> so a later failing statement would leave the migration half-applied *and*
> unrecorded — precisely the failure mode this design avoids. The runner
> **refuses** a file containing transaction control, naming the keyword; a
> `PRAGMA foreign_keys` change is a no-op inside a transaction anyway, and this
> repo declares no foreign keys.

The 12-step recipe is therefore what you write *inside* one migration file when
`ALTER TABLE` alone can't get there — not a separate mechanism, and not its own
transaction.

## Applying: the ledger

Every physical database gets its own `schema_migrations` table (`tools.migrations.ledger`) —
self-describing, so migrating one database is independent of the rest:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    scope      TEXT NOT NULL,
    checksum   TEXT NOT NULL,
    applied_at TEXT NOT NULL
)
```

A file is split on `sqlite3.complete_statement` (never `executescript`, which
commits implicitly) and applied together with its ledger row in **one**
transaction the runner owns — a crash mid-file leaves nothing committed and no
ledger row, so it is retried whole on the next `migrate`. An applied migration
whose file has since changed on disk is a hard error naming the file, never a
silent re-apply or skip. Re-running an already-applied file is a no-op.

Two things a file must not contain: its own transaction control (see the box
above) and a `CREATE TABLE IF NOT EXISTS` used to paper over a collision —
`IF NOT EXISTS` on a table this migration owns hides the case where a *different*
scope already created a table of that name, which is the one thing a coarse
topology profile needs to fail loudly on.

See [`../docs/migrations.md`](../docs/migrations.md) for the full command
reference, the topology profiles, and worked `--plan` output.
