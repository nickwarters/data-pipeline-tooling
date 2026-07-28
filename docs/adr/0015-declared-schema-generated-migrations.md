---
status: accepted
---

# Declared schema, generated migrations, topology as a profile

A table's live shape has had no reviewed path from "the declaration changed"
to "the database changed" — only a read-only drift report (`schema diff`,
[ADR-adjacent work in `docs/schema-declaration.md`](../schema-declaration.md)).
This closes that gap without introducing a framework migration engine: a
migration is a **reviewed, forward-only `.sql` file**, generated mechanically
from a `Table` declaration's drift and applied by a small runner that owns
nothing but a per-database ledger and a transaction boundary.

## Generate, don't hand-author from scratch — but never auto-apply

`python -m cli migrations make` writes the *mechanical* part of a migration
(`CREATE TABLE`/`ALTER TABLE ADD COLUMN`, derived from the same `Table`
declaration `schema diff` already reads) as a file under version control, for
a human to review before it is ever applied. It never writes DML: a backfill
(`UPDATE ... SET x = 'unknown' WHERE x IS NULL`) is hand-added before commit.
The alternative — an ORM-style engine that diffs a live database and applies
changes automatically — was rejected for the same reason `docs/adr/0013` keeps
the framework domain-free and `docs/adr/0004` keeps load strategy explicit:
schema changes on a shared, single-writer, network-share database
([ADR 0001](0001-sqlite-per-subject-medallion-store.md)) are exactly the kind
of action that must never happen without a human looking at the diff first.

## Diff against the tree's own tracked shape, not a live database

`migrations make` cannot use `schema diff`'s live-database comparison as its
baseline: a migration file is one artifact shared by every environment (dev,
prod, a developer's laptop), and no single environment's live shape is the
right thing to diff a repo-wide artifact against. Instead it replays the
migrations already committed for that table's database and diffs the
declaration against *that*. This keeps `migrations make` fully reproducible
from source control alone: given the same declarations and the same tree, two
developers on two different machines generate the same next file.

**SQLite is the parser for that replay.** The replay applies the scope's
committed files to a throwaway in-memory SQLite database and reads the shape
back with `PRAGMA table_info` — the same read `schema diff` performs against a
real environment (`tools.schema.emit.replay_tracked_shapes`).

*Rejected: a narrow regular-expression parser* over the `CREATE TABLE` /
`ALTER TABLE ADD COLUMN` statements this generator writes. It is cheaper and
looks sufficient, because the generator wrote every statement it needs to
read — but the tree is *not* generator-only by design. A backfill is hand-added
before commit, and `migrations/README.md` documents SQLite's 12-step
table-rebuild recipe for the changes `ALTER TABLE` cannot express, so a real
tree contains `CREATE TABLE`/`DROP TABLE`/`RENAME`/`DROP COLUMN` no generator
wrote. A narrow parser reads those *silently wrong* — a rebuild that added a
column leaves the parser reporting the pre-rebuild shape, so the next
`migrations make` emits a duplicate `ADD COLUMN` that fails at apply time; a
hand `DROP COLUMN` leaves it reporting a column the database no longer has, so
a needed column is silently skipped. Replaying through SQLite gets all of those
right for free and reuses landed `schema diff` code, and anything SQLite refuses
becomes a hard error naming the file (`MigrationReplayError`) instead of a
guess. A generator whose baseline can be quietly wrong is worse than no
generator.

## Scope is the directory; there is no manifest

A migration's directory path *is* its scope — `_shared`, `layer/<layer>`,
`phase/<phase>`, `subject/<subject>/<layer>`, `platform/<name>`
(`tools.migrations.scope`). A manifest file naming each migration's scope
separately would be a second source of truth for something the filesystem
already states unambiguously, and would drift from it exactly the way
`docs/schema-declaration.md` describes the physical `(namespace, table)` set
drifting from a declaration with no cross-check. `tools.migrations.discovery`
enforces the whole convention by construction — an unrecognised directory,
malformed filename, or duplicate version fails loudly rather than being
silently miscategorised.

## Topology is a profile over the same tree, not a second tree

The medallion layout (`<subject>/{raw,silver,gold}.db`,
[ADR 0001](0001-sqlite-per-subject-medallion-store.md)) is one way of bundling
migration scopes into physical files, not the only one a deployment might
need. Rather than maintaining a separate migrations tree per possible
topology — which would multiply the review burden by the number of
topologies and let them drift from each other — a **topology profile**
(`tools.migrations.topology`) is a pure function from the one discovered tree
to a set of physical databases and which scopes compose into each. Four ship:
`medallion` (today's), `single`, `by_layer`, `by_phase`. Changing an
environment's profile in `tools/environments.py` changes *only* how the same
`.sql` files are bundled into files — never which files exist or what they
contain.

This mirrors the separation ADR 0001's amendment already drew between the
namespace `Store` (where data lands) and the medallion (a profile over it):
here, the migrations tree is the primitive, and a topology profile is the
medallion's (or `single`'s, or ...) view over it.

## No PK/index generation — a deliberate omission, not a gap

`migrations make` never emits `PRIMARY KEY`/`CREATE INDEX`, even though
`Table.primary_key`/`Table.indexes` are declared. Two reasons, together
decisive:

1. `tools.schema.live` diffs columns only — a constraint `migrations make`
   created would never be re-verified by `schema diff`, so a database could
   silently lose it with nothing left to notice.
2. Several bundled tables land via a Writer that replaces the whole table on
   every run (`Refresh`/`AccumulateByRun`; `frame.to_sql(if_exists="replace")`
   recreates a bare table with no constraints). A migration-created
   `PRIMARY KEY` on such a table would be **actively erased** by the very next
   pipeline write — worse than merely unverified, actively misleading to
   whoever reviewed and approved the migration believing it would persist.

Where a constraint is load-bearing for correctness (e.g. `InsertOrIgnore`'s
conflict resolution reads the target's own constraints), that dependency
belongs to the Writer's strategy choice, not to a mechanical column-diff
generator acting out of band from it. The generated file names what is
declared and left out, in a comment, so a human adds it deliberately only
where it is actually safe to.

## Never bake the raw-is-not-yet-TEXT accident in as intent

Raw is meant to be TEXT throughout; several bundled feeds' raw `Table`s
aren't, because they read through a dtype-inferring `CsvReader` — documented,
pre-existing drift, not design intent (`docs/schema-declaration.md`). A
generated migration for such a table carries a loud comment saying so. Without
it, a reviewed, committed `.sql` file would read as an *intentional* decision
to type raw — exactly the kind of silent laundering of an accident into a
design choice this step must not do.

## Consequences

- A declaration change touching two databases (e.g. silver and gold) emits two
  files — scope maps to a target database, and generation is per database.
- `migrate` never runs as a side effect of a pipeline run
  (`framework/run/*` is untouched); it is a distinct operator action, like
  `schema diff`.
- The run registry's own self-healing migration
  (`tools/observability/run_registry.py`) is unaffected — the `platform/registry`
  scope generates the same DDL for a *fresh* database `migrate` creates ahead
  of any pipeline run, but the self-heal remains the safety net for every
  database this step predates or that opens without `migrate` ever running.
- **Only `medallion` can migrate this repo's own declarations today.** A
  profile that collapses several databases into one file needs table names
  unique across everything it collapses, and this repo's declarations collide
  two ways: different subjects reuse a name (`cases`, `selection_pool` — a
  naming accident in the demo feeds), and — the structural one — a silver table
  is named after the raw table it refines, which is this repo's universal
  convention, so `single` and `by_phase` (both of which put raw and silver in
  one file) collide for *every* feed. Naming is therefore an **open design
  question for those two profiles**, not a fixture problem: they ship with the
  mechanism proven end-to-end against a synthetic collision-free tree, and
  `medallion` proven against the real one. What is guaranteed unconditionally is
  that a collision fails loudly and completely — the file rolls back whole, and
  `MigrationApplyError` names the file, the database, the statement and the
  profile rather than surfacing a raw `table X already exists`. Resolving it
  means a naming rule (a layer prefix, or renaming declared tables), which is a
  change to existing pipelines and out of scope for an additive step.
- **The runner owns the transaction boundary, so a migration file may not.** A
  file containing `BEGIN`/`COMMIT`/`ROLLBACK`/`SAVEPOINT` is refused by name.
  SQLite's own published rebuild recipe is written with an explicit `COMMIT`,
  for a script run against a bare connection; here that `COMMIT` would end the
  runner's transaction early and let a later failure leave the file
  half-applied *and* unrecorded — reintroducing exactly the hazard that
  rejecting `executescript` avoids. Refusing the file is preferable to trusting
  every author to remember.
- **`migrations/` holds no illustrative migration.** The `_shared`, `layer` and
  `phase` scopes are recognised and composed but empty: everything committed
  under `migrations/` *is applied* to every database its scope reaches, so a
  plausible-looking example would create a real table in production that
  nothing writes and nothing reads. An empty scope is the honest state until a
  real migration needs it.
