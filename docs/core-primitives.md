# Core primitives & the medallion layers

This is the framework's foundational vocabulary. The walking skeleton (the CSV →
raw slice, #2) introduced `Dataset`, `Reader`, `Store`, and the `Pipeline`
builder; slice #14 added the **`Writer`** port and reshaped the builder terminus
to `.write_to(writer).run()`; slice #3 added the **`Validator`** port and made
`.run()` fail-fast and atomic; slice #4 added the **`RunLog`** primitive and
wired structured JSONL observability into the terminus; slice #7 added the
**`Schema`** (a Case Type dataclass) and its **`SchemaValidator`**, plus the
**`raw_to_silver`** builder that enforces the schema at the silver boundary;
slice #23 added the **`Processor`** seam (`.with_processor`) and the
**`SchemaCoercion`** processor that repairs raw's round-trip-lossy types ahead of
that validator; slice #8 added the **`silver_to_gold`** builder that accumulates
validated silver into the gold layer, stamped by run; slice #9 added the
**Selection processors** (`Filter`/`Score`/`Sort`/`Rename`) and **`JoinWith`**,
the cross-feed join holding a lazy reference to another builder. Every later slice
builds on these shapes. For the
*why* behind each, see the ADRs referenced inline; for domain language (Case,
CasePool, Feed, Reference Data, …) see [`../CONTEXT.md`](../CONTEXT.md).

## Medallion layers

A medallion is three SQLite databases, one per layer (raw, silver, gold), on a
network share: **raw → silver → gold**. Each **subject** — a Case Type or a
shared Reference Data set — owns its **own** medallion, isolated from every
other subject's files (ADR-0001 amendment: blast-radius isolation, independent
onboarding). A Feed is ingested and refined upward; the Selection pipeline reads
the ingested silver/gold and writes the SelectionPool back into gold. (The layer
names are placeholders pending a domain rename — see CONTEXT.)

| Layer  | Holds                                  | Load behaviour |
|--------|----------------------------------------|----------------|
| **raw** | A faithful, schema-light snapshot of the source as landed — the framework's landing zone. | **Full refresh** each run: truncate + reload from the source snapshot, so re-runs are deterministic (ADR-0006). |
| silver | Validated, normalised data: the **schema boundary** — a Case Type's declared columns + dtypes are enforced here as a post-validator before the data lands (ADR-0008, #7). Normalising *coercion* (parsing dates, casting booleans) runs as a `process` step ahead of that check (#23). | Full refresh from raw. |
| gold   | Refined ingest outputs **and** the accumulating SelectionPool / Review Outcomes. The `silver_to_gold` builder carries validated silver forward (#8). | Accumulates, stamped `run_id` / `load_date`; idempotent re-run via delete-by-run then insert (ADR-0006; [gold-accumulation doc](gold-accumulation.md)). |

raw stays schema-light on purpose: it mirrors the source so the landing zone is
faithful, and schema enforcement arrives at silver and gold (ADR-0008).

> **Decided, not yet built (ADR-0006 amendment, ADR-0009).** The table above
> describes the *current* build, where the Store maps raw/silver → full-refresh
> and gold → accumulate-by-run. That layer→strategy mapping is being replaced:
> **load strategy becomes per-feed, owned by the Writer**, with the Store mapping
> `layer → location` only (`store.writer(layer, table, strategy)` where strategy
> is `Refresh()` or `AccumulateByRun(run_id, load_date)`). The **Ingest** profile
> then flips to *history-upstream / current-gold* — raw + silver accumulate the
> change-over-time record, gold is reduced to a current **one-row-per-Case**
> grain (`LatestPerKey` by `case_id` + a uniqueness validator). Selection/Sync/
> Reporting keep accumulate-by-run gold. See the two ADRs for the rationale and
> consequences (raw becomes a backed-up system of record; volume grows
> `records × snapshots`).

> **Build status.** The **per-subject `Store`** has landed: `Store(subject_dir)`
> *mints* that subject's layer-appropriate Writers/Readers over its own
> `<subject_dir>/{raw,silver,gold}.db`, and the legacy global `Store.write`/`read`
> is retired. The shared `connect` factory now lives in `framework.connection`
> (the seam that keeps `store` and `writers` cycle-free). **Validators** now
> attach to the builder (`.with_validator()` / `.with_post_validator()`) and
> `.run()` is fail-fast and atomic. **Structured JSONL observability** has
> landed: a `RunLog` composed onto the builder emits one JSON record per step
> plus a run summary to a `.log` file (and human-readable lines to the console)
> — the seam the future run-registry ingests (ADR-0007;
> [format doc](run-log-format.md)). **Schema enforcement at silver** has landed:
> a `SchemaValidator` derived from a Case Type's dataclass checks columns +
> dtypes, and the `raw_to_silver` builder attaches it as a post-validator so a
> breach aborts before silver is written (ADR-0008;
> [schema-enforcement doc](schema-enforcement.md)). **Coercion between raw and
> silver** has landed: a `Processor` seam (`.with_processor`) runs as a `process`
> step, and `SchemaCoercion` casts the schema's round-trip-lossy types (dates,
> booleans) ahead of the validator so a date/bool schema survives the round-trip
> (ADR-0008, #23). **Gold accumulation** has landed: the `silver_to_gold` builder
> carries validated silver into gold via the `AccumulateByRunWriter`, stamping each
> row `run_id` / `load_date` and making a re-driven run idempotent via
> delete-by-run then insert (ADR-0006;
> [gold-accumulation doc](gold-accumulation.md)). **The Selection processors**
> have landed: `Filter`/`Score` (plain-Python row callables — ADR-0002),
> `Sort`/`Rename`, and **`JoinWith`** — the cross-feed join that holds a lazy
> reference to another builder and resolves it to a DAG at `.run()`, joined in
> Python (ADR-0003, #9; [processors doc](processors.md)). Still ahead: the
> value-level schema rules (format / uniqueness / encoding, #24), the domain
> capstone (CaseType/Variation + CasePool → SelectionPool, #11), the
> run-registry that ingests the JSONL (ADR-0005), and the multi-table feed work
> (ADR-0006 amendment, ADR-0009): per-feed load strategy (Store maps
> `layer → location` only), the history-upstream / current-gold Ingest profile,
> reader column projection, the `LatestPerKey` reduction + one-row-per-Case grain
> validator, deterministic `case_id`, and Detail Tables.

## The primitives

### `Dataset` — the opaque tabular carrier
The bulk tier of the two-tier data carrier (ADR-0002). It wraps the concrete
in-memory engine (**pandas today, swappable to e.g. polars later**) so that
engine never leaks into the rest of the system. The public surface is
deliberately tiny:

- `dataset.columns -> list[str]`
- `len(dataset) -> int`

Only engine-confined code (readers, writers, the store, processors) crosses the
seam via `Dataset.from_pandas(frame)` / `dataset.to_pandas()`. **pandas must
never appear** in a Protocol signature, a pipeline script, or the domain layer —
only behind this seam. Typed domain objects (`Case`, `ReviewOutcome`) are the
*other* tier, materialised on demand at the domain edge (later slice).

### `Reader` — source IO behind one method
A `Reader` encapsulates how one source type is read:

```python
class Reader(Protocol):
    def read(self) -> Dataset: ...
```

`CsvReader(path)` reads a source feed; `ExcelReader(path, sheet=0)` reads one
worksheet of an `.xlsx` workbook (sheet selectable by name or zero-based index;
pandas + **openpyxl** behind the seam); `SqliteReader(db_path, table)` is the
read-side dual of the Sqlite Writers — it reads one table from a layer db back
into a `Dataset` (a subject's own layer, or another subject's read-only
Reference Data medallion, joined in Python — ADR-0002). `Sas`/`SharePoint`
follow the same shape (ADR-0004, ADR-0005; later slice). Readers are the home of
the concrete engine and are tested against **local fixture files** — no network,
no SAS, no SharePoint. Paths are handled with `pathlib` so they behave
identically on Windows and macOS. **How to add a Feed:**
[`adding-a-feed.md`](adding-a-feed.md).

*Decided, not yet built (ADR-0009):* a `columns=[...]` parameter on the readers
(`CsvReader` via pandas `usecols`, `SqliteReader` pushed into the `SELECT`) lets
a pipeline read only the columns it needs, leaving `read() -> Dataset`
unchanged. This is what keeps each single-table pipeline narrow when a wide feed
(650+ columns) is fanned out into a Case table and its Detail Tables.

### `Writer` — the destination, behind one method
A `Writer` is the component-role **dual of `Reader`**: a Reader brings data in,
a Writer takes it out (ADR-0003 amendment).

```python
class Writer(Protocol):
    def write(self, dataset: Dataset) -> None: ...
```

A Writer owns **both** its target location (a layer db file + table) **and** its
load strategy (ADR-0006). Swapping the Writer is how you target a different
database — the builder never learns about medallion layers or load rules. Two
concrete writers ship now:

- `SqliteTruncateReloadWriter(db_path, table)` — **full refresh** (truncate +
  reload). Used for raw/silver, which mirror a current-state source snapshot.
- `AccumulateByRunWriter(db_path, table, run_id, load_date)` — **accumulate by
  run** for gold: stamps each row `run_id` / `load_date` and makes a re-driven
  run idempotent via *delete-by-run then insert*. Wired by the `silver_to_gold`
  builder (#8; [gold-accumulation doc](gold-accumulation.md)).

### `Store` — one subject's medallion, minting its Writers/Readers
`Store(subject_dir, busy_timeout_ms=5000)` is the mouth of **one subject's**
medallion (a Case Type or a Reference Data set — ADR-0001 amendment): its three
files `<subject_dir>/{raw,silver,gold}.db`, isolated from every other subject's.
It holds **no business logic** (ADR-0002) and makes **no** load decision
(ADR-0003 amendment) — it merely mints the layer-appropriate component:

- `store.writer(layer, table)` — raw/silver get a `SqliteTruncateReloadWriter`
  (full refresh); gold gets an `AccumulateByRunWriter` and so requires
  `run_id` / `load_date` (stamped per the run that mints it).
- `store.reader(layer, table)` — a `SqliteReader` over the same file.

The strategy lives on the Writer the store mints, not on the store. A new
subject's directory is created on first write, so onboarding migrates nothing.

The connection factory `connect(db_path, busy_timeout_ms)` lives in
`framework.connection` — the single place connections are configured (ADR-0001),
which Readers, Writers, and the Store all open through. Keeping it in its own
module is the seam that lets the `Store` mint Writers/Readers without a
`store`↔`writers` import cycle. It sets a `busy_timeout` so read-only clients
ride out the single writer's in-place commits instead of erroring, and stays on
the default rollback journal because **WAL is unavailable over a network
share**.

### `Validator` — a fail-fast check at a layer boundary
A `Validator` states an expectation about a feed's data and **raises**
`ValidationError` when the data breaks it:

```python
class Validator(Protocol):
    def validate(self, dataset: Dataset) -> None: ...   # raises on failure
```

Two ship now, both reading only the dataset's public shape (so they stay behind
the Dataset seam — ADR-0002):

- `ColumnValidator(required_columns)` — every required column is present
  (presence, not dtype).
- `RowCountValidator(minimum=…, maximum=…)` — row count within an inclusive
  `[min, max]`; either bound is optional (`None` leaves that side open).

A Validator knows only how to *check*; it does **not** decide what a failure
means. **Severity is set where the Validator is attached to the builder**
(`severity="error" | "warn"`, default `error` — ADR-0007), so the same Validator
can abort one pipeline and merely warn another. These two are **engine-agnostic**
(shape only); the richer `SchemaValidator` below is the *engine-confined* kind.

### `Schema` & `SchemaValidator` — the declared contract, enforced at silver
A Case Type's **`Schema`** is an ordinary **dataclass** whose annotations *are*
the contract — each field is a column name and its declared Python type, the
single source of truth (ADR-0008):

```python
@dataclass
class CaseA:
    case_ref: str
    opened: date
    active: bool
```

`SchemaValidator(CaseA)` is the **dataclass→validator adapter** (the seam to
dataclass→Pydantic later, ADR-0005). It is a `Validator` of the same shape as
above, but **engine-confined**: where `ColumnValidator` reads only `dataset.columns`,
a schema check inspects column *dtypes*, so it reaches the frame via
`to_pandas()` exactly as a Reader/Writer/processor does (ADR-0002). It checks:

- every declared column is **present** (extra, undeclared columns are ignored);
- each present column's **dtype** matches the declared Python type — the
  Python-type ↔ pandas-dtype mapping lives here, engine-confined (`str`,
  `int`, `float`, `bool`, `date`/`datetime`).

Every breach is reported at once in one **located** message naming the column
and the expected-vs-actual type, then raised as `ValidationError`. A type the
adapter cannot map is a configuration error caught **when the validator is
built**, not mid-run. Postponed (string) annotations from
`from __future__ import annotations` are resolved via `typing.get_type_hints`.
Value-level rules (format / length / uniqueness / encoding) are later validators
of this same engine-confined shape and extend the same dataclass.

### `raw_to_silver` — the schema-enforcing builder
`raw_to_silver(store, table, schema)` encodes the ADR-0008 convention in one
place: it composes the subject's raw Reader and silver Writer into a deferred
`Pipeline` with `SchemaValidator(schema)` attached as a **post**-validator, and
returns it (call `.run()` to execute):

```python
raw_to_silver(store, "cases", CaseA).run()   # validates, then writes silver.db
```

A breach aborts at the silver boundary **before** silver is written (fail-fast
and atomic — ADR-0007), so nothing partial lands. Raw stays schema-light: data
the schema would reject still lands faithfully in raw. The builder makes no
write or load decisions — the Store mints the Writer, which owns location +
strategy. Full walkthrough: [schema-enforcement.md](schema-enforcement.md).

### `Processor` — an engine-confined transform, run mid-pipeline
A `Processor` transforms the dataset between the read and the post-validators:

```python
class Processor(Protocol):
    def process(self, dataset: Dataset) -> Dataset: ...
```

Unlike the structural validators it is **engine-confined** — a transform needs
the engine's vectorised operations, so it reaches the frame via
`to_pandas()`/`from_pandas()` exactly as a Reader/Writer does (ADR-0002). It is
attached with `.with_processor(...)` and runs as the builder's `process` step. A
processor has **no severity**: a transform either applies or it can't, so a
failure is always fail-fast (ADR-0007) — it raises and the run aborts.

Two families of concrete processor ship now.

**Schema coercion (#23).** `SchemaCoercion(schema)` — the write-side companion of
`SchemaValidator`, derived from the same Case Type dataclass. Where the validator
*checks* dtypes, the coercer *repairs* the representation raw loses to storage,
casting only the round-trip-lossy declared types — `date`/`datetime` (landed as
text) and `bool` (`TRUE`/`FALSE` text or `1`/`0`). `str`/`int`/`float` survive a
SQLite round-trip, so they pass through untouched and stay the validator's gate;
undeclared columns are left alone. A value it cannot cast (an unparseable date,
an unknown boolean encoding) raises a **`CoercionError`** with one located
message naming the column. `raw_to_silver` composes it ahead of the
`SchemaValidator`, so the per-run order is **read → pre-validate → process
(coerce) → post-validate (schema) → write** (ADR-0008, #23).

**Selection transforms (#9)** — the `filter/score/sort/join` of `CONTEXT.md`:

- `Filter(predicate)` / `Score(column, scorer)` — carry the business rule as a
  **plain-Python callable over a row mapping**, never SQL or a column DSL
  (ADR-0002); applied row-wise behind the seam.
- `Sort(by, ascending=True)` — order rows (`by` a column or sequence; index
  reset so the output reads positionally clean) for a meaningful "top N".
- `Rename({old: new})` — align column vocabulary (e.g. agree a key name before a
  join); unnamed columns pass through.
- `Stamp(column, value)` — write one constant column (the run-level
  `question_bank_id` a Variation resolves), even onto an empty feed (#11).
- `JoinWith(other, on=..., how="inner")` — the cross-feed join. `other` is a
  **lazy reference to another builder** (any `Runnable` — typically a read-only
  `Pipeline` over another subject's silver/gold), **not executed** until the
  join's `process` step runs `other.run()` and merges in Python. That is how a
  pipeline resolves to a **DAG without a separate DAG engine** (ADR-0003).

Full walkthrough + worked example: [processors.md](processors.md).

### `RunLog` — structured JSONL run observability
A `RunLog` is the observability seam (ADR-0007). Composed onto the builder
(`Pipeline(name, reader, run_log=RunLog(path))`), it emits **one JSON object per
line** to a `.log` file — and a human-readable line per record to the console —
for each step of a run plus a final `run` summary:

```python
class RunLog:
    def record(self, run_id, pipeline, step, status, *,
               rows_in=None, rows_out=None, duration=None,
               errors=None, warn_hits=None) -> None: ...
    def step(self, run_id, pipeline, step, rows_in=None): ...  # times a block
```

Every record of a single run carries the same `run_id` (minted by `.run()`,
exposed as `pipeline.run_id`), so the deferred run-registry (ADR-0005) can group
a run without parsing free text. The builder owns no path or format knowledge —
it just drives the sink; when no `RunLog` is composed a null sink keeps `.run()`
branch-free while emitting nothing. The full record schema, the per-step
breakdown, and the fail-fast/warn examples live in
[`run-log-format.md`](run-log-format.md).

### `Pipeline` — the deferred fluent builder
A `Pipeline` describes a feed's path and runs **nothing** until `.run()`
(ADR-0003):

```python
(
    Pipeline("cases", CsvReader(path))
    .with_validator(ColumnValidator(["case_ref"]))        # pre: gate the input
    .with_post_validator(RowCountValidator(minimum=1))     # post: gate the output
    .write_to(writer)
    .run()
)
```

`.with_validator(v, severity="error")` attaches a **pre**-validator (checks the
input); `.with_post_validator(v, severity="error")` attaches a **post**-validator
(checks the output that is about to be written). `.write_to(writer)` composes in
the destination Writer. All deferred — nothing runs until `.run()`.

`.run()` is the terminus and is **fail-fast and atomic** (ADR-0007): it reads the
source, runs the pre-validators, runs the processors (the `process` step —
`.with_processor`), runs the post-validators over that transformed dataset, then
hands the bulk-tier `Dataset` to the Writer and returns it.

- An **error**-severity failure aborts the run by raising `ValidationError`
  *before* the Writer is ever called — so a bad dataset never reaches the layer
  and **nothing partial lands**. (The write itself is also a single SQLite
  transaction owned by the Writer, so gold's delete-by-run + insert is
  all-or-nothing even on a mid-write error.)
- A **warn**-severity failure logs a warning naming the problem and the run
  continues — the explicit, deliberate escape hatch for known-tolerable
  conditions.

The builder still makes **no** write decisions — no layer logic, no
refresh-vs-accumulate branching; that all lives on the Writer. Because the
terminus owns execution, it is the home of the cross-cutting concerns: it now
mints the run's `run_id`, times each step, and drives the composed `RunLog`
(timing + structured JSONL logging — landed in #4). The `process` step
(`.with_processor()`) landed in #23; lineage checkpoints (`.checkpoint(writer)`)
remain ahead.

### `WorkingDayCalendar` — working-day arithmetic (pure utility)
A config-seeded `WorkingDayCalendar(holidays=…, weekend=…)` answers working-day
questions for availability criteria ("the last 20 working days" — `CONTEXT.md`).
Unlike the primitives above it touches no `Dataset`, `Store`, or engine — it
is pure stdlib `datetime`, hence deterministic and identical on Windows/macOS,
and is **not** a Feed (ADR-0001 amendment). Two queries: `is_working_day(day)`
and `last_n_working_days(n, from_date)` (the `n` most recent working days on or
before `from_date`, most-recent first, skipping weekends + holidays). Full
config and boundary semantics in
[`working-day-calendar.md`](working-day-calendar.md).

## The domain layer (#11)

Above the engine primitives sits the thin **domain layer** the framework exists
to expose — the declarative Case Type objects and the `CasePool` that reads the
ingested silver, surfaced through intention-revealing retrievals instead of raw
`pandas.read_*` calls. The full flow lives in [`selection.md`](selection.md); in
brief:

### `CaseType` / `Variation` — the declarative domain objects
A `CaseType` (`framework.case_type`) bundles a Case Type's `schema` with its
`variations`, imported directly — no global registry (ADR-0005).
`CaseType.variation(id)` resolves a `Variation` (its `question_bank_id` + later
overrides) and raises a located `KeyError` on an unknown id. Declarative data,
not code (one Case Type has many Variations — `CONTEXT.md`).

### `CasePool` — the domain population, behind named reads
`CasePool(case_type, store, calendar)` (`framework.case_pool`) is the
per-Case-Type population of Cases read from the **ingested silver**. Its headline
retrieval is the *concept* of fetching **available cases** — e.g.
`fetch_available_cases(as_of, activity_column=…, within_working_days=…)` narrows
to a `WorkingDayCalendar` window in Python (ADR-0002), repairing silver's
text-stored dates first, and returns a bulk-tier `Dataset`. Fully typed `Case`
objects are the typed-on-demand edge reserved for a later slice (ADR-0002).

### `DatasetReader` — bridge an in-memory Dataset into the builder
`DatasetReader(dataset)` (`framework.readers`) adapts an already-in-memory
`Dataset` to the `Reader` shape, so the **Selection** pipeline feeds the
CasePool's available cases straight into the `Pipeline` builder (read → process →
write) without a SQL round-trip. Selection is its own pipeline that reuses the
builder, narrowing the CasePool with the Selection processors and `Stamp` into
the gold `SelectionPool`.

## Worked example

```python
from framework.builder import Pipeline
from framework.readers import CsvReader
from framework.store import Store

# The "cases" subject's medallion mints the raw Writer over its own raw.db.
store = Store("/path/to/share/cases")
landed = (
    Pipeline("cases", CsvReader("feed.csv"))
    .write_to(store.writer("raw", "cases"))
    .run()
)
print(len(landed), landed.columns)
```

See [`../pipelines/demo_csv_to_raw.py`](../pipelines/demo_csv_to_raw.py) for the
runnable demo.
