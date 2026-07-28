# Migrations — the `migrations/` tree, topology profiles, and `migrate`

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
  phase/{ingest,selection,sync,reporting}/    # recognised scope, empty today
  subject/complaints_a/raw/    0012_create_complaints_a.sql
  subject/complaints_a/silver/ 0013_create_complaints_a.sql
  platform/registry/           0005_create_run_records.sql
```

The `_shared` / `layer` / `phase` scopes are recognised and composed, but hold
no file yet: everything committed here **is applied** to every database the
scope reaches, so an illustrative example would create a real table in
production that nothing writes — see
[`../migrations/README.md`](../migrations/README.md).

There is no manifest — `tools.migrations.discovery.discover_migrations` walks
the tree directly and classifies every file's scope from its directory
(`tools.migrations.scope.parse_scope_dir`), and enforces the whole convention
in one place: every filename is `<version>_<slug>.sql` (digits, then
lowercase `snake_case`), every version is unique **repo-wide** (never per
scope — several scopes can land in one physical database, interleaved by
version, so a repeated version anywhere would be ambiguous), and every
directory is one of five recognised scope shapes. Any violation raises
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
database (`_shared` + `layer/<layer>` + `phase/<phase>` +
`subject/<subject>/<layer>`, per `tools.migrations.topology.compose_for_subject_layer`)
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

## Topology profiles: base dir → databases → scopes

The same tree supports several ways of bundling scopes into physical database
files — `tools.migrations.topology`:

| Profile | Databases | Notes |
|---|---|---|
| `medallion` (today's layout) | `<subject>/<layer>.db`, one per subject actually present in the tree | Composes `_shared` + `layer/<layer>` + `phase/<phase for that layer>` + `subject/<subject>/<layer>` |
| `single` | `warehouse.db` | Composes every non-platform scope |
| `by_layer` | `raw.db` / `silver.db` / `gold.db` | Each spans every subject's migrations for that layer |
| `by_phase` | `ingest.db` / `selection.db` / `sync.db` / `reporting.db` | Each spans every layer mapped to that phase (`tools.migrations.topology.PHASE_BY_LAYER`) |

Every profile additionally resolves the fixed `platform/registry` scope to the
**same** physical path in every topology: `_registry/runs.db` — the path
`tools.observability.run_store.RunStore` already owns, independent of the
medallion. Topology governs where medallion *data* lands; where run
*metadata* lands is a separate, fixed concern this step does not move.

`PHASE_BY_LAYER = {"raw": "ingest", "silver": "ingest", "gold": "selection"}`
is this repo's convention for where a generic layer sits in the
Ingest → Selection → Sync → Reporting loop (`CONTEXT.md`) — no layer maps to
Sync/Reporting here because both are platform-wide and, in this repo's
bundled feeds, own no per-subject medallion layer of their own.

An environment names its profile next to its `base_dir` root variable in
`tools/environments.py`:

```python
_ENVIRONMENTS: dict[str, _Environment] = {
    "dev": _Environment(path_var="PIPELINE_DATA_DIR_DEV", fallback=..., topology="medallion"),
    "prod": _Environment(path_var="PIPELINE_DATA_DIR_PROD", topology="medallion"),
}
```

so `--env prod` resolves both the base directory and the profile from one
place (`tools.environments.resolve_topology`).

### A known limitation — read this before choosing a coarser profile

**Only `medallion` can migrate this repo's own declarations today.** The other
three profiles work — the mechanism is real and tested — but they collapse
several databases into one physical file, and a physical file can hold only one
table of a given name. This repo's declared tables collide the moment they are
collapsed, in two distinct ways:

| Collapsing | Collides because | Colliding names today |
|---|---|---|
| two **layers** into one file (`single`, `by_phase`) | a silver table is named after the raw table it refines — the medallion's own convention, not an accident | `complaints_a`, `complaints_b`, `complaints_c`, `sales`, `case_reviews`, `advisers`, `cases` |
| two **subjects** into one file (`single`, `by_layer`) | different subjects reuse a table name | `cases` (`cases`/`complex_cases`/`ref_lookup`), `selection_pool` and `selection_trace` (`cases`/`case_selection`) |

The second is arguably a naming accident in the bundled demo feeds. The **first
is not** — "raw `complaints_a` refines into silver `complaints_a`" is how every
feed in this repo is written, so any profile that puts raw and silver in one
file needs a naming rule (a layer prefix, or a table rename) before it can be
used at all. Renaming declared tables is a change to existing pipelines and is
out of scope for this additive step; **this is an open design question for
`single` and `by_phase`, not a fixture problem.**

What is guaranteed instead: `migrate` **fails loudly and completely** on a
collision. The failing file is rolled back whole (no ledger row), and the error
names the migration file, the target database, the statement, how many scopes
that database composes, and the profile — see
`tools.migrations.runner.MigrationApplyError`:

```
migrations/subject/case_selection/silver/0007_create_sales.sql: failed to apply
against /data/warehouse.db -- table sales already exists. The whole file was
rolled back (no statement of it, and no ledger row, survives).
Statement: 'CREATE TABLE sales (...)'

This reads like two scopes composing into the same physical database and both
defining the same object. warehouse.db composes 24 scopes, including _shared,
layer/raw, layer/silver, phase/ingest. A topology profile that collapses
several subjects -- or several layers -- into one file needs table names that
are unique across everything it collapses ...
(profile single)
```

So `tests/integration/test_topology_profiles.py` proves `single`/`by_layer`/
`by_phase` end-to-end against a small synthetic, collision-free tree (the
topology *mechanism*), proves `medallion` against the real tree, and separately
asserts that the real tree under `single` fails with that message rather than a
raw SQLite traceback.

## Applying: `python -m cli migrate`

```sh
python -m cli migrate --env prod                   # apply everything pending
python -m cli migrate --env prod --plan             # preview; touch nothing
python -m cli migrate --env prod --status           # summarise applied/pending
python -m cli migrate --env prod --subject complaints_a
python -m cli migrate --env prod --layer silver
python -m cli migrate --env prod --phase ingest
python -m cli migrate --env prod --to 0031          # truncate to this version (inclusive)
python -m cli migrate --database ./scratch/test.db --scope layer/silver --scope _shared
```

`--env`/`--base-dir` resolve the base directory the same way every other
operator command does (`cli.operator.add_base_dir_args`); `--env` additionally
resolves the topology profile unless `--profile` overrides it. `--subject` /
`--layer` / `--phase` are all optional and intersect, narrowing which of the
profile's databases are touched (a database matches if any of its composed
migrations names that scope). `--to VERSION` truncates every selected
database's migrations to that version inclusive — migrations are
**forward-only**; this covers staging a partial rollout and bisecting a bad
file, not undoing one already applied beyond that version.

`--database`/`--scope` bypasses a topology profile entirely for one ad hoc
database: name the physical file directly and list the scopes (by label,
e.g. `layer/silver`, `_shared`, `subject/complaints_a/raw`,
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
  database and the statement — never a bare `sqlite3` traceback, because the
  commonest cause ("table X already exists") says nothing on its own about
  which profile composed which scopes.
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
plan · base-dir /data · profile medallion

complaints_a/raw.db         0012 create_complaints_a      applied 2026-07-28
complaints_a/silver.db           0013 create_complaints_a      pending

2 database(s) · 1 pending · 0 out of order
```

`--status` is the condensed per-database summary:

```
$ python -m cli migrate --base-dir /data --subject complaints_a --status
status · base-dir /data · profile medallion

complaints_a/raw.db         1 applied · 0 pending · 0 out of order
complaints_a/silver.db      0 applied · 1 pending · 0 out of order
```

Both render for every topology profile
(`tests/framework/_cli/test_migrate.py`), and both are strictly read-only: a
database with no ledger yet reports everything pending rather than having a
`schema_migrations` table created for it.

## What's next: the run registry keeps its own self-heal

`tools/observability/run_registry.py`'s `RunRegistry._migrate()` — its own,
separate additive-column migration and ledger — is untouched by this step and
stays the safety net for a registry database `migrate` predates, or that a
process opens without ever running `migrate` first. The `platform/registry`
scope's migration generates the same `run_records` DDL for a **fresh**
database `migrate` creates ahead of any pipeline run; it does not replace
`RunRegistry`'s self-heal, which still runs on every open regardless.
