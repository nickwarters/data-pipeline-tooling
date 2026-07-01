# Core primitives & the medallion profile

This is the framework's foundational vocabulary — the primitives every pipeline
names. The pieces are: `Dataset` (the opaque carrier), `Reader` / `Writer`
(source and sink IO), `Validator` and the declared-schema contract
(`SchemaValidator`, value rules), the transforms (`SchemaCoercion`, `Filter` /
`Score` / `JoinWith` and the Ingest reshapers), and the deferred `Pipeline` DAG
builder with its `RunLog` observability. **Where** a feed lands is *not* framework
vocabulary (#232): `framework.io` knows only the `Reader` / `Writer` ports and the
load strategies. The namespace → file `Store` / `StoreRegistry` and the
raw/silver/gold **medallion** profile over it are **application infrastructure**
in the sibling `tools` package (`tools.store`, `tools.medallion`). For the *why*
behind each, see the ADRs referenced inline; for domain language (Case, CasePool,
Feed, Reference Data, …) see [`../CONTEXT.md`](../CONTEXT.md).

Application code (`pipelines/` + the `case_review/` domain layer) imports these
primitives through the public facades (`framework.core` / `framework.io` /
`framework.transform` / `framework.run`), not the home modules named per-primitive
below; the home modules locate the code, the facades are the stable contract. The
package root exposes only those four facade modules for discovery (`framework.core`,
`framework.io`, `framework.transform`, `framework.run`); it does not re-export
primitive classes directly. The cross-cutting `retry` / `calendar` /
orchestration / observability utilities live in the sibling top-level `tools`
package, not a facade. See [`public-api.md`](public-api.md).

## The namespace Store and the medallion profile

The framework's storage contract is the `Reader`/`Writer` ports + load strategies
+ the `connect` seam. `Store` / `StoreRegistry` (in `tools.store`, **application
infrastructure** — the run engine never references it) addresses an opaque
**`namespace`** — a *logical database*, one SQLite file holding many related
tables — and mints Readers/Writers over the tables in it. `StoreRegistry` also
**registers named components**: `register(name, reader|writer)` then
`reader(name)` / `writer(name)`, so a pipeline can refer to a component by name
rather than re-deriving it. A normalised schema can span several namespaces (one
database per namespace, related tables in each; cross-database joins stay in
Python — ADR-0002).

The raw/silver/gold **medallion** is an application-level *profile* layered on
top by `tools.medallion`, **not** a framework enum. `medallion(registry, subject)`
exposes three namespace Stores — `.raw` / `.silver` / `.gold` — for one subject,
mapping to that subject's own files `<subject>/{raw,silver,gold}.db` on a network
share. Each **subject** — a Case Type or a shared Reference Data set — owns its
**own** medallion, isolated from every other subject's files (ADR-0001:
blast-radius isolation, independent onboarding). A Feed is ingested and refined
upward; the Selection pipeline reads the ingested silver/gold and writes the
SelectionPool back into gold. (The layer names are placeholders pending a domain
rename — see CONTEXT.)

| Layer  | Holds                                  | Load behaviour |
|--------|----------------------------------------|----------------|
| **raw** | A faithful, schema-light snapshot of the source as landed — the framework's landing zone. | **Full refresh** each run: truncate + reload from the source snapshot, so re-runs are deterministic (ADR-0004). |
| silver | Validated, normalised data: the **schema boundary** — a Case Type's declared columns + dtypes are enforced here as a post-validator before the data lands (ADR-0006). Normalising *coercion* (parsing dates, casting booleans) runs as a transform step ahead of that check. | Full refresh from raw. |
| gold   | Refined ingest outputs **and** the accumulating SelectionPool / Review Outcomes. A gold hop composes an explicit `Pipeline` whose Writer carries the load strategy. | **Current-only** (ingest gold: `Refresh`, one row per Case) **or accumulating** (Selection / Sync: `AccumulateByRun`, stamped with `logical_run_id` / `load_date` and, when context-driven, `pipeline_run_id`; idempotent re-run via delete-by-logical-run then insert — ADR-0004; [gold-accumulation doc](gold-accumulation.md)). |

raw stays schema-light on purpose: it mirrors the source so the landing zone is
faithful, and schema enforcement arrives at silver and gold (ADR-0006).

> **Load strategies are explicit.** The Store maps `namespace → file` only; each
> Writer owns its load strategy. Callers choose `Refresh()`,
> `AccumulateByRun(logical_run_id, load_date)`,
> `AccumulateByRun.from_context(context)`, `UpsertStrategy(key_columns)`,
> `InsertOrIgnore()`, or `InsertIfAbsent(key_columns)` when asking the Store
> for a Writer. This supports both current-state hops and accumulated histories
> without baking a universal layer→strategy rule into the Store (ADR-0004,
> ADR-0009).

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
*other* tier, materialised on demand at the domain edge (the CasePool).

`to_pandas()` returns a **copy** by default, enforcing the opacity guarantee:
callers cannot mutate the carrier's backing frame. Use `to_pandas(copy=False)`
only in hot paths where the caller guarantees it will not mutate the frame.

### `Reader` — source IO behind one method
A `Reader` encapsulates how one source type is read:

```python
class Reader(Protocol):
    def read(self) -> Dataset: ...
```

`CsvReader(path)` reads one source CSV file (pandas behind the seam, with its
type inference). `StrictCsvReader(path)` reads one source CSV file too, but
parses it **character by character** through a hand-written RFC 4180 state
machine for feeds that honour the CSV grammar yet trip pandas / the stdlib
`csv` module — a quoted field containing the delimiter, an embedded newline, or
the quote character itself written doubled (`""`). For the dialect that escapes
an inner quote with a preceding character instead of doubling it, pass
`escapechar` (e.g. `StrictCsvReader(path, escapechar="\\")` for `\"`): the
escapechar then strips the special meaning of the character that follows it and
quote-doubling is off. It accepts `CR`/`LF`/`CRLF`
record endings (preserving line breaks *inside* quoted fields verbatim),
tolerates a BOM, lands every value as faithful **text** (no type inference —
dtype decisions stay with silver's `SchemaCoercion`), and raises a located
`StrictCsvParseError` on a ragged record or an unterminated quote — the *strict*
in the name. `GlobCsvReader(directory, pattern)`
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
seam in `tools.integrations.remote` (ADR-0012, ADR-0011); see
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

#### `ChunkReader` — streaming a source too big to hold whole

`read() -> Dataset` lands a whole source in memory at once — right for a
feed-sized file, impossible for a multi-hundred-GB extract. `ChunkReader` is the
**streaming dual**: `chunks(size) -> Iterator[Dataset]` yields a lazy sequence
of *bounded* Datasets, so the in-memory contract (ADR-0002) holds **per chunk**,
never for the whole source. The concrete chunking engine (pandas `chunksize`)
stays behind the `Dataset` seam exactly as `read()` keeps pandas behind it.

```python
class ChunkReader(Protocol):
    def chunks(self, size: int = DEFAULT_CHUNK_SIZE) -> Iterator[Dataset]: ...
```

`ChunkedCsvReader(path, columns=...)` streams a local CSV via pandas
`read_csv(chunksize=…)`. `SasFileReader(path, columns=..., format=...)` streams
an **already-landed** `.sas7bdat`/xport file via pandas `read_sas(chunksize=…)`;
a gzipped extract (`extract.sas7bdat.gz`) is read on the fly (compression
inferred from the extension), and the SAS format is inferred from the extension
— ignoring any trailing `.gz` — unless `format=` is passed. Reading
sas7bdat/xport needs **no extra dependency** (pandas' SAS reader is pure-Python),
so it is first-class on Windows and macOS alike.

`SasFileReader` is deliberately **not** the ADR-0012 `SasReader`: it runs no SAS
script, does no remote execution, and copies no file — it only *reads* a file
already on local disk. The two are complementary — `SasReader` *lands* a file
from a remote SAS host (see the source-type table below); `SasFileReader` is one
way to *read* a landed file once it is there — and the distinct name keeps them
from being confused.

The chunk size is configurable and defaults to `DEFAULT_CHUNK_SIZE` (10,000
rows). `columns=[...]` projects each chunk so a caller streaming a wide source
for just a couple of columns keeps every chunk narrow (CSV pushes it into
`usecols`; SAS slices each chunk, since `read_sas` has no projection). A source
with no data rows (a header-only CSV, an empty file, a zero-row SAS table)
streams as **zero** chunks; a small non-empty source as exactly **one**. These
readers expose `chunks()`, not `read()`, so they sit *beside* the single-shot
`Reader` set rather than wiring into the deferred `Pipeline` builder — the
streaming consumers (e.g. a monthly projection that appends each chunk to an
indexed silver table) compose on top of them.

**Chunk-level row filtering (allow-list / predicate pushdown).** When a source
is enormous (100M+ rows) but only a small, known subset is wanted (e.g. <100K
ids we already track), filtering *after* a whole read is impossible — the rows
can never be materialised at once. The filter has to be **pushed down into the
per-chunk loop**, beside where column projection already happens, so both memory
*and* the landed table stay bounded. Two wrappers over any `ChunkReader` provide
this (#287):

- `KeyFilterChunkReader(inner, key_column, allowed_keys)` — the id-membership
  (**semi-join**) case: keep only rows whose `key_column` is in `allowed_keys`,
  a known set of ids-of-interest. The set grows run-over-run but is bounded
  (~100K), so it stays an in-memory `set` / `frozenset` for a cheap per-chunk
  membership test; pass the current set in each run. Keys are **normalised on
  both sides** before the test (see below), so a SAS numeric id (`3.0`) matches
  an `int` allow-list entry (`3`) and a space-padded `bytes` id (`b'A  '`)
  matches a `str` entry (`"A"`) rather than a float-vs-int / bytes-vs-str
  mismatch silently dropping every row.
- `PredicateChunkReader(inner, predicate)` — the general form
  `KeyFilterChunkReader` is built on: apply any `ChunkFilter`
  (`Callable[[Dataset], Dataset]`) per chunk.

Because the filter runs **per chunk, before concatenation**, a 100M-row source
with a 100K allow-list lands ~100K rows with memory bounded by one chunk. A
chunk the filter empties yields **nothing** (consistent with the zero-row-chunk
skip), and both wrappers expose `rows_scanned` / `rows_kept` for the most recent
`chunks()` pass so a run can report how much of the source it actually needed
(ties to the run-observability work). They wrap and compose with
`ChunkedCsvReader` / `SasFileReader` / any future chunk reader, keeping the
readers themselves single-purpose.

Because a `ChunkReader` can't wire into the single-shot deferred `Pipeline`
builder (a source too big to hold whole is never one `Dataset`), a streaming feed
runs as a `pipelines/<feed>/` module that loops the chunks itself.
`tools.observability.stream_step` drives that loop — read→filter→write — under a
single fail-fast run-log step, recording `rows_in`/`rows_out`/`rows_excluded`. See
[`streaming-large-sources.md`](streaming-large-sources.md) for the full pattern.

**Table and column names you configure** (the `table` and `columns=[...]` you pass
to a `SqliteReader`/Writer) accept **any string** — spaces, hyphens, mixed case,
and SQL reserved words are all fine. Every identifier is double-quoted at the
SQLite seam through the single `framework.io.sql.quote_identifier` choke point, so
the name is preserved verbatim (case included) and can never break out of the
statement or inject SQL. Values such as `logical_run_id` are passed as bound parameters,
never interpolated. There is no separate "valid identifier" rule to learn: name a
table or column whatever the source calls it.

#### Source type coverage

The Reader/Writer set is symmetric where the framework supports both inbound
Feeds and outbound Deliverables for a source type. Intentionally absent
directions are explicit:

| Source type | Reader | Writer | Notes |
|-------------|--------|--------|-------|
| CSV file | `CsvReader`, `StrictCsvReader`, `GlobCsvReader` | `CsvWriter` | `CsvWriter(path, strategy)` emits one CSV file; `StrictCsvReader` is the char-by-char RFC 4180 parser for grammar-correct feeds that defeat pandas; `GlobCsvReader` is read-only because many inbound files together form one logical snapshot. |
| Excel file | `ExcelReader` | `ExcelWriter` | Both target one worksheet (`sheet=...`). |
| JSON file | _intentionally absent_ | `JsonWriter` | JSON is currently a Reporting Deliverable format only; no inbound JSON Feed has been needed yet. |
| SQLite table | `SqliteReader` | `SqliteTruncateReloadWriter`, `AccumulateByRunWriter`, `SqliteUpsertWriter`, `SqliteInsertOrIgnoreWriter`, `SqliteInsertIfAbsentWriter` | The Store mints these over medallion layer databases. |
| SAS extract (remote) | `SasReader` | _intentionally absent_ | SAS is an inbound-only remote source; the framework lands the remote output then reads local CSV files. |
| Large source, streamed | `ChunkedCsvReader`, `SasFileReader` | _intentionally absent_ | The `ChunkReader` seam (`chunks(size) -> Iterator[Dataset]`) for sources too big to hold whole — a local CSV or an **already-landed** `.sas7bdat`/xport file (incl. gzipped). Distinct from the remote `SasReader`: no script, no remote run, no copy — read-only by nature. |
| SharePoint list | `SharePointReader` | `SharePointWriter` | Target is **SE on-prem**. Both sides are stubbed behind swappable `SharePointFetcher` / `SharePointPusher` seams until the on-prem SE client (NTLM/Kerberos/REST) lands. `SharePointWriter` emits the canonical Selection Deliverable — one list per Case Type. |
| Console (stdout) | _intentionally absent_ | `StdoutWriter` | A terminal sink for *seeing* a result rather than persisting it — e.g. printing a Selection explainer's per-Case trace while driving a feed by hand. Owns no location or load strategy; prints the dataset as a plain-text table to the stream (defaulting to `sys.stdout`). |

### `Writer` — the destination, behind one method
A `Writer` is the component-role **dual of `Reader`**: a Reader brings data in,
a Writer takes it out (ADR-0003).

```python
class Writer(Protocol):
    def write(self, dataset: Dataset) -> None: ...
```

A Writer owns **both** its target location (a layer db file + table, or a file
Deliverable path) **and** its load strategy (ADR-0004). Swapping the Writer is
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
- `AccumulateByRunWriter(db_path, table, logical_run_id, load_date, pipeline_run_id=None)` —
  **accumulate by logical run** for gold: stamps each row `logical_run_id`,
  `load_date`, and optional `pipeline_run_id`. `logical_run_id` is the
  idempotency key; `pipeline_run_id` is the trace key that matches
  RunLog/RunRegistry when the strategy is derived from a `RunContext`.
  A re-driven run is idempotent via *delete-by-logical-run then insert*. Minted by
  `med.gold.writer(table, AccumulateByRun(...))` (see
  [gold-accumulation doc](gold-accumulation.md)).
- `SqliteUpsertWriter(db_path, table, key_columns)` — **update-or-insert** by a
  declared key set: for each incoming row whose key already exists in the
  target the row is replaced; new keys are inserted; target rows whose key is
  absent from the incoming batch are preserved. The merge is a single atomic
  transaction. Minted by `store.writer(table, UpsertStrategy(...))`.
  Useful for a table that holds the **current state of a keyed entity**, e.g.
  `active_cases` keyed on `case_id`.
- `SqliteInsertOrIgnoreWriter(db_path, table)` — **insert-or-ignore**: appends
  incoming rows and silently discards any row that would violate an existing
  constraint (PRIMARY KEY, UNIQUE, NOT NULL, CHECK) on the target table.
  Rows that do not conflict are appended; target rows absent from the batch are
  never touched. Conflict resolution is driven by the table's own constraints —
  when the table carries no constraints the behaviour is equivalent to a plain
  append. Minted by `store.writer(table, InsertOrIgnore())`.
- `SqliteInsertIfAbsentWriter(db_path, table, key_columns, surrogate_column="id")` —
  **reference/dimension load**: on each write, checks which natural keys are
  already present in the target, mints compact integer surrogates in Python
  for new keys (next int above the current max), and inserts only those rows.
  Existing rows are never modified or deleted; re-running the same input is a
  no-op (the reference table is a stable system of record). The surrogate is
  minted above the store seam — not delegated to SQLite `AUTOINCREMENT` —
  so identity logic stays in Python (ADR-0002). This is distinct from
  `InsertOrIgnore`: conflict resolution here is key-driven (the strategy
  declares `key_columns`), not constraint-driven (no table constraints are
  required). Minted by `Store.writer(layer, table, InsertIfAbsent(key_columns))`.

The file Writers accept `Refresh()`, `AccumulateByRun(...)`, and `InsertOrIgnore()`
strategies: `Refresh()` overwrites the file; `AccumulateByRun(...)` reads any
existing file, replaces rows for that logical run, stamps the new rows, and
rewrites the file; `InsertOrIgnore()` appends incoming rows to the existing file
(files carry no table constraints, so no rows are ignored — equivalent to a plain
append). Round-tripping through matching Readers is stable for CSV and Excel at
the Dataset shape level; exact pandas dtype inference can still differ after a
file round-trip, so schema-sensitive flows should continue to validate after
reading.

### `Store` / `StoreRegistry` — a namespace → file factory
`Store` / `StoreRegistry` live in `tools.store` — **application infrastructure**,
a sibling `tools` utility, not framework vocabulary (#232). `framework.io` knows
only the `Reader` / `Writer` ports and the load strategies; *where* those ports
read and write is an application concern.

`Store(db_path, *, namespace=None, busy_timeout_ms=5000)` is the mouth of **one
namespace** — a logical database, one SQLite file holding many related tables. It
holds **no business logic** (ADR-0002) and makes **no** load decision (ADR-0003)
— it merely mints components over the tables in its file:

- `store.writer(table, strategy)` — mints a Writer over a table in this namespace
  using the caller's explicit `Refresh()`, `AccumulateByRun(...)`,
  `UpsertStrategy(...)`, `InsertOrIgnore()`, or `InsertIfAbsent(key_columns)`
  strategy. Context-driven accumulation uses `AccumulateByRun.from_context(context)`.
- `store.reader(table)` — a `SqliteReader` over the same file.

The strategy lives on the Writer the store mints, not on the store. The
namespace's file (and its parent directories) is created on first write, so
onboarding migrates nothing.

`StoreRegistry(root, backend=..., busy_timeout_ms=5000)` owns shared
configuration and plays **two roles**. As a *namespace factory* it mints stores
with `registry.store(namespace)`; the default `DirectoryStoreBackend` maps a
namespace to `<root>/<namespace>.db`, nesting on a `/` in the namespace (so the
medallion's `<subject>/silver` → `<root>/<subject>/silver.db`), keeping physical
layout out of every pipeline script. As a *named registry* it holds components a
pipeline references by name: `registry.register(name, reader|writer)` records a
Reader or Writer (classified by its `read()` / `write()` port and returned for
one-line use), and `registry.reader(name)` / `registry.writer(name)` fetch the
exact object back — handing the framework `Pipeline` the same concrete component
it would otherwise wire by hand.

The **medallion profile** (`tools.medallion.medallion(registry, subject)`) layers
raw/silver/gold over this: it mints three namespace Stores — `med.raw` /
`med.silver` / `med.gold` — for one subject, each a `Store` over
`<subject>/<layer>.db`, isolated per subject (ADR-0001). Reference Data sets are
subjects too; a Case Type reads another subject's namespace through a `Reader`
and joins in Python (ADR-0002), so splitting files costs nothing on the join
path.

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
  **volume-anomaly guardrail**: catches a truncated source export where
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
- `SchemaDriftValidator(prior)` — the **raw-boundary drift detector**:
  warns (it does not abort) when a feed's incoming columns differ from the
  **prior run's landed columns**, catching an owner-controlled source silently
  adding/dropping a column *at the door*, one layer before it would surface as a
  silver **Schema Breach**. The diff is **names-only** and a case-sensitive set
  difference (a rename reads as a drop + an add; order and dtype are not drift —
  dtype is silver's job, ADR-0006). The prior set comes from `prior` — a
  `PriorColumns` seam minted by `med.raw.columns_of(table)`, which reads the
  live raw table's columns via `PRAGMA` (no rows) and returns `None` for the
  first-ever run, making it a clean no-op. Attach at `severity="warn"`; the
  warning rides `warn_hits` onto the run summary (see drift surfacing under
  [`RunRegistry`](#runregistry--the-run-history-that-ingests-the-jsonl)).

A Validator knows only how to *check*; it does **not** decide what a failure
means. **Severity is set where the Validator is attached to the builder**
(`severity="error" | "warn"`, default `error` — ADR-0005), so the same Validator
can abort one pipeline and merely warn another. These are **engine-agnostic**
(the check reads shape only; `SchemaDriftValidator`'s `PriorColumns` seam reads
the prior table via stdlib `sqlite3`, never pandas); the richer `SchemaValidator`
below is the *engine-confined* kind.

### `Schema` & `SchemaValidator` — the declared contract, enforced at silver
A Case Type's **`Schema`** is an ordinary **dataclass** whose annotations *are*
the contract — each field is a column name and its declared Python type, the
single source of truth (ADR-0006):

```python
@dataclass
class CaseA:
    case_ref: str
    opened: date
    active: bool
```

`SchemaValidator(CaseA)` is the **dataclass→validator adapter** (the seam to
dataclass→Pydantic later, ADR-0011). It is a `Validator` of the same shape as
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

### Schema enforcement at the silver boundary
There is no recipe builder for this; the raw→silver hop composes the primitives
**explicitly** onto a `Pipeline` — read the subject's raw, coerce, validate, write
silver — so the ADR-0006 convention is visible in the pipeline like any other hop:

```python
p = Pipeline("cases")
raw = p.read(med.raw.reader("cases"), name="read")
coerced = p.task("coerce", SchemaCoercion(CaseA), raw)
validated = p.validate(SchemaValidator(CaseA), coerced, name="post-validate")
p.write(med.silver.writer("cases", Refresh()), validated, name="write")
p.run()   # coerces, validates, then writes silver.db
```

A breach aborts at the silver boundary **before** silver is written (fail-fast
and atomic — ADR-0005), so nothing partial lands. Raw stays schema-light: data
the schema would reject still lands faithfully in raw. The pipeline makes no
write or load decisions — the Store mints the Writer, which owns location +
strategy. Full walkthrough: [schema-enforcement.md](schema-enforcement.md).

### `Processor` — an engine-confined transform, run mid-pipeline
A `Processor` transforms data between the read and the post-validators. The
builder wires it to one or more upstream nodes and calls it with their datasets,
so a processor takes **one or more `Dataset`s and returns exactly one** — a
single-input reshape, or a fan-in (e.g. an in-DAG join) over several branches:

```python
# Transforms are standard callables: one or more Datasets in, one Dataset out.
# Processor = Callable[..., Dataset]
```

Unlike the structural validators it is **engine-confined** — a transform needs
the engine's vectorised operations, so it reaches the frame via
`to_pandas()`/`from_pandas()` exactly as a Reader/Writer does (ADR-0002). It is
attached with `.task(name, processor, ...)` and runs as a named task. The older
`.transform(processor, ..., name=...)` spelling remains supported and uses the
same execution path. A
processor has **no severity**: a transform either applies or it can't, so a
failure is always fail-fast (ADR-0005) — it raises and the run aborts.

Two families of concrete processor ship now.

**Schema coercion.** `SchemaCoercion(schema)` — the write-side companion of
`SchemaValidator`, derived from the same Case Type dataclass. Where the validator
*checks* dtypes, the coercer *repairs* the representation raw loses to storage,
casting only the round-trip-lossy declared types — `date`/`datetime` (landed as
text) and `bool` (`TRUE`/`FALSE` text or `1`/`0`). `str`/`int`/`float` survive a
SQLite round-trip, so they pass through untouched and stay the validator's gate;
undeclared columns are left alone. A value it cannot cast (an unparseable date,
an unknown boolean encoding) raises a **`CoercionError`** with one located
message naming the column. The raw→silver hop composes it ahead of the
`SchemaValidator`, so the per-run order is **read → coerce (transform) →
post-validate (schema) → write** (ADR-0006).

**Selection transforms** — the `filter/score/sort/join` of `CONTEXT.md`:

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
  `question_bank_id` a Variation resolves), even onto an empty feed.
- `JoinDependency(name, source)` / `JoinWith(other, on=..., how="inner")` /
  `AntiJoinWith(other, on=...)` — cross-feed joins and exclusion-list gates.
  `other` is a read-only dependency (`JoinDependency`, `Reader`, or materialized
  `Dataset`), never another pipeline run hidden inside `process()`. Upstream
  execution is owned by runner/catalog code; the builder materializes each named
  dependency once, logs it as `dependency:<name>`, and joins or anti-joins in
  Python.

Full walkthrough + worked example: [processors.md](processors.md).

### `RunLog` — structured JSONL run observability
A `RunLog` is the observability seam (ADR-0005). Composed onto the builder
(`Pipeline(name, run_log=RunLog(path))`), it emits **one JSON object per
line** to a `.log` file — and a human-readable line per record to the console —
for each step of a run plus a final `run` summary:

```python
class RunLog:
    def record(self, pipeline_run_id, pipeline, step, status, *,
               logical_run_id=None, rows_in=None, rows_out=None, duration=None,
               errors=None, warn_hits=None) -> None: ...
    def step(self, pipeline_run_id, pipeline, step, rows_in=None,
             logical_run_id=None): ...  # times a block
```

Every record of a single execution carries the same `pipeline_run_id`: the
attempt id created by ad hoc `.run()` or supplied as `RunContext.pipeline_run_id`,
plus the `logical_run_id` of the business run it belongs to. Accumulated rows use
`logical_run_id` for idempotency and stamp `pipeline_run_id` for traceability when
the writer strategy is context-derived. The record
`timestamp` (the ISO-8601 UTC instant it was emitted) lets the run registry group
and order a run without parsing free text. The builder owns no path or format
knowledge — it just drives the sink; when no `RunLog` is composed a null sink
keeps `.run()` branch-free while emitting nothing. The full record schema, the
per-step breakdown, and the fail-fast/warn examples live in
[`run-log-format.md`](run-log-format.md).

### `RunRegistry` — the run history that ingests the JSONL
A `RunRegistry` is the **consumer** for the `RunLog` JSONL — the seam ADR-0011
names. It ingests the run records into its **own** queryable
SQLite store so operators can answer "did last night's Ingest for Case Type B
succeed, how many rows, did anything warn?" without grepping `.log` files:

```python
registry = RunRegistry("/path/to/share/_registry/runs.db")
registry.ingest("/path/to/share/cases/runs.log")   # idempotent

registry.query_runs(pipeline="cases", status="error")  # narrow by pipeline/status
registry.latest_run_per_pipeline()                     # one row per pipeline
registry.runs_that_warned()                            # tolerated warns (incl. drift)
registry.records_for_run(pipeline_run_id)              # every step of one run
registry.latest_success(RunAddress.pipeline("cases"), on=date(2026, 6, 23))
registry.latest_success(
    RunAddress.task("pipeline_2", "step_4"),
    on_or_after=date(2026, 6, 16),
)
registry.recent_row_counts("cases", limit=10)          # read volumes, newest first
registry.recent_profiles("cases.profile", limit=10)    # per-column profiles, newest first
```

- **Ingest is idempotent**: a record's identity is `pipeline_run_id` + step (+ a
  step ordinal, because a multi-processor run emits one `process` record per
  processor — a bare `pipeline_run_id`+step would collide them), so re-reading the
  same log inserts nothing the second time (`INSERT OR IGNORE`).
- **Queryable by `pipeline_run_id`, pipeline, status, and time.** Ordering is by the
  record `timestamp`; "row counts over time" is `query_runs(pipeline=…)` read in
  order.
- **Latest success queries accept `RunAddress` labels.** A whole-pipeline
  address uses the successful `step="run"` summary record. A task/step address
  uses successful non-`run` step records with the matching `step_address`.
  `on=...` and `on_or_after=...` filter by the run-log record's emitted
  `timestamp` date; they do not yet use a separate business/load date.
- It is a **query store, not a `Dataset` carrier**, so it stays stdlib-only
  (`json` + `sqlite3`) and never names pandas. It opens through the same
  `connect` factory and honours the single-writer / rollback-journal conventions
  (ADR-0001) like any other medallion db; paths are `pathlib` (Windows/macOS).
- **Schema-drift surfaces as a warn-hit** (ADR-0006), so `runs_that_warned()` is
  also the drift-surfacing query — it pairs with the raw-drift detector
  ([`SchemaDriftValidator`](#validator--a-fail-fast-check-at-a-layer-boundary)),
  whose warn-severity message rides `warn_hits` onto the run summary.
- **It is also a baseline source.** `recent_row_counts(pipeline, limit=…)` returns
  the read-step volumes of recent *successful* runs, newest first — the history a
  [`VolumeAnomalyValidator`](#validator--a-fail-fast-check-at-a-layer-boundary)
  builds its band over. Only `ok` runs count, so a run the guardrail itself
  tripped can't poison the next night's baseline.
- **It also trends per-column profiles.** `recent_profiles(address, limit=…)`
  returns the per-column `DatasetProfile` records a
  [`Profile` Task](#profile--per-column-data-profiling-trended-across-runs)
  recorded at a stable `step_address` over recent *successful* runs, newest
  first — the statistical sibling of `recent_row_counts` and the history a
  `ProfileDriftCheck` builds its baseline over.

Reading the JSONL needs no change to the emitter (ADR-0005); the one format
addition this slice made is the per-record `timestamp` (run-log-format.md), the
time dimension the registry orders by.

### `Profile` — per-column data profiling, trended across runs
A **profile** is the *statistical* sibling of the run log's operational metadata
(#284 beside #89). Where the validators only *gate* a feed and
`VolumeAnomalyValidator` watches a single run-over-run number (the row count), a
profile captures a feed's *shape* — null rate, distinct count, min/max, and a
bounded top-N value distribution **per column** — and records it on the run log so
it can be trended. That turns a silent regression a row-count check misses (a
column quietly sliding 5% → 60% null; a categorical gaining junk values) into a
detectable, trendable one.

It is wired as a read-only Task on the builder — it observes, never reshapes. The
**computation lives in the application/observability layer** (`tools`), injected
into the builder as a `DataProfiler` exactly as a `RunLog` is — the framework
drives the profiler through its `DatasetProfiler` port and records what it
returns, but owns none of the metrics (so the lower `framework` layer never
imports the upper `tools` layer's profiling logic):

```python
from framework.run import Pipeline, RunRegistry
from tools.observability.profile import DataProfiler

registry = RunRegistry("/path/to/share/_registry/runs.db")
p = Pipeline("cases", run_log=run_log)
src = p.read(reader, name="read")

# Bare: compute + record a profile every run (cost-bounded, opt-in).
p.profile(DataProfiler(columns=["amount", "status"], top_n=20), src, name="profile")

# With a baseline: warn (or fail) when a column's null rate drifts run-over-run.
p.profile(
    DataProfiler(
        baseline=registry,
        address="cases.profile",
        null_rate_tolerance=0.2,
        severity="warn",  # or "fail" -> raises ProfileError (an ErrorCategory.DATA abort)
    ),
    src,
    name="profile",
)
```

- **`DataProfiler(...)`** (`tools.observability.profile`) is the injected port the
  builder drives. It bundles the cost-bounding knobs and the optional drift check;
  `Pipeline.profile(profiler, node)` records the `(payload, warnings)` it returns
  and propagates a fail-severity `raise`. The framework's
  `framework.core.DatasetProfiler` Protocol is the only profiling name the lower
  layer knows.
- **`profile_dataset(dataset, columns=…, top_n=…)`** computes a `DatasetProfile`
  (a `row_count` plus one `ColumnProfile` per column). `to_record()` /
  `from_record()` are the JSON round-trip the `RunLog` writes and the
  `RunRegistry` stores in its queryable `profile` column.
- **Cost is bounded / opt-in.** `top_n` caps each column's distribution; a
  `columns` allow-list narrows which columns are profiled; and a pipeline pays
  nothing unless it wires a `profile` node in — so profiling never dominates a
  large-feed run.
- **`ProfileDriftCheck(baseline, address, null_rate_tolerance=…)`** is the
  run-over-run comparison, mirroring `VolumeAnomalyValidator`: it derives a
  per-column null-rate baseline from the median over recent profiled runs
  (`baseline.recent_profiles(address)` — the `RunRegistry` is the production
  source) and reports each column whose rate deviated beyond tolerance. With
  fewer than `min_history` prior runs the band is skipped so a feed's first
  nights don't trip spuriously. `DataProfiler` builds and drives it.
- **Severity is the profiler's call**, like any Validator: `warn` rides the
  deviation onto the step's `warn_hits` (run continues, surfaced by
  `runs_that_warned()`); `fail` raises `ProfileError`, an `ErrorCategory.DATA`
  abort.

### `PipelineRunner` — thin domain orchestration + requirement guard
`PipelineRunner` (`framework.run.runner`) is the minimal orchestration layer above
the builder. It registers domain Pipelines by `(case_type, pipeline)` and runs
one requested Pipeline by name, without changing the builder contract:

```python
from framework.run import PipelineRunner, Requirement, RunAddress

runner = PipelineRunner()
runner.register("cases", "ingest", run_ingest)
runner.register(
    "cases",
    "selection",
    run_selection,
    freshness=(
        Requirement.succeeded(RunAddress.pipeline("ingest", subject="cases"))
        .same_day()
        .on_first_run("block"),
    ),
)

runner.run("cases", "selection", "/path/to/share", run_date=date(2026, 5, 29))
```

Handlers receive a `RunContext` carrying `base_dir`, `case_type`, `pipeline`,
`run_date`, `load_date`, `pipeline_run_id`, `logical_run_id`, a string
`params` mapping, the runner-level `RunLog`, the `RunRegistry`, and
`freshness_days`. `pipeline_run_id` is the concrete
attempt recorded in RunLog/RunRegistry; `logical_run_id` is the idempotency key a
re-driven business run reuses for accumulated rows. A run's history label is
`<case_type>/<pipeline>` when registered with a subject (the registry /
`orchestrate` path) or the bare `<pipeline>` name when run by path (see below);
metadata is stored under `<base_dir>/_runs/<label-stem>.log` and
`<base_dir>/_registry/`.

`run_pipeline` (`framework.run`) is the execution core `PipelineRunner.run`
delegates to, and the path-addressed `run` command calls directly: given a
handler, a pipeline `name`, an optional `subject`, an `upstreams` tuple, and
optional run `params`, it builds the `RunContext`, catches the shared
`RunRegistry` up from every
`_runs/*.log` (so an upstream's history is visible regardless of which log
partitioned it), runs the requirement checks, dispatches the handler, and records
the run summary. Run summary records include the parameters after default
redaction of likely secret keys.

`Requirement` declares the upstream Pipeline or task a downstream run needs.
`Requirement.succeeded(address).within_days(n)` requires the latest successful
record for that `RunAddress` to be no older than `n` calendar days before the
downstream `run_date`; `same_day()` requires a success on the downstream
`run_date`. Failed upstream records do not count. First-run behavior is explicit:
`.on_first_run("allow")` proceeds silently, `"warn"` proceeds with a `freshness`
warning, and `"block"` aborts before the handler executes.

Examples:

```python
# Pipeline 3 Task 17 depends on Pipeline 2 Task 4 in the last 7 days.
Requirement.succeeded(
    RunAddress.task("pipeline_2", "step_4"),
).within_days(7)

# Pipeline 6 requires Pipeline 4 on the same day.
Requirement.succeeded(
    RunAddress.pipeline("pipeline_4"),
).same_day()
```

`FreshnessRequirement(upstream_pipeline, max_age_days=n)` remains supported and
adapts to `Requirement.succeeded(RunAddress.pipeline(...)).within_days(n)`,
using the downstream subject when no upstream subject is supplied. Its no-history
behavior remains the historical default: allow the first run with a warning.
Stale history aborts before the handler executes and writes both a `freshness`
error and an errored domain `run` summary.

> **Note: `base_dir` bounds freshness visibility.** The `RunRegistry` is entirely scoped to the `base_dir` provided at execution time. It collects history by sweeping `<base_dir>/_runs/*.log`. If an upstream pipeline ran under a *different* base directory, its logs will not be visible to the downstream runner, and the `FreshnessGuard` will treat it as having no history. To validate freshness dependencies, both the upstream and downstream pipelines must be executed against the same `base_dir`.

The CLI `run` command addresses a pipeline by its location on disk, importing
`pipelines.<name>.pipeline` and running its `run(context)` callable through
`run_pipeline`:

```sh
python -m cli run pipelines/ingest --base-dir /tmp/demo --run-date 2026-05-29
python -m cli run pipelines/selection --base-dir /tmp/demo --run-date 2026-05-29
python -m cli run pipelines/claims --base-dir /tmp/demo \
  --run-date 2026-06-22 \
  --logical-run-id claims:ingest:20260622:claims_20260622_a.csv \
  --param source_file=/share/upstream/claims/claims_20260622_a.csv
```

### `Orchestrator` — scheduled PipelineSets
`Orchestrator` (`tools.orchestration`) is the scheduling layer above the
path-addressed run. It is not a builder-level `Pipeline`; it decides which
scheduled pipelines are due for one run date, invokes each **by its
`pipelines/<name>` path** (the same address the operator CLI's `run` command
uses, imported at runtime by the default `PathPipelineInvoker`), and records
scheduling decisions separately from execution history:

```python
from datetime import date

from framework.run import FreshnessRequirement, Requirement, RunAddress
from tools.calendar import WorkingDayCalendar
from tools.orchestration import (
    Orchestrator,
    PipelineSet,
    ScheduledPipeline,
    Weekdays,
)

sets = (
    PipelineSet(
        "cases",
        (
            ScheduledPipeline("pipelines/ingest", Weekdays()),
            ScheduledPipeline(
                "pipelines/selection",
                Weekdays(),
                depends_on=(
                    FreshnessRequirement("ingest"),
                    Requirement.succeeded(
                        RunAddress.task("ingest", "normalise")
                    ).within_days(7),
                ),
            ),
        ),
    ),
)

Orchestrator(sets, WorkingDayCalendar()).run_due_once(
    "/path/to/share",
    run_date=date(2026, 5, 29),
)
```

`PipelineSet` is the independent failure boundary, normally one Case Type or one
platform-wide group. `ScheduledPipeline` names a `pipelines/<name>` path and
carries its schedule, dependencies, and enablement; the path's leaf is the
run-history label the pipeline records under (and the name a `depends_on`
requirement targets an upstream by). Execution is by path — no handler registry
is wired up front — so a `PathPipelineInvoker` (the default) resolves the module
at run time, or a custom `invoker=` can be injected for tests. Dependencies may
be legacy `FreshnessRequirement` values or `Requirement` predicates that target
whole-Pipeline or task-level `RunAddress` history. `Weekdays()` is the normal
daily schedule, using `WorkingDayCalendar` for weekends and holidays; other
schedules are `SpecificWeekdays`, `DayOfMonth`, `NthWorkingDayOfMonth`,
`LastWorkingDayOfMonth`, and `ManualOnly`.

Each invocation writes decisions to `<base_dir>/_orchestration/runs.db` with a
stable item key of `set_name/pipeline/run_date`. Each decision also
records the `logical_run_id` the pass assigned the item (the stable business key)
and the `pipeline_run_id` it read back from the registry, so
`OrchestrationStore.lineage(orchestration_run_id)` joins one pass to every
pipeline execution it triggered — `pipeline_run_id` is the key into
`RunRegistry.records_for_run(...)`. `RunLog` and
`RunRegistry` stay reserved for actual Pipeline execution records. A failed
scheduled item is terminal for that orchestrator run and blocks downstream
dependants. Requirement failures from stale task/pipeline history, missing
history with `on_first_run("block")`, or failed upstream scheduled items are
recorded as `blocked` decisions with their reason; unrelated items in the same
set and every other `PipelineSet` continue. `run_until_complete(...)` performs a
bounded Python polling loop over the same run date; it does not retry failed
items from the same invocation.

Python definitions are canonical. YAML overrides may disable a scheduled item,
replace its schedule timing, or override freshness windows for operations
without changing the registered pipeline code.

### `ForEach` — independent per-item builder runs
`ForEach` (`tools.orchestration`) is the small runnable orchestration
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
    p = Pipeline(f"selection:{path.name}")
    r = p.read(CsvReader(path), name="read")
    p.write(writer, r, name="write")
    return p

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

### `DatedFileDiscovery` — source-artifact discovery for dated-file catch-up
`DatedFileDiscovery` (`tools.discovery`) finds source files whose filenames
encode a business date and turns them into `SourceArtifact` value objects,
each carrying `path`, `business_date`, and a stable `file_id` (the filename).
It is an orchestration concern, not a reader concern: each artifact is its own
logical run with its own retry boundary and idempotency key.

```python
from tools.discovery import DatedFileDiscovery, SourceArtifact
from tools.orchestration import ForEach

files = DatedFileDiscovery(
    directory="/share/upstream/claims",
    pattern="claims_{date:%Y%m%d}_*.csv",
).available_between(last_successful_source_date, run_date)

def pipeline_builder(artifact: SourceArtifact, context: RunContext) -> Pipeline:
    ...

ForEach(
    files,
    pipeline_builder,
    logical_run_id=lambda a, _i, _c: f"claims:ingest:{a.file_id}",
).run(context)
```

`available_between(start, end)` returns artifacts where
`start < business_date <= end`. Pass the last successfully processed source
date as *start* and the current run date as *end* to discover exactly the
un-processed dates since the last successful run. Results are sorted
deterministically by `(business_date, path)` across Windows and macOS.

The `{date:FORMAT}` placeholder uses `strptime` format codes; `*` is a
wildcard for any other filename segment. Constructing a `DatedFileDiscovery`
with a pattern missing `{date:...}` raises `ValueError` immediately.

**Decision rule — reader vs orchestration concern:**

| Shape | Use |
|---|---|
| Many files are one logical batch (one `Dataset`, one logical run id) | `GlobCsvReader(directory, pattern)` |
| Each file is its own logical run (own run history, retry, idempotency) | `DatedFileDiscovery` + `ForEach` |

### `RunAddress` — dependency labels for Pipelines and steps
`RunAddress` (`framework.run`) is the public value object for naming dependency
targets without coupling orchestration code to a future registry schema. It can
address either a whole **Pipeline** or a specific named run step inside that
Pipeline, with or without a subject qualifier:

| Target | Label |
|--------|-------|
| Pipeline | `pipeline` |
| Subject-qualified Pipeline | `subject/pipeline` |
| Step | `pipeline.step` |
| Subject-qualified step | `subject/pipeline.step` |

This is the stable address shape from the local-first DAG design:
`pipeline_2.step_4`. The current builder authoring method is still `.task(...)`,
but dependency addresses use **step** as the execution-graph term.

Construct addresses explicitly when code already has structured pieces:

```python
from framework.run import RunAddress

RunAddress.pipeline("claims", subject="case-review")
RunAddress.step("claims", "validate_schema", subject="case-review")
RunAddress.step("pipeline_2", "step_4")
```

Parse labels when accepting configuration or registry input:

```python
address = RunAddress.parse("case-review/claims.validate_schema")
assert address.label == "case-review/claims.validate_schema"
```

`.label` and `str(address)` return the same stable string, suitable for logs,
dependency declarations, and run-registry queries. Invalid labels raise
`RunAddressError`, a `PipelineError` with the `config` category, so bad
dependency wiring is reported like other expected configuration failures rather
than leaking raw parsing exceptions.

The builder wires these addresses onto its nodes automatically. For example,
`Pipeline("pipeline_2").task("step_4", ...)` records the bare run-log step as
`step_4` and the stable dependency key as `pipeline_2.step_4`. After the log is
ingested, `RunRegistry.records_for_address("pipeline_2.step_4")` returns the
matching records and `RunRegistry.has_successful_address("pipeline_2.step_4")`
answers the simple upstream dependency check. When a dependency needs the most
recent successful attempt, `RunRegistry.latest_success(...)` accepts either a
`RunAddress` or one of its labels. Pipeline addresses read from the `run`
summary; task addresses read from successful non-`run` step records. Date
filters are based on the record `timestamp` emitted by `RunLog`.

### `Pipeline` — the deferred DAG builder
A `Pipeline` describes a feed's path and runs **nothing** until `.run()`
(ADR-0003):

```python
p = Pipeline("cases")
r = p.read(CsvReader(path), name="read")
v1 = p.validate(ColumnValidator(["case_ref"]), r, name="pre_val") # gate the input
t1 = p.task("normalise", NormaliseCases(), v1)                   # named task
v2 = p.validate(RowCountValidator(minimum=1), t1, name="post_val") # gate the output
p.write(writer, v2, name="write")
p.run()
```

Position is inherent in **how nodes are wired**: each step consumes a specific
upstream node, so a validator attached to the read node is a **pre**-validator
(gates the input) and one attached to a transformed node is a **post**-validator
(gates the output about to be written) — exactly the order above. There is no
separate stage-composition API and no public custom-`Stage` contract; the
dataset→dataset transform extension point is the `Processor`, attached with
`.task(name, processor, node)` (or the compatible
`.transform(processor, node, name=...)` spelling). A mid-pipeline **checkpoint** — writing
a snapshot partway through — is just a `.write(...)` on an intermediate node while
the graph continues from that same node. Severity is set per validate step
(`.validate(v, node, name=..., severity="warn")`). The invariant remains
`Reader → Dataset → (transform | validate)* → Writer`, all deferred — nothing
runs until `.run()`.

Call `.describe()` before `.run()` to inspect the plan while authoring or
debugging. The output is a **flat, plan-ordered list**: one line per step, in
the order `.run()` will execute them. Empty steps (e.g. no validators attached)
are omitted entirely — there are no `none` placeholders. Each step renders its
own entry via its `plan_entry()` method, so adding a new step kind touches one
place and `describe()` requires no changes.

Each component renders its own summary through the opt-in `describe()` protocol: a component implements `describe() -> str` to surface the config it
chooses (the framework readers/writers/validators/processors/`RunLog` do,
self-redacting any credentials — e.g. `SharePointReader` strips `user:pass@`
from its site URL and never shows `auth`). A component without `describe()` is
shown by bare class name only; the builder never introspects a component's
attributes, so a value stored under any name cannot leak into the plan:

```python
p = Pipeline("cases")
r = p.read(CsvReader(path), name="read")
v = p.validate(ColumnValidator(["case_ref"]), r, name="columns")
t = p.task("normalise", NormaliseCases(), v)
p.write(writer, t, name="write")

print(p.describe())
```

`.run()` is the terminus and is **fail-fast and atomic** (ADR-0005): it executes
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
- Atomicity is **per writer**, not per run. A run's intermediate artifacts —
  quarantine rejects, an explain/trace, a checkpoint — each commit through their
  own writer as their node runs, so an abort *after* one of them leaves that
  artifact on disk as **independently committed evidence** (ADR-0005).
  The run-log `committed` marker flags which steps durably wrote.

The builder still makes **no** write decisions — no layer logic, no
refresh-vs-accumulate branching; that all lives on the Writer. Because the
terminus owns execution, it is the home of the cross-cutting concerns: it uses
the supplied `RunContext` or creates one for ad hoc runs, exposes the pipeline
attempt id as `pipeline.pipeline_run_id`, times each planned step, and drives the composed
`RunLog` (timing + structured JSONL logging). The planned step
objects are internal: they expose stable name/kind/order, the wrapped component
where applicable, and read-only/side-effect metadata for plan-validation and the
**dry-run preview**, but pipeline scripts still use only the builder methods. A
run carried out under `RunContext(dry_run=True)` (the `dry_run_pipeline` core
behind `cli run --dry-run`) reads, transforms, and validates real data but
skips every write, quarantine, and explain commit — and touches no run log —
accumulating a `DryRunReport` of columns, dtypes, row counts, and a bounded row
sample per step; it falls back to an ambient run context so an author's bare
`p.run()` inherits the dry-run flag without threading it by hand. The authoring
vocabulary is the DAG builder's nodes: `.task()` / `.transform()` for
dataset→dataset work, `.validate()` for a gate, `.write()` on an intermediate
node for a lineage checkpoint, and explicit dependency wiring for fan-in / fan-out.

### `WorkingDayCalendar` — working-day arithmetic (pure utility)
A config-seeded `WorkingDayCalendar(holidays=…, weekend=…)` answers working-day
questions for availability criteria ("the last 20 working days" — `CONTEXT.md`).
Unlike the primitives above it touches no `Dataset`, `Store`, or engine — it
is pure stdlib `datetime`, hence deterministic and identical on Windows/macOS,
and is **not** a Feed (ADR-0001). Two queries: `is_working_day(day)`
and `last_n_working_days(n, from_date)` (the `n` most recent working days on or
before `from_date`, most-recent first, skipping weekends + holidays). Full
config and boundary semantics in
[`working-day-calendar.md`](working-day-calendar.md).

## The case-review application/domain layer

Above the generic framework primitives sits the thin **case-review application
layer**: the declarative Case Type objects and the `CasePool` that reads the
ingested silver, surfaced through intention-revealing retrievals instead of raw
`pandas.read_*` calls. These helpers live in the `case_review` package; new
case-review concepts belong there (or in pipeline support modules), not under
`framework/`. The full flow lives in [`selection.md`](selection.md); in brief:

### `CaseType` / `Variation` — the declarative domain objects
A `CaseType` (`case_review.case_type`) bundles a Case Type's `schema`, its
identity contract, and its `variations`, imported directly — no global CaseType
config registry (ADR-0011). The identity contract is the `natural_key` (the
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
objects are the typed-on-demand edge at the domain layer (ADR-0002).

### `DatasetReader` — bridge an in-memory Dataset into the builder
`DatasetReader(dataset)` (`framework.io.readers`) adapts an already-in-memory
`Dataset` to the `Reader` shape, so the **Selection** pipeline feeds the
CasePool's available cases straight into the `Pipeline` builder (read → process →
write) without a SQL round-trip. Selection is its own pipeline that reuses the
builder, narrowing the CasePool with the Selection processors and `Stamp` into
the gold `SelectionPool`.

### `RetryPolicy` / `RetryingReader` / `RetryingWriter` — retry at the I/O edge
`RetryPolicy(attempts, retry_on, backoff_seconds=…)` (`tools.retry`) encodes
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
from framework.io import CsvReader, Refresh
from tools.store import StoreRegistry
from framework.run import Pipeline
from tools.medallion import medallion

med = medallion(StoreRegistry("/path/to/share"), "cases")
p = Pipeline("cases")
r = p.read(CsvReader("feed.csv"), name="read")
p.write(med.raw.writer("cases", Refresh()), r, name="write")
landed = p.run()
print(len(landed), landed.columns)
```

See [`../pipelines/demo_csv_to_raw.py`](../pipelines/demo_csv_to_raw.py) for the
runnable demo.
