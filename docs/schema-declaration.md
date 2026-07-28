# Declaring table shapes and reporting drift — `schema diff`

Read-only, no behaviour change: nothing here writes to a database or alters a
pipeline. It makes the shape of every table a feed lands **declarable**, and
tells you how far a live environment has already drifted from that
declaration — safe to run against prod on day one.

## `Table` is a storage contract; `Schema` is a validation contract

A Case Type's `Schema` (`framework.core.SchemaValidator`) is checked *while
data flows through a pipeline* — every row, every run. `Table`
(`tools.schema`) declares the *sibling* question: what does the live database
look like, independent of any run? The two read the same row dataclasses where
a feed has one, but they are deliberately separate contracts — `Table` sits
beside `SchemaValidator`, it does not extend or replace it, and the
framework's validation modules (`framework/core/schema.py`,
`framework/core/validators.py`, `framework/core/value_rules.py`) are untouched
by this slice.

```python
from dataclasses import dataclass

from tools.schema import Index, Table, columns_of, text_columns

@dataclass
class ComplaintsARow:
    record_id: str
    label: str
    amount: int

TABLES = (
    # text_columns is the intended raw shape; see the raw-is-meant-to-be-TEXT
    # note below for why several feeds here declare raw with columns_of instead.
    Table("raw", "complaints_a", columns=text_columns(["record_id", "label", "amount"])),
    Table("silver", "complaints_a", row=ComplaintsARow, primary_key=("record_id",)),
    Table("gold", "cases", row=ComplaintsARow, primary_key=("record_id",),
          indexes=(Index("label"),)),
)
```

- **`Column(name, sql_type="TEXT", nullable=True)`** — one declared column.
- **`Index(column, unique=False)`** — one declared index.
- **`Table(namespace, name, *, row=None, columns=None, primary_key=(), indexes=())`**
  — one landing site. Construct with exactly one of `row=` (derive columns from
  a dataclass via `columns_of`) or `columns=` (an explicit tuple, e.g. from
  `text_columns`).
- **`columns_of(row_type)`** — one `Column` per dataclass field, in
  declaration order. The Python → SQL type mapping is `tools.schema`'s own
  (`str → TEXT`, `int → INTEGER`, `float → REAL`, `bool → INTEGER`,
  `date`/`datetime → TEXT`) — a separate, storage-facing mapping, not
  `framework._internal.schema`'s validation-facing one; the two must not grow
  coupled. A field is nullable unless annotated `NonNull()` (matching
  `SchemaValidator`'s own default), or made nullable explicitly by `X | None`.
- **`text_columns(names)`** — every column `TEXT` and nullable: the *intended*
  raw landing shape (see the note below on why several feeds here don't match
  it yet), and the one form a **wide raw feed**'s `raw_columns.txt` becomes a
  `Table` (see below).
- **`retype(columns, **overrides)`** — return `columns` with the named ones'
  `sql_type` overridden (it raises rather than silently ignore a name that
  isn't in `columns`). A pipeline that re-parses a column into a real
  Python object right before *this particular write* (most commonly
  `SchemaCoercion` turning a landed date string into a real `date`) changes
  what pandas' `to_sql` types the column as — `columns_of`'s default assumes
  the field is still in its landed (unparsed) form, so override just the
  affected column rather than hand-writing the whole list. See the per-table
  comments in `pipelines/case_selection/schema.py` and
  `pipelines/comprehensive_examples/schema.py` for worked examples, including
  the case where a column is typed differently at two different tables the
  same row dataclass feeds (raw vs. silver; a table freshly coerced vs. one
  re-read through a plain `SqliteReader` with no re-parse, which reverts a
  date back to text). `retype` describes what the current Writers *do*, which
  is not always what the design *intends* — see [raw is meant to be
  `TEXT`](#raw-is-meant-to-be-text-and-in-this-repo-it-isnt-yet) below.
- **`ACCUMULATE_BY_RUN_COLUMNS`** — the `logical_run_id` / `load_date` columns
  a bare `framework.io.AccumulateByRun(...)`'s Writer stamps onto every row it
  lands. Append this to any table written with that strategy.
- **`ACCUMULATE_BY_RUN_CONTEXT_COLUMNS`** — the same plus `pipeline_run_id`,
  for a strategy built via `AccumulateByRun.from_context(context)` (the common
  case). Two constants rather than one because a bare `AccumulateByRun(...)`
  with no `pipeline_run_id` never adds that column at all, and the diff is
  column-exact: declaring a column nothing stamps reports as
  `- pipeline_run_id   declared, missing`.

### A row shape is not a table

**Only the shapes a feed writes belong in `TABLES`.** A schema module may hold
more row dataclasses than it declares tables for — a Case Type's own
mid-pipeline intermediate shape, or a read contract for a table this pipeline
only reads and never writes. Declaring the latter would have this feed claim
ownership of a table it doesn't own.

The worked example in this repo is **`pipelines/retail_analytics/schema.py`**:
of its five dataclasses, only `RevenueRow` / `RiskRow` / `OpsRow` are in
`TABLES` (the three silver terminuses the DAG writes). `OrderRow` and
`CatalogRow` are read contracts for the two sample CSVs it reads straight off
disk and never lands anywhere, so they stay out.

> **Correction to issues #320/#321.** Both cite
> `pipelines/case_selection/schema.py` as the example, claiming `SalesRow` and
> `CaseReviewRow` are read contracts for silver tables *other* feeds own. That
> is not true of this repo: `case_selection` declares `UPSTREAMS = ()` and
> lands `sales` and `case_reviews` itself, raw **and** silver, from its own
> bundled CSVs — so all six of its tables are correctly in its `TABLES`. The
> distinction the issues draw is sound and load-bearing; only that particular
> illustration of it is wrong.

### Raw is meant to be `TEXT`, and in this repo it isn't yet

Issue #320 settles this as a decision: **"Raw is declared and TEXT throughout.
Faithful landing means no type inference; typing is silver's job, where
`SchemaCoercion` already does it under contract."** That is the intended
contract, and it is the reason raw never needs a retype — the one migration
SQLite makes genuinely painful.

The demo feeds in `pipelines/` **do not honour it**, and their declarations say
so. They read through plain `CsvReader`, which infers dtypes exactly as
`pandas.read_csv` would, so an integer source column lands `INTEGER` in raw
even though nothing has validated or coerced it. Several feeds here therefore
declare raw with `columns_of(Row)` (or a `retype(...)`d list) rather than
`text_columns(...)`.

**Raw-as-`INTEGER` is not the design intent — it is drift that predates this
step.** Step 1 of #320 is deliberately about *observing* reality, so the
declarations describe what actually lands rather than what should: declaring
raw as `TEXT` today would make `schema diff` report a wall of type mismatches
that no migration in #322 could fix, because the cause is the reader, not the
DDL. The fix belongs upstream of the declaration — switch those raw hops to a
text-faithful reader (`StrictCsvReader`) and the raw declarations become plain
`text_columns(...)` — and it is a behaviour change to a running pipeline, so it
is its own decision, not a side effect of declaring shapes. Until it happens,
read every `columns_of(...)` in a **raw** `TABLES` entry as "this is what the
current reader produces", never as "this is what raw should be".

`migrations make` generates from the declaration, so a generated migration for
such a table does create a non-`TEXT` raw column — and says so, loudly, in a
`NOTE` comment on the file, pointing here. That is the honest option: emitting
`TEXT` instead would create a table the feed's own Writer immediately
contradicts, and leave `schema diff` reporting permanent drift. Once the reader
is fixed, correcting those columns is a *new* forward migration (a 12-step
rebuild — `migrations/README.md`), never an edit to an applied file. See
[`migrations.md`](migrations.md).

### What the diff does not yet cover

`primary_key` and `indexes` are declared, but `tools.schema.live` diffs
**columns only**. Today's Writers create neither a primary key nor an index
(`frame.to_sql(...)` makes a bare table), so diffing them would report the
identical drift on every declared table in every environment and drown the
column-level signal this step exists to surface. They are declared now because
the migration generator in #322 is what will read them — and because writing
them down is how the intended shape stops living only in someone's head.
Column *nullability* is read back from the live table but likewise not diffed,
for the same reason.

`migrations make` (#322) consequently does **not** emit them either — a
constraint `schema diff` never re-verifies, on a table whose `Refresh`-strategy
Writer would erase it on the next run, would be worse than merely missing. The
generated file names what was declared and left out, in a comment, for a human
to add where a Writer genuinely depends on it. Reasoning in full:
[`adr/0015-declared-schema-generated-migrations.md`](adr/0015-declared-schema-generated-migrations.md).

## Wide raw feeds: `raw_columns.txt`

A 660-column raw feed declares its columns as a plain one-name-per-line file
next to the pipeline, generated from a sample and committed:
`pipelines/<feed>/raw_columns.txt`. Diffable, reviewable by skim, and it is the
same list `ColumnValidator` already wants — so a feed with one no longer keeps
`RAW_FEED_COLUMNS` as a second hand-kept copy; both it and the raw `Table` read
the one file:

```python
RAW_FEED_COLUMNS = (Path(__file__).parent / "raw_columns.txt").read_text().split()

TABLES = (Table("raw", "wide_feed", columns=text_columns(RAW_FEED_COLUMNS)),)
```

**No feed in this repo has one yet**, and no loader helper ships for it — the
one-liner above is the whole mechanism. Only introduce the file where a feed's
raw shape is genuinely non-trivial: this repo's demo feeds top out at 8
columns, and a 3-line txt file for a 3-column feed is worse than an inline
tuple. (`cli scaffold --from-feed-file` still emits `RAW_FEED_COLUMNS` inline
in `schema.py`; teaching it to write a `raw_columns.txt` past some column count
is a follow-up, not part of this step.)

## Reading a live table and diffing it (`tools.schema.live`)

```python
from tools.schema import diff_tables, read_live_table

live = read_live_table(base_dir, "complaints_a/raw", "complaints_a")
diff = diff_tables(table, live)
```

`read_live_table` resolves `namespace` to a file exactly the way
`tools.store.DirectoryStoreBackend` does (so a declared namespace always
means the file a real run would have written), then reads the table's shape
via `PRAGMA table_info` — no row is ever materialised, so a diff run is cheap
even against a large table. It opens through
`framework._internal.connection.connect` like every other SQLite component;
never a bare `sqlite3.connect`. A missing database file or missing table both
return `None` — a namespace that has never landed anything, not drift.

`diff_tables(table, live)` reports three kinds of column disagreement:

- `~ name   declared X, live Y` — present on both sides, a type mismatch.
- `+ name   live only (undeclared)` — landed, but never declared.
- `- name   declared, missing` — declared, but absent from the live table.

`TableDiff.landed` is `False` when the table has never run; `TableDiff.drifted`
is `True` only for a *landed* table with at least one disagreement — a fresh
environment that has simply never run yet is not "drifted".

## `python -m cli schema diff`

```sh
python -m cli schema diff --env prod
```

```
complaints_a/silver.db  complaints_a
  ~ received_date   declared TEXT, live REAL
  + adviser_code   live only (undeclared)
  - case_status   declared, missing

complaints_b/raw.db  not yet landed: complaints_b

2 database(s) clean, 1 drifted, 1 pending (not yet landed)
```

Takes the same `--base-dir` / `--env` pair every other operator command does
(`cli.operator.add_base_dir_args` / `base_dir_or_report`, over
`tools.environments.resolve_base_dir`). Every declared table across every feed
under `pipelines/` is collected (`tools.schema.collect_declared_tables()`),
diffed, and grouped by the database it lands in — across feeds, not per feed,
because two feeds can declare tables in one namespace (`pipelines/ingest` and
`pipelines/selection` both land in `cases/gold`) and a database counts once.

There are **three** per-database states, not two:

| State | Meaning | Exit code |
|---|---|---|
| clean | every declared table exists and its columns agree | 0 |
| **drifted** | a table that *does* exist disagrees with its declaration | **non-zero** |
| pending | nothing has landed here yet (no file, or no such table) | 0 |

"Pending" is deliberate: an environment that has simply never run a feed has
not *drifted* from anything, and failing CI for it would make the gate useless
on a fresh deployment. A table that does exist is held to the full column
contract — a declared column missing from a live table is drift and exits
non-zero, exactly like a type mismatch or an undeclared extra column. A
database with both drift and pending tables counts as drifted.

Exiting non-zero only on drift is what lets this be wired into CI as a gate
later without this issue building that gate itself.

## The cross-check: `TABLES` vs. what pipelines actually write

`TABLES` says where a table lives — and so does the pipeline when it wires
`med.silver.writer("complaints_a", Refresh())`. That is a third source of
truth that can silently drift from the other two, and it gets a guard:
`tests/integration/test_declared_tables_match_pipelines.py`, in the same
spirit as `tests/integration/test_public_api.py`. It runs every bundled feed
for real against one throwaway `base_dir` (each ships its own sample data),
then asserts every table any Writer actually landed appears in some feed's
`TABLES`, and every declared table was actually landed. It self-tests the
comparison itself against synthetic `(namespace, table)` sets — proving it
catches an undeclared write *and* a declared-but-unwritten table — so it cannot
quietly stop guarding anything.

Issue #321 sketched this as a walk over each pipeline's `.describe()`. It
compares landed reality instead, for two reasons: `describe()` renders the
plan's *steps*, and a `Writer`'s target table is not part of that rendering —
surfacing it would mean teaching `framework/` what a table name is for the
benefit of a declaration it must not know about. And a physical
`(namespace, table)` set is the stronger assertion of the two: it catches a
table a pipeline lands *without* going through the wiring the plan describes.
It is cheap (well under a second for all nine feeds) and hermetic (one
`tmp_path`, no network, no shared state), so it is a guard rather than a
liability. Reject/quarantine tables and the run-metadata stores (`_runs/`,
`_registry/`, `_orchestration/`) are skipped: they are a different concept from
the medallion table shapes `TABLES` declares.

The one hole that leaves is a feed the run list forgets: a feed nothing runs
lands nothing, so it can't produce an undeclared write. The sibling test in the
same module closes it by **enumerating** `pipelines/` and requiring every feed
package to declare `TABLES` — so a new feed either declares its tables (and
then must be run by the cross-check to land them) or names itself in
`FEEDS_WITHOUT_TABLES` with a reason. Neither state is silent.

## Where `ingest` / `selection` put `TABLES` — a placement note

Every other feed under `pipelines/` has a `schema.py`, so `TABLES` lives there,
beside the row dataclasses `columns_of` derives it from. `pipelines/ingest/`
and `pipelines/selection/` are the two feeds with no `schema.py` at all:

- **`ingest`** declares its one row dataclass (`ActivityCase`) directly in
  `pipeline.py` — there is nothing else a `schema.py` for this feed would hold.
  `TABLES` lives right beside `ActivityCase`, in `pipeline.py`.
- **`selection`** has no row dataclass of its own at all: its two gold tables
  (`selection_pool`, `selection_trace`) narrow/derive from `ingest`'s
  `ActivityCase` schema and the framework's own `RowTrace` shape.
  `TABLES` lives in `pipeline.py`, beside the wiring it describes.

Both use the "platform namespace" form of `Table`'s `namespace` (e.g.
`"cases/gold"`, not a bare `"gold"`) because their own `pipelines/<name>`
directory name (`ingest`, `selection`) is **not** the Case Type subject
(`"cases"`) their tables actually land under — `resolved_namespace` only
infers a subject from the feed's directory for a bare layer name, so a feed
whose subject differs must always spell out the full namespace explicitly.
