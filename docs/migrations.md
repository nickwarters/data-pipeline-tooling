# SQL migrations — the shape of a database

A database's physical shape — its tables, primary keys, indexes and
`NOT NULL`s — is declared by numbered `.sql` files, applied by the migration
runner in [`tools/migrations.py`](../tools/migrations.py) and driven by
`python -m cli migrate`. This page covers the layout it reads, the ledger it
writes, the rules it enforces, and what a migrated database does differently.

> **Status.** The runner, the `migrate` command and the Writer behaviour a
> migrated database earns all exist; **nothing is under migration control yet**,
> because no database has a migrations directory. The baseline migrations per
> subject are the remaining piece of the epic. Until a database has one,
> everything behaves exactly as it did before.

## Layout

```
migrations/
  <subject>/
    <database>/0001_create_initial_tables.sql
```

One directory per **database**, addressed as a subject and a database within it
— the same `<subject>/<name>` namespace `tools.store` maps to
`<base_dir>/<subject>/<name>.db`, so a database and the files that shape it are
found the same way. `tools.migrations.migrations_directory(subject, database)`
owns that mapping; `MIGRATIONS_ROOT` is the repository's `migrations/` tree.

For a subject following the raw/silver/gold medallion that reads:

```
migrations/
  sharepoint_cases/
    raw/0001_create_initial_tables.sql
    silver/0001_create_initial_tables.sql
    gold/0001_create_initial_tables.sql
```

— but **the migration machinery does not know the medallion**. `raw`, `silver`
and `gold` are three databases of one subject to it, exactly as they are to the
namespace Store; reading them as a medallion is the `tools.medallion` profile's
business alone. A subject whose databases are named otherwise migrates the same
way.

**The tree is the registry.** There is no list of databases anywhere else: one is
under migration control exactly when it has a directory here, so adding one is
the whole opt-in and `migrate` needs no configuration to find it.
`discover_targets()` is that walk.

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
migration control, and **refuses implicit table creation**: a table a migration
forgot fails the write, naming it, rather than being conjured by
`frame.to_sql(...)` with whatever dtypes the frame happened to carry. A database
*without* the ledger behaves exactly as it always has — the writers create as
they always did. `is_under_migration_control(db_path)` is the cheap,
side-effect-free check for that; a database that does not exist is not created
just to answer `False`. That per-database self-declaration is what lets subjects
convert one at a time instead of the whole repository changing behaviour at once.

Run metadata is **out of scope**: `_registry/runs.db` and
`_orchestration/runs.db` self-migrate from `RUN_RECORD_FIELDS` and stay that
way. Two migration mechanisms on one file would be worse than one.

## What a migrated database does differently

Two things change for the Writers, and only for a database carrying the ledger.

**No Writer creates a table.** A table a migration did not declare fails the
write with a `MissingTableError` naming the table and the command that would
declare it, instead of being conjured by `frame.to_sql(...)` with whatever dtypes
the frame happened to carry and no keys at all. That applies to every
table-backed Writer — the merge Writers that used to ensure the target existed
by appending an empty frame, the plain appenders, and `Refresh`.

**`Refresh` stops replacing.** `if_exists="replace"` drops the table and
recreates it from the frame, so the primary key, indexes and `NOT NULL`s a
migration created would be gone after the next nightly run — silently, with the
rows still landing. Against a migrated database `Refresh` deletes the rows and
appends the new ones instead, inside one transaction, so a failing append rolls
the delete back. Both paths land the same rows; only what survives underneath
them differs.

Three consequences worth stating plainly:

- **A gold rebuild whose column set changes now needs a migration.** Adding a
  column to a `Refresh` target used to happen by writing a wider frame. On a
  migrated database that write fails on the column SQLite does not have — add it
  in a migration first.
- **The same applies to quarantine reject tables.** A quarantine database is a
  database like any other: put it under migration control and its reject tables
  must be declared before a run can quarantine anything. It is its own file
  (`<subject>/quarantine.db`), so it is its own `migrations/<subject>/quarantine/`
  directory — opt it in separately, or leave it out and it keeps creating tables
  as it always has.
- **A missing *column* still reads poorly.** A missing table names itself; a
  column the migration forgot surfaces as SQLite's raw `no such column`. That is
  decision 4 of the epic — fail fast, and do not pay for a pre-write column check
  on every run — not an oversight.

One piece of Python-side DDL deliberately survives this ticket: the additive
`ALTER TABLE … ADD COLUMN` that widens a pre-provenance-column table so an
`INSERT` naming the run-provenance column can succeed. Gating it now would break
any baseline that does not declare that column, which is the baseline
generator's business to settle first.

## Applying them — `python -m cli migrate`

```sh
python -m cli migrate [--base-dir DIR] [--env ENV] [--check]
```

Walks the tree and brings every database it names, under the resolved base
directory, up to date; `--check` reports what is outstanding and exits non-zero
if anything is, without writing. Worked output and the failure-isolation rule
are in [operator-cli.md](operator-cli.md#migrate--apply-the-sql-migrations-that-own-the-databases-shape).

It is deliberately **not** wired into `run` / `orchestrate`: a pipeline can be
invoked directly as `python -m pipelines.<name>`, which would bypass such a
check anyway, and an unmigrated database already fails at the write.

## Using the runner directly

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

## Where a baseline comes from

A database's first migration — its `0001_create_initial_tables.sql` — has to
describe the tables it *already* writes, and it is generated rather than written
out by hand:

```sh
python -m pipelines.sharepoint_cases.pipeline --base-dir /tmp/run --sample
python scripts/generate_baseline_migrations.py sharepoint_cases \
    --base-dir /tmp/run --stdout          # review
python scripts/generate_baseline_migrations.py sharepoint_cases --base-dir /tmp/run
```

**The baseline is copied out of the database, not reconstructed.** SQLite keeps
the verbatim `CREATE` statement of every table and index in `sqlite_master`, so
the shape a database already has is written down inside it: the generator reads
those statements and writes them to the file. What lands is what
`sqlite3 <db> .schema` prints.

That is what makes a baseline faithful by construction rather than by argument.
There is no declared-type → SQLite-type mapping to be right about, no model of
what `pandas.to_sql` would have done, and nothing to keep in step as either
changes. It also covers every table the same way — a gold aggregate's columns are
whatever its transform computed, a quarantine reject table's are the rejected row
plus its reason, a raw landing table's are the source's, and none of the three has
a dataclass to be derived from. Constraints and indexes come along for free, for
the same reason: they are in the statement.

**Raw's baseline is therefore the actual raw read columns**, never the field list
in the feed's `schema.py`. Raw lands the source *faithfully* and `schema.py` is
not a faithful record of what that is: `scaffold --from-feed-file` caps the fields
it seeds at 40 columns, so a schema generated from a wide source describes a
prefix of it. The consequence is accepted rather than designed around: a wide
source — a 600+ column CSV — starts life as a very large hand-maintained DDL file.

**Generated once, then maintained by hand.** The generator refuses to overwrite a
baseline that is already checked in, because the runner's checksum refuses an
edited migration: once a database has applied a file, changing that file strands
it. A shape change after the baseline is a new numbered migration. Regenerating
from an unchanged database is byte-identical, so a baseline can be regenerated
elsewhere and diffed against the one checked in.

There is no run to read for a brand-new feed, which is why `scaffold` renders a
starting baseline from the feed's own declarations instead — see
[adding-a-feed.md](adding-a-feed.md).

## Keeping the migration and the dataclass in step

Two things describe one table. The numbered SQL says what the table **is** — its
columns, their types, its keys and indexes. The declared dataclass says what a
row **means**: which columns a feed must carry, what their values must satisfy,
what the quarantine partitioner routes on. Neither replaces the other, and
[graduated schema enforcement](adr/0006-graduated-schema-enforcement.md) is
unchanged by this — the validators still gate the data, they simply no longer
decide the storage.

Two owners of one thing can drift, and the failure is quiet: nothing breaks at
import, and the first symptom is a run failing on a column SQLite does not have.
**This is a review question, not a test.** Anything that would catch it
mechanically has to be told which tables have a dataclass at all — a gold
aggregate's columns are whatever its transform computed, a quarantine reject
table's are the rejected row plus its reason, a raw landing table's are the
source's, and none of the three has one — so it ends up carrying a hand-kept map
that itself drifts, which is what it was supposed to prevent.

So it is written down where a reviewer will read it, in
[pull-request-review.md](pull-request-review.md): *did a field change on a
dataclass without a migration beside it?* Two things to know when answering that:

- **Compare storage affinity, not the type name.** SQLite has no date or boolean
  type. `DATE` and `TIMESTAMP` are one physical column (both NUMERIC); `TEXT` and
  `INTEGER` are genuinely two. A declared `date` lands as `DATE` where the frame
  carries `datetime.date` objects and as `TIMESTAMP` where `SchemaCoercion` has
  cast it to `datetime64` — the same declaration, two names, one column.
- **A column no dataclass declares is not automatically wrong.** Every
  table-backed Writer stamps the reserved provenance column, gold's Detail Tables
  carry the `case_id` and `as_of_utc` their builder derives, and none of that
  belongs in a feed's row schema.

## Which subjects are under migration control

Three, today: `sharepoint_cases`, `reviewer_activity` and `notifications`.
Everything else under `pipelines/` is a demonstration or example that only ever
writes into a `tmp_path` inside tests, and keeps implicit table creation.

**Nothing checks that list.** A feed that reaches a real environment with no
migrations directory does not fail — it quietly keeps creating its tables on
first write, with whatever dtypes the frame happened to carry, no keys and no
indexes. That is the price of the self-declaring rule that makes converting
subjects one at a time possible, and it is **accepted for now rather than
solved**: two approaches were tried on this epic — a hand-maintained exclusion
list, and deriving "deployed" from the orchestration schedules — and neither was
right. [#729](https://github.com/nickwarters/data-pipeline-tooling/issues/729)
carries the problem statement, both rejected approaches with the reasons, and the
directions worth exploring. Until then, adding a subject to that list is a thing
to remember, and `scaffold` renders a new feed's baselines so the common path
does not depend on remembering.

## See also

- [`run-log-format.md`](run-log-format.md) — the run record schema and the
  registry's own, separate, self-migrating store.
- [`adr/0025-sql-migrations-own-the-physical-table-shape.md`](adr/0025-sql-migrations-own-the-physical-table-shape.md)
  — the decision itself, the alternatives weighed, and how migrating raw sits
  against ADR-0006's graduated enforcement.
- [`adr/0001-sqlite-per-subject-medallion-store.md`](adr/0001-sqlite-per-subject-medallion-store.md)
  — why a subject's databases are separate SQLite files.
