---
status: accepted
---

# SQL migrations own the physical shape of a database

The tables the pipelines write are declared by numbered `.sql` files under
`migrations/<subject>/<database>/`, applied by `python -m cli migrate`, and
recorded in a `schema_migrations` ledger inside each database it touches.

Before this, the physical shape of every table was *born from Python*: a feed's
declared dataclass drove `SchemaCoercion`, which picked dtypes for the SQLite
affinity they create, and `frame.to_sql(...)` created the table on first write.
Nothing owned the DDL. There were no primary keys, no indexes, no `NOT NULL`s,
and no way to change a table once it held rows that could not be dropped.
Pre-go-live was the only cheap moment to fix that.

Two concrete collisions made it urgent rather than tidy:

- `Refresh` wrote `if_exists="replace"` — it dropped and recreated the table, so
  any DDL a migration created would be gone after the next nightly run,
  silently, with the rows still landing.
- The merge writers ensured their target existed with
  `frame.iloc[:0].to_sql(table, if_exists="append")` — a table a migration
  forgot was conjured with drifted types instead of failing.

## The decisions

### 1. SQL owns DDL; the dataclass owns intent

The migration says what the table **is** — its columns, their types, its keys and
indexes. The declared dataclass says what a row **means**: which columns a feed
must carry, what their values must satisfy, what the quarantine partitioner
routes on. Neither replaces the other, and
[graduated schema enforcement](0006-graduated-schema-enforcement.md) is unchanged
by this: the validators still gate the data, they simply no longer decide the
storage.

Writers stop creating and stop replacing tables **where a database says so** (see
2). `Refresh` becomes delete-rows-then-append there, which lands the same rows
and leaves the declared shape alone.

Two owners of one table invites drift, and that is a **review** question rather
than a test. A mechanical check has to be told which tables have a dataclass at
all — a gold aggregate, a quarantine reject table and a raw landing table have
none — so it carries a hand-kept map that drifts, which is what it was meant to
prevent. It is written down where a reviewer reads it instead
([pull-request-review.md](../pull-request-review.md)), with the one thing that is
easy to get wrong: compare storage *affinity*, not type name. `DATE` and
`TIMESTAMP` are one physical column; `TEXT` and `INTEGER` are not.

### 2. Strictness is per-database and self-declaring

A database carrying a `schema_migrations` ledger is under migration control and
refuses implicit table creation. One without it behaves exactly as it always
has.

The alternative — a global switch, or a registry listing which databases are
strict — would have made day one a flag day: every feed's tables declared at
once, 28 test files changed in one commit, and no way to land it green. The
ledger's *presence* being the opt-in made every step additive. Subjects
converted one at a time, and at no point was the suite red or a database left
half-owned.

The cost is that **forgetting is silent**: a deployed feed with no migrations
directory does not fail, it quietly keeps creating its tables — with whatever
dtypes the frame happened to carry, no keys and no indexes.

That cost is **accepted here, not paid off.** Two guards were built on this epic
and both were rejected: a hand-maintained exclusion list (which makes every
addition, rename or deletion under `pipelines/` a maintenance event for the
guard), and deriving "deployed" from the orchestration schedules (which reads
better but is already false — `notifications` has a baseline, is a going-live
item, and is not scheduled). [#729](https://github.com/nickwarters/data-pipeline-tooling/issues/729)
carries the problem statement and the directions worth exploring; the most
promising is that what is deployed is a fact about the *environment* rather than
about `pipelines/`, so a walk of a real base directory reporting databases
without a ledger would need no list at all.

Meanwhile `scaffold` renders a new feed's baselines, so the common path does not
depend on remembering — but the uncommon one does.

### 3. Run metadata stays out

`_registry/runs.db` and `_orchestration/runs.db` self-migrate from
`RUN_RECORD_FIELDS` ([structured JSONL
observability](0005-fail-fast-atomic-runs-and-observability.md)) and continue
to. Two migration mechanisms on one file would be worse than one, and that
store's shape is already declared once as data — adding a field is one entry and
the DDL, the `INSERT` and the decode all follow.

### 4. `run` and `orchestrate` do not guard on pending migrations

A pipeline can be invoked directly as `python -m pipelines.<name>`, which would
bypass such a check anyway. Decision 1 gives the enforcement for free: a run
against an unmigrated database fails at the write with `MissingTableError`,
naming the table and the command that would declare it.

A *pending* migration instead surfaces SQLite's raw `no such column`. That fails
fast but reads poorly, and it is accepted rather than paid for with a
column-level check on every run. `python -m cli migrate --check` exists for CI,
which is where the question is worth asking.

### 5. Raw is migrated per feed, and its baseline is the raw read columns

Raw's baseline comes from what the feed actually reads, never from the field
list in `schema.py`: `scaffold --from-feed-file` caps a generated schema at 40
columns, so a schema derived from a wide source describes a prefix of it, and a
baseline generated from that would declare a narrower table than the feed
writes.

That falls out of how a baseline is made. It is **copied out of the database**,
not reconstructed: SQLite keeps the verbatim `CREATE` statement of every table
and index in `sqlite_master`, so `scripts/generate_baseline_migrations.py` reads
those and writes them to the file — the same text `sqlite3 <db> .schema` prints.
Faithful by construction rather than by argument, uniform across tables that have
a dataclass and tables that never could, and constraints and indexes come along
because they are in the statement. The one exception is a brand-new feed, which
has no database to copy from; `scaffold` renders its starting baseline from what
the template declares.

**How this sits with [graduated schema
enforcement](0006-graduated-schema-enforcement.md).** That ADR keeps raw
*schema-light*: raw lands what the source gave, and the contract is imposed at
silver. Migrating raw does not change that. It fixes the columns a table has, not
what any row must contain — raw still validates nothing and rejects nothing. And
it is applied where a feed's raw shape is **already explicitly declared rather
than discovered**: `sharepoint_cases` selects a named `$select` list
(`RAW_FEED_COLUMNS`), so its raw shape is a decision the feed already made.
A file-sourced feed whose raw shape is whatever the CSV had that morning stays
schema-light and unmigrated until someone decides otherwise; nothing here forces
it.

The consequence is accepted rather than designed around: a 600+ column source
starts life as a very large hand-maintained DDL file.

### 6. Only deployed subjects get baselines

`sharepoint_cases`, `reviewer_activity` and the `notifications` ledger subject.
Every other pipeline writes only into a `tmp_path` inside tests and is recorded
as a named exclusion rather than left implicit. `selection` and `case_selection`
are excluded deliberately for now; if either becomes production-bound it needs
its own baseline and its exclusion removed.

## Consequences

- A change to a deployed table's shape is **a new numbered migration**, never an
  edit to the baseline and never an edit to a dataclass alone. The runner
  records each file's checksum and refuses one that changed after it was
  applied, because the database and the file claiming to describe it would have
  diverged.
- A gold rebuild whose column set changes needs a migration first. So does a
  quarantine reject table.
- Each file is applied in **its own transaction**, with its ledger row, because
  production is a UNC share under the rollback journal where a writer's lock is
  exclusive.
- One piece of Python-side DDL deliberately survives: the additive
  `ALTER TABLE … ADD COLUMN` that widens a table predating the run-provenance
  column ([ADR-0020](0020-writer-stamped-run-provenance-column.md)). Gating it
  would break any baseline that does not declare that column; it is documented in
  [migrations.md](../migrations.md) rather than left implicit.

## Alternatives considered

**A migration framework (Alembic and friends).** Rejected: the framework is
import-only and deliberately unpackaged, the store is SQLite files on a share,
and the whole mechanism here is one module and a ledger table. Taking a
dependency to get less.

**Generating the DDL from the dataclasses at run time.** Rejected: it makes the
dataclass the owner of the physical shape, which is decision 1 inverted — and it
cannot describe a gold aggregate, a quarantine reject table or a raw landing
table, none of which has a dataclass.

**Generating the baselines from the dataclasses, once.** Rejected for the same
reason one hop down: it needs a declared-type → SQLite-type mapping that models
what `pandas.to_sql` does today, and a hand-kept map of which tables have a
dataclass — and it still cannot describe the three kinds of table that have
none. Copying `sqlite_master` needs neither and covers all of them (decision 5).

**A pending-migration guard on every run.** Rejected as decision 4.

See [migrations.md](../migrations.md) for the mechanics, and
[operator-cli.md](../operator-cli.md#migrate--apply-the-sql-migrations-that-own-the-databases-shape)
for the command.
