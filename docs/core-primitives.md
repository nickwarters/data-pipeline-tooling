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
**Selection processors** (`Filter`/`Score`/`VectorizedFilter`/
`VectorizedDerive`/`Sort`/`Rename`) and **`JoinWith`** / **`AntiJoinWith`**,
the cross-feed join over an explicit read-only dependency. Every later slice
builds on these shapes. For the
*why* behind each, see the ADRs referenced inline; for domain language (Case,
CasePool, Feed, Reference Data, …) see [`../CONTEXT.md`](../CONTEXT.md).

Application code (`pipelines/` + the `case_review/` domain layer) imports these
primitives through the public facades (`framework.core` / `framework.io` /
`framework.transform` / `framework.validate` / `framework.run` /
`framework.recipes` / `framework.shared`), not the home modules named per-primitive below; the home
modules locate the code, the facades are the stable contract. The package root
exposes only those facade modules for discovery (`framework.core`,
`framework.io`, `framework.transform`, `framework.validate`, `framework.run`,
`framework.recipes`, `framework.shared`); it does not re-export primitive classes directly. See
[`public-api.md`](public-api.md).

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
| gold   | Refined ingest outputs **and** the accumulating SelectionPool / Review Outcomes. The `silver_to_gold` builder carries validated silver forward (#8). | Accumulates, stamped with logical run id / `load_date` and, when context-driven, `execution_id`; idempotent re-run via delete-by-logical-run then insert (ADR-0006; [gold-accumulation doc](gold-accumulation.md)). |

raw stays schema-light on purpose: it mirrors the source so the landing zone is
faithful, and schema enforcement arrives at silver and gold (ADR-0008).

> **Decided, not yet built (ADR-0006 amendment, ADR-0009).** The table above
> describes the *current* build, where the Store maps raw/silver → full-refresh
> and gold → accumulate-by-run. That layer→strategy mapping is being replaced:
> **load strategy becomes per-feed, owned by the Writer**, with the Store mapping
> `layer → location` only (`store.writer(layer, table, strategy)` where strategy
> is `Refresh()`, `AccumulateByRun(run_id, load_date)`,
> `AccumulateByRun.from_context(context)`, or `UpsertStrategy(key_columns)`).
> The **Ingest** profile
> then flips to *history-upstream / current-gold* — raw + silver accumulate the
> change-over-time record, gold is reduced to a current **one-row-per-Case**
> grain (`LatestPerKey` by `case_id` + a uniqueness validator). Selection/Sync/
> Reporting keep accumulate-by-run gold. See the two ADRs for the rationale and
> consequences (raw becomes a backed-up system of record; volume grows
> `records × snapshots`).

> **Build status.** The **per-subject `Store`** has landed: `Store(subject_dir)`
> *mints* that subject's Writers/Readers over its own
> `<subject_dir>/{raw,silver,gold}.db`, and `StoreCatalog(root).store(subject)`
> mints those subject stores from shared root/configuration. The legacy global
> `Store.write`/`read` is retired. The shared `connect` factory now lives in
> `framework._internal.connection` (the seam that keeps `store` and `writers` cycle-free).
> **Validators** now
> attach to the builder (`.validate()` / `.validate()`) and
> `.run()` is fail-fast and atomic. **Structured JSONL observability** has
> landed: a `RunLog` composed onto the builder emits one JSON record per step
> plus a run summary to a `.log` file (and human-readable lines to the console)
> — the seam the run-registry ingests (ADR-0007;
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
> row with the logical run id / `load_date` and, for context-derived strategies,
> `execution_id`; a re-driven business run is idempotent via delete-by-logical-run
> then insert (ADR-0006;
> [gold-accumulation doc](gold-accumulation.md)). **The Selection processors**
> have landed: `Filter`/`Score` (plain-Python row callables — ADR-0002),
> `VectorizedFilter`/`VectorizedDerive` (whole-frame callables for
> batch-friendly filtering and column derivation), `Sort`/`Rename`, and
> **`JoinWith`** / **`AntiJoinWith`** — the cross-feed join
> and exclusion-list gate that hold a lazy
> reference to another builder and resolves it to a DAG at `.run()`, joined in
> Python (ADR-0003, #9; [processors doc](processors.md)). **The run registry**
> has landed: a `RunRegistry` ingests the `RunLog` JSONL into its own queryable
> SQLite store — idempotent by `run_id` + step, queryable by pipeline / status /
> time, surfacing warned (incl. schema-drift) runs (ADR-0005/0007, #52;
> [run-log-format doc](run-log-format.md)). **The thin Pipeline runner** has
> landed: `PipelineRunner` dispatches domain Pipelines by `(case_type, pipeline)`,
> passes a shared `RunContext` into handlers, and `FreshnessRequirement` blocks
> stale downstream runs from `RunRegistry` history without changing the builder
> contract (#61, #77). Still ahead: the value-level schema
> rules (format / uniqueness / encoding, #24), the domain capstone
> (CaseType/Variation + CasePool → SelectionPool, #11), and the multi-table feed work
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

`to_pandas()` returns a **copy** by default, enforcing the opacity guarantee:
callers cannot mutate the carrier's backing frame. Use `to_pandas(copy=False)`
only in hot paths where the caller guarantees it will not mutate the frame.

### `Reader` — source IO behind one method
A `Reader` encapsulates how one source type is read:

```python
class Reader(Protocol):
    def read(self) -> Dataset: ...
```

`CsvReader(path)` reads one source CSV file. `GlobCsvReader(directory, pattern)`
reads many local CSV files that together form one logical Feed snapshot: it
matches files with `pathlib.Path.glob`, reads them in sorted deterministic
order, concatenates them behind the `Dataset` seam, and raises
`FileNotFoundError` naming the directory and pattern when nothing matches.
`ExcelReader(path, sheet=0)` reads one worksheet of an `.xlsx` workbook (sheet
selectable by name or zero-based index; pandas + **openpyxl** behind the seam);
`SqliteReader(db_path, table)` is the read-side dual of the Sqlite Writers — it
reads one table from a layer db back into a `Dataset` (a subject's own layer, or
another subject's read-only Reference Data medallion, joined in Python —
ADR-0002). `SasReader(script, copy_glob, dest)` and
`SharePointReader(site, list_name, auth)` follow the same `read()` shape but
reach a remote source whose client is **stubbed for now**, behind a swappable
seam in `framework.io.remote` (ADR-0004, ADR-0005); see
[`adding-a-feed.md`](adding-a-feed.md#remote-feeds-sas-sharepoint). Readers are
the home of the concrete engine and are tested against **local fixture files** —
no network, no SAS, no SharePoint. Paths are handled with `pathlib` so they
behave identically on Windows and macOS. **How to add a Feed:**
[`adding-a-feed.md`](adding-a-feed.md).

A `columns=[...]` parameter on readers that support projection (`CsvReader` and
`GlobCsvReader` via pandas `usecols`, `SqliteReader` pushed into the `SELECT`)
lets a pipeline read only the columns it needs, leaving `read() -> Dataset`
unchanged. This is what keeps each single-table pipeline narrow when a wide feed
(650+ columns) is fanned out into a Case table and its Detail Tables.

#### Source type coverage

The Reader/Writer set is symmetric where the framework supports both inbound
Feeds and outbound Deliverables for a source type. Intentionally absent
directions are explicit:

| Source type | Reader | Writer | Notes |
|-------------|--------|--------|-------|
| CSV file | `CsvReader`, `GlobCsvReader` | `CsvWriter` | `CsvWriter(path, strategy)` emits one CSV file; `GlobCsvReader` is read-only because many inbound files together form one logical snapshot. |
| Excel file | `ExcelReader` | `ExcelWriter` | Both target one worksheet (`sheet=...`). |
| JSON file | _intentionally absent_ | `JsonWriter` | JSON is currently a Reporting Deliverable format only; no inbound JSON Feed has been needed yet. |
| SQLite table | `SqliteReader` | `SqliteTruncateReloadWriter`, `AccumulateByRunWriter`, `SqliteUpsertWriter` | The Store mints these over medallion layer databases. |
| SAS extract | `SasReader` | _intentionally absent_ | SAS is an inbound-only remote source; the framework lands the remote output then reads local CSV files. |
| SharePoint list | `SharePointReader` | `SharePointWriter` | Target is **SE on-prem**. Both sides are stubbed behind swappable `SharePointFetcher` / `SharePointPusher` seams until the on-prem SE client (NTLM/Kerberos/REST) lands. `SharePointWriter` emits the canonical Selection Deliverable — one list per Case Type. |
| Console (stdout) | _intentionally absent_ | `StdoutWriter` | A terminal sink for *seeing* a result rather than persisting it — e.g. printing a Selection explainer's per-Case trace while driving a feed by hand. Owns no location or load strategy; prints the dataset as a plain-text table to the stream (defaulting to `sys.stdout`). |

### `Writer` — the destination, behind one method
A `Writer` is the component-role **dual of `Reader`**: a Reader brings data in,
a Writer takes it out (ADR-0003 amendment).

```python
class Writer(Protocol):
    def write(self, dataset: Dataset) -> None: ...
```

A Writer owns **both** its target location (a layer db file + table, or a file
Deliverable path) **and** its load strategy (ADR-0006). Swapping the Writer is
how you target a different sink — the builder never learns about medallion
layers, file formats, or load rules. Concrete writers ship for file
Deliverables and SQLite tables:

- `CsvWriter(path, strategy)` — writes a CSV file with stable LF line endings.
- `ExcelWriter(path, strategy, sheet="Sheet1")` — writes one worksheet in an
  `.xlsx` workbook.
- `JsonWriter(path, strategy)` — writes a UTF-8 JSON array of record objects.
- `SharePointWriter(site, list_name, auth=None, strategy=Refresh(), pusher=...)`
  — pushes rows to an on-prem SE SharePoint list through a swappable pusher seam;
  the default pusher raises until the on-prem SE client (NTLM/Kerberos/REST)
  lands. Emits the Selection Deliverable — one list per Case Type.
- `SqliteTruncateReloadWriter(db_path, table)` — **full refresh** (truncate +
  reload). Used for raw/silver, which mirror a current-state source snapshot.
- `AccumulateByRunWriter(db_path, table, run_id, load_date, execution_id=None)` —
  **accumulate by logical run** for gold: stamps each row `run_id`,
  `logical_run_id`, `load_date`, and optional `execution_id`. The legacy `run_id`
  column is the logical/idempotency key; `execution_id` is the trace key that
  matches RunLog/RunRegistry when the strategy is derived from a `RunContext`.
  A re-driven run is idempotent via *delete-by-run then insert*. Wired by the
  `silver_to_gold` builder (#8; [gold-accumulation doc](gold-accumulation.md)).
- `SqliteUpsertWriter(db_path, table, key_columns)` — **update-or-insert** by a
  declared key set (#136): for each incoming row whose key already exists in the
  target the row is replaced; new keys are inserted; target rows whose key is
  absent from the incoming batch are preserved. The merge is a single atomic
  transaction. Minted by `Store.writer(layer, table, UpsertStrategy(...))`.
  Useful for a table that holds the **current state of a keyed entity**, e.g.
  `active_cases` keyed on `case_id`.

The file Writers accept the same explicit strategy objects as Store-minted
Writers: `Refresh()` overwrites the file; `AccumulateByRun(...)` reads any
existing file, replaces rows for that logical run, stamps the new rows, and
rewrites the file. Round-tripping through matching Readers is stable for CSV and
Excel at the Dataset shape level; exact pandas dtype inference can still differ
after a file round-trip, so schema-sensitive flows should continue to validate
after reading.

### `Store` / `StoreCatalog` — subject medallions, minted from shared configuration
`Store(subject_dir, busy_timeout_ms=5000)` is the mouth of **one subject's**
medallion (a Case Type or a Reference Data set — ADR-0001 amendment): its three
files `<subject_dir>/{raw,silver,gold}.db`, isolated from every other subject's.
It holds **no business logic** (ADR-0002) and makes **no** load decision
(ADR-0003 amendment) — it merely mints the layer-appropriate component:

- `store.writer(layer, table, strategy)` — mints a Writer over the chosen layer
  using the caller's explicit `Refresh()`, `AccumulateByRun(...)`, or
  `UpsertStrategy(...)` strategy. Context-driven accumulation uses
  `AccumulateByRun.from_context(context)`.
- `store.reader(layer, table)` — a `SqliteReader` over the same file.

Layer names are validated through `RAW`, `SILVER`, `GOLD` / `Layer`; existing
string calls remain accepted for compatibility and are rejected if they are not
one of the three conventional names. The strategy lives on the Writer the store
mints, not on the store. A new subject's directory is created on first write, so
onboarding migrates nothing.

`StoreCatalog(root, backend=..., busy_timeout_ms=5000)` owns shared
configuration and mints subject stores with `catalog.store(subject)`. The
default `DirectoryStoreBackend` maps to `<root>/<subject>`, keeping that
physical layout out of every pipeline script while preserving the same
`Store` responsibility: binding `(subject, layer, table)` to concrete
Readers/Writers.

The connection factory `connect(db_path, busy_timeout_ms)` lives in
`framework._internal.connection` — the single place connections are configured (ADR-0001),
which Readers, Writers, and the Store all open through. Keeping it in its own
module is the seam that lets the `Store` mint Writers/Readers without a
`store`↔`writers` import cycle. It sets a `busy_timeout` so read-only clients
ride out the single writer's in-place commits instead of erroring, and stays on
the default rollback journal because **WAL is unavailable over a network
share**.

### `Validator` — a fail-fast check at a layer boundary
A `Validator` states an expectation about a feed's data and **raises**
`ValidationError` when the data breaks it. `ValidationError` is one member of the
**`PipelineError`** family (`framework.core`) — the expected, fail-fast failures
a run raises, alongside `CoercionError`, `FreshnessError`, `UnknownPipelineError`,
and `ForEachPipelineError`. A run boundary catches the family with one `except`
and presents it via `format_failure(exc)` — failure kind + message, no traceback;
a genuine bug is *not* a `PipelineError` and keeps its trace. Severity stays a
*builder* decision: an `error` attachment turns the raised `ValidationError` into
an abort, a `warn` attachment logs it and continues.

```python
class Validator(Protocol):
    def validate(self, dataset: Dataset) -> None: ...   # raises on failure
```

These ship now, each reading only the dataset's public shape (so they stay behind
the Dataset seam — ADR-0002); the history-/prior-derived ones take an extra
narrow seam (`RunHistory` / `PriorColumns`) for the run-over-run comparison:

- `ColumnValidator(required_columns)` — every required column is present
  (presence, not dtype).
- `RowCountValidator(minimum=…, maximum=…)` — row count within an inclusive
  `[min, max]`; either bound is optional (`None` leaves that side open). This is
  the *static* floor/ceiling; the **`VolumeAnomalyValidator`** below is its
  history-derived sibling.
- `VolumeAnomalyValidator(history, pipeline, tolerance=…, floor=…)` — the
  **volume-anomaly guardrail** (#54): catches a truncated source export where
  every row is individually valid yet thousands are missing — invisible to
  per-row checks, visible only run-over-run. It derives a baseline from the feed's
  **recent run history** (`history.recent_row_counts(pipeline)` — the median of
  recent runs' read volumes, robust to one prior outlier) rather than a hand-set
  threshold, and trips when the count falls outside `median × (1 ± tolerance)` in
  *either* direction (a collapse or a suspicious explosion). An optional absolute
  `floor` is an independent, **always-on** guard; below `min_history` prior
  *successful* runs the relative band is skipped so first nights don't trip
  spuriously. `history` is any `RunHistory` — the `RunRegistry` is the production
  one. See [`RunRegistry`](#runregistry--the-run-history-that-ingests-the-jsonl).
- `SchemaDriftValidator(prior)` — the **raw-boundary drift detector** (#51):
  warns (it does not abort) when a feed's incoming columns differ from the
  **prior run's landed columns**, catching an owner-controlled source silently
  adding/dropping a column *at the door*, one layer before it would surface as a
  silver **Schema Breach**. The diff is **names-only** and a case-sensitive set
  difference (a rename reads as a drop + an add; order and dtype are not drift —
  dtype is silver's job, ADR-0008). The prior set comes from `prior` — a
  `PriorColumns` seam minted by `store.columns_of(RAW, table)`, which reads the
  live raw table's columns via `PRAGMA` (no rows) and returns `None` for the
  first-ever run, making it a clean no-op. Attach at `severity="warn"`; the
  warning rides `warn_hits` onto the run summary (see drift surfacing under
  [`RunRegistry`](#runregistry--the-run-history-that-ingests-the-jsonl)).

A Validator knows only how to *check*; it does **not** decide what a failure
means. **Severity is set where the Validator is attached to the builder**
(`severity="error" | "warn"`, default `error` — ADR-0007), so the same Validator
can abort one pipeline and merely warn another. These are **engine-agnostic**
(the check reads shape only; `SchemaDriftValidator`'s `PriorColumns` seam reads
the prior table via stdlib `sqlite3`, never pandas); the richer `SchemaValidator`
below is the *engine-confined* kind.

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
- each `Annotated[..., NonNull()]` column contains no null values. Plain fields
  and `Annotated[..., Nullable()]` fields are nullable by default; value rules
  still check only present values.

Every breach is reported at once in one **located** message naming the column
and the expected-vs-actual type, then raised as `ValidationError`. A type the
adapter cannot map is a configuration error caught **when the validator is
built**, not mid-run. Postponed (string) annotations from
`from __future__ import annotations` are resolved via `typing.get_type_hints`.
Nullability and value-level rules (format / length / uniqueness / encoding)
extend the same dataclass through `typing.Annotated`.

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
The implementation home is `framework.recipes`; `framework.run` re-exports the
recipe for compatibility with existing pipeline code.

### `Processor` — an engine-confined transform, run mid-pipeline
A `Processor` transforms the dataset between the read and the post-validators:

```python
# Transforms are now standard callables.
# e.g. Callable[[Dataset], Dataset]
```

Unlike the structural validators it is **engine-confined** — a transform needs
the engine's vectorised operations, so it reaches the frame via
`to_pandas()`/`from_pandas()` exactly as a Reader/Writer does (ADR-0002). It is
attached with `.transform(...)` and runs as the builder's `process` step. A
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
  (ADR-0002); applied row-wise behind the seam. For Selection business rules,
  prefer named pure helper functions over inline lambdas, pass `name=` to gates
  that can exclude a Case, and test predicates/scorers directly with small row
  mappings before wiring them into a Pipeline.
- `VectorizedFilter(predicate)` / `VectorizedDerive(column, derive)` — receive
  the whole backing frame once for batch-friendly filtering and column
  derivation. Use them for natural whole-column expressions on large feeds; keep
  row-callable `Filter` / `Score` for one-Case-at-a-time rules that should stay
  engine-agnostic at the callable boundary.
- `Sort(by, ascending=True)` — order rows (`by` a column or sequence; index
  reset so the output reads positionally clean) for a meaningful "top N".
- `Rename({old: new})` — align column vocabulary (e.g. agree a key name before a
  join); unnamed columns pass through.
- `Stamp(column, value)` — write one constant column (the run-level
  `question_bank_id` a Variation resolves), even onto an empty feed (#11).
- `JoinDependency(name, source)` / `JoinWith(other, on=..., how="inner")` /
  `AntiJoinWith(other, on=...)` — cross-feed joins and exclusion-list gates.
  `other` is a read-only dependency (`JoinDependency`, `Reader`, or materialized
  `Dataset`), never another pipeline run hidden inside `process()`. Upstream
  execution is owned by runner/catalog code; the builder materializes each named
  dependency once, logs it as `dependency:<name>`, and joins or anti-joins in
  Python.
- `TopNPerGroup(key, by, n, ascending=False, tiebreak="case_id")` /
  `SamplePerGroup(key, n, seed=0, order="case_id")` — reduce each group to at
  most *N* Cases (CONTEXT.md **Sampling**, #62). `TopNPerGroup` is **ranked**
  (`n=1` ⇒ "the single highest available per Adviser"), carrying its own sort and
  a stable `tiebreak` so tied scores rank reproducibly; `SamplePerGroup` is
  **seeded random** — a pure function of (input, `seed`) that is invariant to
  incoming row order (ADR-0010). `Sample(n=None, seed=0, order="case_id", *, fraction=None)`
  is the ungrouped counterpart of `SamplePerGroup` — same seeded, pure,
  order-invariant draw, but over the whole feed rather than per group, sized by
  an absolute `n` **or** a `fraction` of the population (exactly one).
  `TopNPerGroup(key=K, by=B, n=1)` is the
  structural generalisation of the Ingest reduction `LatestPerKey(key=K, by=B)`,
  kept separate by domain (Selection narrowing vs current-state reduction).

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

Every record of a single execution carries the same `run_id`: an execution id
created by ad hoc `.run()` or supplied as `RunContext.execution_id`. Accumulated
rows use the separate `logical_run_id` for idempotency and stamp `execution_id`
for traceability when the writer strategy is context-derived. The record
`timestamp` (the ISO-8601 UTC instant it was emitted) lets the run registry group
and order a run without parsing free text. The builder owns no path or format
knowledge — it just drives the sink; when no `RunLog` is composed a null sink
keeps `.run()` branch-free while emitting nothing. The full record schema, the
per-step breakdown, and the fail-fast/warn examples live in
[`run-log-format.md`](run-log-format.md).

### `RunRegistry` — the run history that ingests the JSONL
A `RunRegistry` is the **consumer** for the `RunLog` JSONL — the seam ADR-0005
named — landed in #52. It ingests the run records into its **own** queryable
SQLite store so operators can answer "did last night's Ingest for Case Type B
succeed, how many rows, did anything warn?" without grepping `.log` files:

```python
registry = RunRegistry("/path/to/share/_registry/runs.db")
registry.ingest("/path/to/share/cases/runs.log")   # idempotent

registry.query_runs(pipeline="cases", status="error")  # narrow by pipeline/status
registry.latest_run_per_pipeline()                     # one row per pipeline
registry.runs_that_warned()                            # tolerated warns (incl. drift)
registry.records_for_run(run_id)                       # every step of one run
registry.recent_row_counts("cases", limit=10)          # read volumes, newest first
```

- **Ingest is idempotent** (AC #3): a record's identity is `run_id` + step (+ a
  step ordinal, because a multi-processor run emits one `process` record per
  processor — a bare `run_id`+step would collide them), so re-reading the same
  log inserts nothing the second time (`INSERT OR IGNORE`).
- **Queryable by `run_id`, pipeline, status, and time.** Ordering is by the
  record `timestamp`; "row counts over time" is `query_runs(pipeline=…)` read in
  order.
- It is a **query store, not a `Dataset` carrier**, so it stays stdlib-only
  (`json` + `sqlite3`) and never names pandas. It opens through the same
  `connect` factory and honours the single-writer / rollback-journal conventions
  (ADR-0001) like any other medallion db; paths are `pathlib` (Windows/macOS).
- **Schema-drift surfaces as a warn-hit** (ADR-0008), so `runs_that_warned()` is
  also the drift-surfacing query (AC #6) — it pairs with the raw-drift detector
  ([`SchemaDriftValidator`](#validator--a-fail-fast-check-at-a-layer-boundary), #51),
  whose warn-severity message rides `warn_hits` onto the run summary.
- **It is also a baseline source.** `recent_row_counts(pipeline, limit=…)` returns
  the read-step volumes of recent *successful* runs, newest first — the history a
  [`VolumeAnomalyValidator`](#validator--a-fail-fast-check-at-a-layer-boundary)
  builds its band over (#54). Only `ok` runs count, so a run the guardrail itself
  tripped can't poison the next night's baseline.

Reading the JSONL needs no change to the emitter (ADR-0007); the one format
addition this slice made is the per-record `timestamp` (run-log-format.md), the
time dimension the registry orders by.

### `PipelineRunner` — thin domain orchestration + freshness guard
`PipelineRunner` (`framework.run.runner`) is the minimal orchestration layer above
the builder. It registers domain Pipelines by `(case_type, pipeline)` and runs
one requested Pipeline by name, without changing the builder contract:

```python
from framework.run import FreshnessRequirement, PipelineRunner

runner = PipelineRunner()
runner.register("cases", "ingest", run_ingest)
runner.register(
    "cases",
    "selection",
    run_selection,
    freshness=(FreshnessRequirement(upstream_pipeline="ingest"),),
)

runner.run("cases", "selection", "/path/to/share", run_date=date(2026, 5, 29))
```

Handlers receive a `RunContext` carrying `base_dir`, `case_type`, `pipeline`,
`run_date`, `load_date`, `execution_id`, `logical_run_id`, the runner-level
`RunLog`, the `RunRegistry`, and `freshness_days`. `execution_id` is the concrete
attempt recorded in RunLog/RunRegistry; `logical_run_id` is the idempotency key a
re-driven business run reuses for accumulated rows. A run's history label is
`<case_type>/<pipeline>` when registered with a subject (the registry /
`orchestrate` path) or the bare `<pipeline>` name when run by path (see below);
metadata is stored under `<base_dir>/_runs/<label-stem>.log` and
`<base_dir>/_registry/`.

`run_pipeline` (`framework.run`) is the execution core `PipelineRunner.run`
delegates to, and the path-addressed `run` command calls directly: given a
handler, a pipeline `name`, an optional `subject`, and an `upstreams` tuple, it
builds the `RunContext`, catches the shared `RunRegistry` up from every
`_runs/*.log` (so an upstream's history is visible regardless of which log
partitioned it), runs the freshness checks, dispatches the handler, and records
the run summary.

`FreshnessRequirement` declares the upstream domain Pipeline a downstream run
needs. The default policy is same-business-date freshness (`max_age_days=0`):
the latest successful upstream `run` summary timestamp must be on or after the
downstream `run_date` minus the allowed age. Failed upstream runs do not count.
No successful upstream history is treated as a first-run skip: the runner allows
the handler and writes a `freshness` record with a warning. Stale history aborts
before the handler executes and writes both a `freshness` error and an errored
domain `run` summary.

The CLI `run` command addresses a pipeline by its location on disk, importing
`pipelines.<name>.pipeline` and running its `run(context)` callable through
`run_pipeline`:

```sh
python -m cli run pipelines/ingest /tmp/demo --run-date 2026-05-29
python -m cli run pipelines/selection /tmp/demo --run-date 2026-05-29
```

### `Orchestrator` — scheduled PipelineSets
`Orchestrator` (`framework.run.orchestration`) sits above `PipelineRunner`. It is
not a builder-level `Pipeline`; it decides which registered domain Pipelines are
due for one run date, invokes them through the runner, and records scheduling
decisions separately from execution history:

```python
from framework.run import (
    FreshnessRequirement,
    Orchestrator,
    PipelineSet,
    ScheduledPipeline,
    Weekdays,
)

sets = (
    PipelineSet(
        "cases",
        (
            ScheduledPipeline("cases", "ingest", Weekdays()),
            ScheduledPipeline(
                "cases",
                "selection",
                Weekdays(),
                depends_on=(FreshnessRequirement("ingest"),),
            ),
        ),
    ),
)

Orchestrator(runner, sets, WorkingDayCalendar()).run_due_once(
    "/path/to/share",
    run_date=date(2026, 5, 29),
)
```

`PipelineSet` is the independent failure boundary, normally one Case Type or one
platform-wide group. `ScheduledPipeline` references an existing runner
registration and carries its default schedule, freshness dependencies, and
enablement. `Weekdays()` is the normal daily schedule, using
`WorkingDayCalendar` for weekends and holidays; other schedules are
`SpecificWeekdays`, `DayOfMonth`, `NthWorkingDayOfMonth`,
`LastWorkingDayOfMonth`, and `ManualOnly`.

Each invocation writes decisions to `<base_dir>/_orchestration/runs.db` with a
stable item key of `set_name/case_type/pipeline/run_date`. `RunLog` and
`RunRegistry` stay reserved for actual Pipeline execution records. A failed
scheduled item is terminal for that orchestrator run and blocks downstream
dependants, but unrelated items in the same set and every other `PipelineSet`
continue. `run_until_complete(...)` performs a bounded Python polling loop over
the same run date; it does not retry failed items from the same invocation.

Python definitions are canonical. YAML overrides may disable a scheduled item,
replace its schedule timing, or override freshness windows for operations
without changing the registered pipeline code.

### `ForEach` — independent per-item builder runs
`ForEach` (`framework.run.orchestration`) is the small runnable orchestration
primitive for repeated runs where each item must stay independent but use the
same recipe. It sits outside the `Pipeline` builder so the builder keeps its
single Reader/single `Dataset`/single Writer contract:

```python
from framework.io import AccumulateByRun
from framework.run import ForEach, Pipeline

def item_run_id(path, index, parent_context):
    return f"{parent_context.logical_run_id}:{path.stem}"

def pipeline_builder(path, context):
    writer = store.writer(
        "gold",
        "selection_pool",
        AccumulateByRun.from_context(context),
    )
    return Pipeline(f"selection:{path.name}", CsvReader(path)).write_to(writer)

ForEach(files, pipeline_builder, logical_run_id=item_run_id).run(context)
```

For every item, the orchestrator creates a per-item `RunContext`, calls
`pipeline_builder(item, context)`, and runs the returned builder. The factory
must return a **fresh** `Pipeline`; the orchestration object never mutates and
reuses one builder across items. By default it derives logical ids as
`<parent logical_run_id>:<index>`; pass `logical_run_id(item, index, context)`
when a file name, source id, or other stable key should drive idempotent
`AccumulateByRun` writes.

The initial behavior is fail-fast. If building or running an item fails,
`ForEachPipelineError` is raised with the failing item in the message and the
original exception preserved as `__cause__`; later items are not run.

When the batch should continue after an item fails, opt in explicitly:

```python
outcomes = ForEach(
    files,
    pipeline_builder,
    logical_run_id=item_run_id,
    continue_on_error=True,
).run(context)

failed = [outcome for outcome in outcomes if outcome.status == "failure"]
```

Best-effort returns one `ForEachOutcome` per item instead of the old success-only
dataset list. Each outcome includes the original `item`, `index`,
`logical_run_id`, `status` (`"success"` or `"failure"`), the successful
`dataset`, or the original `exception` for caller inspection/logging. The outer
orchestrator owns only the continue/stop policy; each individual
`Pipeline.run()` remains fail-fast and atomic, and each Writer keeps its own
transaction/idempotency behavior.

Best-effort can leave a batch partially complete by design. Use stable per-item
logical run ids when items write with `AccumulateByRun`; a retry can then
replace the failed item's logical slice, while already-successful item slices
remain independently addressable.

Use `ForEach` when each file is a separate logical run, needs its own
run/logical identity, or should fail independently. Use a multi-file Reader
instead when many files together are one logical Feed snapshot that should be
read, validated, and written as a single `Dataset` under one logical run id.

### `Pipeline` — the deferred DAG builder
A `Pipeline` describes a feed's path and runs **nothing** until `.run()`
(ADR-0003):

```python
p = Pipeline("cases")
r = p.read(CsvReader(path), name="read")
v1 = p.validate(ColumnValidator(["case_ref"]), r, name="pre_val") # gate the input
t1 = p.transform(NormaliseCases(), v1, name="transform")         # transform
v2 = p.validate(RowCountValidator(minimum=1), t1, name="post_val") # gate the output
p.write(writer, v2, name="write")
p.run()
```

For position-sensitive checks and transforms, compose explicit ordered stages:

```python
pipeline = (
    Pipeline("cases", CsvReader(path))
    .add_stage(
        ValidationStage(
            name="Validate file shape",
            validators=[ColumnValidator(["case_ref"])],
        )
    )
    .add_stage(
        ProcessingStage(
            name="Normalise cases",
            processors=[NormaliseCases()],
        )
    )
    .add_stage(
        ValidationStage(
            name="Validate normalised cases",
            validators=[RowCountValidator(minimum=1)],
        )
    )
    .write_to(writer)
)
```

The built-in stages are the **authoring vocabulary** for positioned operations
inside one class-level `Pipeline` run, composed via `.add_stage(...)`:
`ValidationStage` (one or more validators, with the same `error`/`warn` severity
behavior as validator helpers), `ProcessingStage` (one or more processors,
preserving row trace/explain observations), and `CheckpointStage` (an explicit
side-effect stage that writes a snapshot and passes the same dataset onward).
Each stage is a **spec, not an executor**: it compiles to one internal
`PipelineStep` (via `to_pipeline_step()`) that `.run()` executes and `.describe()`
renders, so a stage's behaviour and its plan can't drift and there is no second
execution path (ADR-0003 amendment). There is no public custom-`Stage` contract;
the dataset→dataset transform extension point is the `Processor`. This is not a
domain Pipeline, medallion layer, DAG, or multi-writer terminus; the invariant
remains: `Reader -> Dataset -> Stage* -> Writer`.

`.validate(v, severity="error")` attaches a **pre**-validator (checks the
input); `.validate(v, severity="error")` attaches a **post**-validator
(checks the output that is about to be written). `.transform(p)` and
`.checkpoint(writer)` remain compatibility helpers over the ordered stage chain.
`.write_to(writer)` composes in the destination Writer. All deferred — nothing
runs until `.run()`.

Call `.describe()` before `.run()` to inspect the plan while authoring or
debugging. The output is a **flat, plan-ordered list**: one line per step, in
the order `.run()` will execute them. Empty steps (e.g. no validators attached)
are omitted entirely — there are no `none` placeholders. Each step renders its
own entry via its `plan_entry()` method, so adding a new step kind touches one
place and `describe()` requires no changes.

Each component renders its own summary through the opt-in `describe()` protocol
(#145): a component implements `describe() -> str` to surface the config it
chooses (the framework readers/writers/validators/processors/`RunLog` do,
self-redacting any credentials — e.g. `SharePointReader` strips `user:pass@`
from its site URL and never shows `auth`). A component without `describe()` is
shown by bare class name only; the builder never introspects a component's
attributes, so a value stored under any name cannot leak into the plan:

```python
pipeline = (
    Pipeline("cases", CsvReader(path))
    .validate(ColumnValidator(["case_ref"]))
    .transform(NormaliseCases())
    .write_to(writer)
)

print(pipeline.describe())
```

`.run()` is the terminus and is **fail-fast and atomic** (ADR-0007): it executes
that ordered internal plan — read, pre-validate, optional quarantine,
stages in attach order, post-validate, optional explain write, and final write —
then returns the bulk-tier `Dataset`.

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
terminus owns execution, it is the home of the cross-cutting concerns: it uses
the supplied `RunContext` or creates one for ad hoc runs, exposes the execution
id as `pipeline.run_id`, times each planned step, and drives the composed
`RunLog` (timing + structured JSONL logging — landed in #4). The planned step
objects are internal: they expose stable name/kind/order, the wrapped component
where applicable, and read-only/side-effect metadata for future plan-validation
and dry-run work, but pipeline scripts still use only the builder methods. The
`process` step (`.transform()`) landed in #23; lineage checkpoints
(`.checkpoint(writer)`) landed in #49; public ordered stages landed in #122.

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

## The case-review application/domain layer (#11)

Above the generic framework primitives sits the thin **case-review application
layer**: the declarative Case Type objects and the `CasePool` that reads the
ingested silver, surfaced through intention-revealing retrievals instead of raw
`pandas.read_*` calls. These helpers live in the `case_review` package; new
case-review concepts belong there (or in pipeline support modules), not under
`framework/`. The full flow lives in [`selection.md`](selection.md); in brief:

### `CaseType` / `Variation` — the declarative domain objects
A `CaseType` (`case_review.case_type`) bundles a Case Type's `schema`, its
identity contract, and its `variations`, imported directly — no global CaseType
config registry (ADR-0005). The identity contract is the `natural_key` (the
column(s) that identify a Case) plus a `namespace` property derived from `name`;
the gold builders read both off the Case Type to mint the deterministic `case_id`
(ADR-0009). `CaseType.variation(id)` resolves a `Variation` (its `question_bank_id`
+ later overrides) and raises a located `KeyError` on an unknown id. Declarative
data, not code (one Case Type has many Variations — `CONTEXT.md`).

### `CasePool` — the domain population, behind named reads
`CasePool(case_type, store, calendar)` (`case_review.case_pool`) is the
per-Case-Type population of Cases read from the **ingested silver**. Its headline
retrieval is the *concept* of fetching **available cases** — e.g.
`fetch_available_cases(as_of, activity_column=…, within_working_days=…)` narrows
to a `WorkingDayCalendar` window in Python (ADR-0002), repairing silver's
text-stored dates first, and returns a bulk-tier `Dataset`. Fully typed `Case`
objects are the typed-on-demand edge reserved for a later slice (ADR-0002).

### `DatasetReader` — bridge an in-memory Dataset into the builder
`DatasetReader(dataset)` (`framework.io.readers`) adapts an already-in-memory
`Dataset` to the `Reader` shape, so the **Selection** pipeline feeds the
CasePool's available cases straight into the `Pipeline` builder (read → process →
write) without a SQL round-trip. Selection is its own pipeline that reuses the
builder, narrowing the CasePool with the Selection processors and `Stamp` into
the gold `SelectionPool`.

### `RetryPolicy` / `RetryingReader` / `RetryingWriter` — retry at the I/O edge
`RetryPolicy(attempts, retry_on, backoff_seconds=…)` (`framework.shared.retry`) encodes
a retry decision as an **allowlist** of transient exception types; only those are
retried, so schema-validation and configuration errors abort immediately.
`RetryingReader(inner, policy)` / `RetryingWriter(inner, policy)` apply it at the
`read()` / `write()` seam — retry stays scoped to the edge, never wrapping
validation or business rules (which live in the stages, not the seam). A remote
client can also call through `policy.call(...)` directly. Retried attempts are
recorded on the same `read`/`write` run-log record (as `warn_hits`) whose status
carries the final outcome. Full treatment: [retry.md](retry.md).

## Worked example

```python
from framework.core import RAW
from framework.io import CsvReader, Refresh, StoreCatalog
from framework.run import Pipeline

store = StoreCatalog("/path/to/share").store("cases")
landed = (
    Pipeline("cases", CsvReader("feed.csv"))
    .write_to(store.writer(RAW, "cases", Refresh()))
    .run()
)
print(len(landed), landed.columns)
```

See [`../pipelines/demo_csv_to_raw.py`](../pipelines/demo_csv_to_raw.py) for the
runnable demo.
