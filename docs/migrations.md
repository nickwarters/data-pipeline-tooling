# Migrations — the `migrations/` tree, the medallion layout, and `migrate`

[`schema-declaration.md`](schema-declaration.md) declares what a table's shape
*should* be and reports drift (`schema diff`, read-only). This document covers
what actually gets a live database *to* that shape: authoring
(`migrations make`) and applying (`migrate`) reviewed, forward-only `.sql`
files.

## The tree: directory path is scope, filename is version + slug

```
migrations/
  README.md
  _shared/                                    # recognised scope, empty today
  layer/{raw,silver,gold}/                    # recognised scope, empty today
  subject/complaints_a/raw/        0012_create_complaints_a.sql
  subject/complaints_a/silver/     0013_create_complaints_a.sql
  subject/complaints_a/quarantine/ 0039_create_complaints_a.sql
  platform/registry/               0005_create_run_records.sql
```

`quarantine` is a fourth recognised value alongside `raw`/`silver`/`gold`
(`tools.migrations.scope.VALID_LAYERS`) — not a medallion layer, but the one
non-medallion landing site (a feed's reject table, `<subject>/quarantine.db`,
declared via `tools.schema.quarantine_table`; see
[ADR 0016](adr/0016-migrations-own-table-structure.md)) resolved per subject,
so `subject/<subject>/quarantine/` fits the same directory shape unchanged.
`layer/quarantine/` is accepted by the same rule as `layer/raw` (every value
in `VALID_LAYERS` is valid under both `layer/` and `subject/<subject>/`) but,
unlike raw's, has no real use yet — nothing today needs "every subject's
quarantine table" as one migration scope.

The `_shared` / `layer` scopes are recognised and composed, but hold no file
yet: everything committed here **is applied** to every database the scope
reaches, so an illustrative example would create a real table in production
that nothing writes — see
[`../migrations/README.md`](../migrations/README.md).

There is no manifest — `tools.migrations.discovery.discover_migrations` walks
the tree directly and classifies every file's scope from its directory
(`tools.migrations.scope.parse_scope_dir`), and enforces the whole convention
in one place: every filename is `<version>_<slug>.sql` (digits, then
lowercase `snake_case`), every version is unique **repo-wide** (never per
scope — several scopes can land in one physical database, interleaved by
version, so a repeated version anywhere would be ambiguous), and every
directory is one of four recognised scope shapes. Any violation raises
`MigrationTreeError` naming the offending path; see
[`../migrations/README.md`](../migrations/README.md) for the full convention,
worked examples, and SQLite's 12-step table-rebuild recipe for the changes
`ALTER TABLE` can't express.

## Authoring: `python -m cli migrations make`

```sh
python -m cli migrations make                # every declared table that has drifted
python -m cli migrations make --feed complaints_a
```

Diffs every declared `Table` (`tools.schema.collect_declared_tables()`)
against the shape the migrations tree has **already committed to writing**.
This is deliberately *not* a diff against any live environment: a migration
file is one artifact shared by every environment, so no single environment's
live shape is the right baseline for it — and diffing the tree instead makes
`migrations make` reproducible from source control alone.

That baseline is read by **applying** the migrations composing that table's
database (`_shared` + `layer/<layer>` + `subject/<subject>/<layer>`, per
`tools.migrations.topology.compose_for_subject_layer`)
to a throwaway **in-memory** SQLite database, then reading the result back with
`PRAGMA table_info` — the same read `schema diff` performs against a real
environment (`tools.schema.emit.replay_tracked_shapes`). SQLite itself is the
parser, so a hand-edited file works exactly as written: a backfill runs against
an empty table and changes no shape, and a 12-step rebuild, a `DROP COLUMN` or
a `RENAME COLUMN` is reflected precisely. Anything SQLite refuses is a hard
error naming the file (`MigrationReplayError`) — the command never guesses a
shape it could not derive.

For each drifted table it writes one new file, at the next global version, in
the finest-grained scope (`migrations/subject/<subject>/<layer>/`):

- a table that has never been created → `CREATE TABLE` from its declared columns;
- a declared column missing from the tracked shape → `ALTER TABLE ... ADD COLUMN`.

A declaration change touching **silver and gold** emits **two** files, because
scope maps to a target database and those are two different databases; within
one database it stays one file.

### What it deliberately does not emit

- **A type change.** SQLite's `ALTER TABLE` can't retype a column in place —
  see the 12-step rebuild recipe in `migrations/README.md`. Left for a human.
- **An undeclared extra column.** Never auto-dropped; surfaced by `schema diff`
  instead.
- **`primary_key` / `indexes`.** `tools.schema.live` diffs columns only (see
  [`schema-declaration.md`](schema-declaration.md)), so a constraint `schema
  diff` never re-verifies is never emitted either — that would be actively
  misleading rather than merely incomplete. Before #323 this was doubly true
  for `Refresh`: its Writer's `frame.to_sql(if_exists="replace")` dropped and
  recreated the table on every run, silently erasing any migration-created
  `PRIMARY KEY`/index the very next write. `Refresh` now truncates
  (`DELETE FROM` + insert) inside one transaction instead, so an index
  survives it — but the columns-only diff is still the only thing verified on
  every run, so the generator still leaves a comment naming what is declared
  and why, for a human to add only where a table's Writer strategy genuinely
  depends on the constraint (e.g. `InsertOrIgnore`'s conflict resolution reads
  the target's own constraints).
- **The raw-is-not-yet-TEXT accident, presented as intended.** Raw is meant to
  be TEXT throughout; several bundled feeds' raw `Table`s aren't, because they
  read through a dtype-inferring `CsvReader` (see
  [`schema-declaration.md`](schema-declaration.md)). A generated file for such
  a table carries a loud `NOTE` comment saying so, rather than presenting the
  non-TEXT type as design intent.

A generated file:

```sql
-- generated from pipelines/complaints_a's declared TABLES at declaration rev 0031
-- description: add case_status to silver/complaints_a
-- review this file; it is applied exactly as written

ALTER TABLE complaints_a ADD COLUMN case_status TEXT;
```

Review it, hand-add any backfill DML before committing (a backfill is never
generated), and commit.

## Base dir → databases: the medallion layout

`tools.migrations.topology` resolves one physical database per `(subject,
layer)` actually present in the tree — `<subject>/<layer>.db` — composing
`_shared` + `layer/<layer>` + `subject/<subject>/<layer>` for each, plus the
fixed `platform/registry` scope at its own path: `_registry/runs.db` — the
path `tools.observability.run_store.RunStore` already owns, independent of the
medallion. There is no other layout to choose between and no `--profile` flag:
a base directory resolves to its medallion database paths one way.
`tests/integration/test_medallion_migrations.py` proves that end-to-end against
the real tree: every declared table lands in its own subject/layer file, and
the registry database lands beside them.

### A known limitation

A coarser layout — one database per generic layer, one per subject, or one
single warehouse spanning everything — was designed and prototyped, then
removed rather than shipped broken. Collapsing several scopes into one
physical file only works if every table name collapsed together is unique,
and this repo's own declarations don't satisfy that in two distinct ways:

| Collapsing | Collides because |
|---|---|
| two **layers** into one file | a silver table is named after the raw table it refines — the medallion's own convention, not an accident (`complaints_a` raw refines into `complaints_a` silver, for every feed) |
| two **subjects** into one file | different subjects reuse a table name (`cases` is declared by both `ref_lookup` silver and `cases` silver; `selection_pool` by both `case_selection` gold and `cases` gold) |

Fixing this needs a table-naming rule (a layer- or subject-prefixed physical
name) that this repo does not have and that would change every existing
pipeline's declared tables — out of scope for an additive step, so the coarser
layouts were not shipped. Only the medallion (one database per subject/layer)
is available, and it is what this repo migrates under.

What is still guaranteed: a genuine name collision within one database (an
authoring mistake, not a layout choice) fails `migrate` loudly and completely.
The failing file is rolled back whole (no ledger row), and the error names the
migration file, the target database, and the statement — see
`tools.migrations.runner.MigrationApplyError`:

```
migrations/subject/cases/silver/0007_create_cases.sql: failed to apply
against /data/cases/silver.db -- table cases already exists. The whole file
was rolled back (no statement of it, and no ledger row, survives).
Statement: 'CREATE TABLE cases (...)'
```

## Applying: `python -m cli migrate`

```sh
python -m cli migrate --env prod                   # apply everything pending
python -m cli migrate --env prod --plan             # preview; touch nothing
python -m cli migrate --env prod --status           # summarise applied/pending
python -m cli migrate --env prod --subject complaints_a
python -m cli migrate --env prod --layer silver
python -m cli migrate --env prod --to 0031          # truncate to this version (inclusive)
python -m cli migrate --database ./scratch/test.db --scope layer/silver --scope _shared
```

`--env`/`--base-dir` resolve the base directory the same way every other
operator command does (`cli.operator.add_base_dir_args`). `--subject` /
`--layer` are optional and intersect, narrowing which of the medallion's
databases are touched (a database matches if any of its composed migrations
names that scope; the registry database, which composes no subject scope, is
reachable as `--subject _registry`). `--to VERSION` truncates every selected
database's migrations to that version inclusive — migrations are
**forward-only**; this
covers staging a partial rollout and bisecting a bad file, not undoing one
already applied beyond that version.

`--database`/`--scope` bypasses the medallion's base-dir resolution entirely
for one ad hoc database: name the physical file directly and list the scopes
(by label, e.g. `layer/silver`, `_shared`, `subject/complaints_a/raw`,
`platform/registry`) to compose into it.

### The ledger

Every physical database gets its own `schema_migrations` table
(`tools.migrations.ledger`):

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    scope      TEXT NOT NULL,
    checksum   TEXT NOT NULL,
    applied_at TEXT NOT NULL
)
```

self-describing, so migrating one database is independent of the rest. A file
is split on `sqlite3.complete_statement` — never `executescript`, which
commits implicitly and would leave a crash mid-file half-applied and
unrecorded (the same reasoning as the `step_address` backfill in
`tools/observability/run_registry.py`) — and applied together with its ledger
row in **one** transaction (`tools.migrations.runner.apply_database`
issues an explicit `BEGIN`): every statement, then the ledger row, then one
commit. A failing statement rolls the whole file back — none of its earlier
statements, and no ledger row, survive.

Rules, all covered by `tests/tools/test_migrations/test_runner.py`:

- **Idempotent.** Re-running an already-applied file (matching checksum) is a
  no-op.
- **A changed file is a hard error naming it**, never a silent re-apply or
  skip (`ChecksumMismatchError`), raised by both `plan_database` and
  `apply_database` — a plan surfaces the problem the same way an apply would
  refuse it.
- **A failing statement is `MigrationApplyError`**, naming the file, the
  database and the statement — never a bare `sqlite3` traceback.
- **The runner owns the transaction, so a file must not.** A migration
  containing its own `BEGIN`/`COMMIT`/`ROLLBACK`/`SAVEPOINT` is **refused**,
  naming the keyword: a stray `COMMIT;` (SQLite's published 12-step rebuild
  recipe is written with one — see `migrations/README.md`) would end the
  runner's transaction early and let a later failure leave the file
  half-applied *and* unrecorded, which is the very thing not using
  `executescript` is for.
- **Connections come from `framework._internal.connection.connect`** —
  inherits `busy_timeout`; the rollback journal stays on (WAL is unavailable
  over a network share, per
  [ADR 0001](adr/0001-sqlite-per-subject-medallion-store.md)).

### `--plan` / `--status`

`--plan` lists every selected migration's state per database — applied (with
the date the ledger recorded), or pending, indented so pending work stands out,
and flagged "out of order" when a lower version is pending after a higher one
has already been applied. Only the first line of a database names it:

```
$ python -m cli migrate --base-dir /data --subject complaints_a --plan
plan · base-dir /data

complaints_a/raw.db         0012 create_complaints_a      applied 2026-07-28
complaints_a/silver.db           0013 create_complaints_a      pending

2 database(s) · 1 pending · 0 out of order
```

`--status` is the condensed per-database summary:

```
$ python -m cli migrate --base-dir /data --subject complaints_a --status
status · base-dir /data

complaints_a/raw.db         1 applied · 0 pending · 0 out of order
complaints_a/silver.db      0 applied · 1 pending · 0 out of order
```

Both are covered by `tests/framework/_cli/test_migrate.py`, and both are
strictly read-only: a database with no ledger yet reports everything pending
rather than having a `schema_migrations` table created for it.

## What's next: the run registry keeps its own self-heal

`tools/observability/run_registry.py`'s `RunRegistry._migrate()` — its own,
separate additive-column migration and ledger — is untouched by this step and
stays the safety net for a registry database `migrate` predates, or that a
process opens without ever running `migrate` first. The `platform/registry`
scope's migration generates the same `run_records` DDL for a **fresh**
database `migrate` creates ahead of any pipeline run; it does not replace
`RunRegistry`'s self-heal, which still runs on every open regardless.
