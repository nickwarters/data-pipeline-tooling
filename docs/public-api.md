# The public API — what pipeline authors import

The framework is **import-only** (on `sys.path`, never `pip install`ed — see
[CLAUDE.md](../CLAUDE.md) and *Packaging* below). This document is the contract
between the framework and the pipeline scripts that depend on it: it states
**which names are public**, **which modules are internal layout**, and the one
rule that follows from that split.

> **The rule.** Application code — both `pipelines/` and the `case_review/`
> domain layer — imports from the public **facades** — `framework.core`,
> `framework.io`, `framework.transform`, `framework.run` — never from the
> modules behind them. The facade names are the stable surface; the submodule
> paths can be reorganised without notice. A test
> (`tests/integration/test_public_api.py`) holds both `pipelines/` and
> `case_review/` to this boundary — and it checks *both* halves:
> `framework._internal.schema` fails because it names no facade, and
> `framework.core.value_rules` fails because it reaches **behind** one.
> (Previously the check compared only the second dotted segment, so the second —
> and more important — half passed silently; the test has its own self-test now
> so it cannot go hollow again unnoticed.)

```python
from framework.core import Dataset
from framework.io import CsvReader, Refresh
from tools.store import StoreRegistry
from framework.transform import Filter, VectorizedFilter, SchemaCoercion
from framework.core import ColumnValidator, SchemaValidator, ValidationError
from framework.run import Pipeline, PipelineRunner, RunContext
from tools.medallion import medallion
from tools.retry import RetryPolicy
from tools.calendar import WorkingDayCalendar
```

Where a feed *lands* is **no longer framework vocabulary**. The opaque
**`namespace`** (a logical database) → file `Store` / `StoreRegistry` and the
raw/silver/gold **medallion** profile over it are both **application
infrastructure** in the sibling `tools` package — `tools.store`
(`StoreRegistry(base_dir)`) and `tools.medallion.medallion(registry, subject)`
(→ `.raw` / `.silver` / `.gold` namespace Stores) — not a `framework.*` export.
`framework.io` knows only the `Reader` / `Writer` ports and the load strategies.

The checks (`ColumnValidator` / `SchemaValidator` / the value rules) live on
`framework.core` alongside the base vocabulary — there is no separate `validate`
facade. The cross-cutting `retry` / `calendar` utilities are a sibling top-level
`tools` package, not a `framework` facade.

For interactive discovery, `import framework` exposes only those facade modules:

```python
import framework

framework.__all__  # ["core", "io", "transform", "run"]
framework.core.Dataset
framework.io.CsvReader
framework.transform.Filter
framework.core.ColumnValidator
framework.run.Pipeline
tools.calendar.WorkingDayCalendar
```

The package root is intentionally not a mega-facade: names such as `CsvReader`,
`Filter`, and `Pipeline` stay on their task-oriented facades and are not
available as `framework.CsvReader`, `framework.Filter`, or `framework.Pipeline`.

The facades are thin re-export packages: `framework.transform.Filter` **is**
`framework.transform.processors.Filter` (the same object). Nothing is reimplemented — the
facade only curates and groups.

Each facade is a **sub-package** whose `__init__.py` does the re-exporting, with
the implementation modules living alongside it:

- `framework/core/` — the foundational vocabulary every other facade builds on:
  `dataset` (`Dataset`), `protocols` (the small shared `Reader` / `Writer` /
  `Processor` / `Validator` shapes), and the **declared-schema contract** — the
  `validate(dataset)` `validators`, the `schema` check (`SchemaValidator`), and
  the `value_rules` (`Nullable` / `Pattern` / ...). It sits *below* the task
  facades. (The medallion `Layer` enum was **removed** here in favour of
  the namespace Store + the `tools.medallion` profile.)
- `framework/io/` — `readers`, `writers`, `strategy`, `sql`. (Where a feed
  *lands* — `Store` / `StoreRegistry` — moved out to `tools.store`.)
- `framework/transform/` — the dataset-reshaping primitives: `processors`,
  `json_shaping` (the JSON blob explodes/flatten), `coercion` (`SchemaCoercion`
  — the *coerce* half of the schema adapter), `quarantine`.
- `framework/run/` — `builder`, `execution`, `address`,
  `trace`, `runner`, `run_context`, `dry_run` (the preview report behind
  `dry_run_pipeline`). It also re-exports the observability seam
  (`RunLog`, `RunRegistry`) that lives in the sibling `tools.observability`
  package.

One non-facade package sits inside `framework/`, and two more are top-level
siblings beside it:

- `framework/_internal/` — cross-cutting helpers with **no** public name:
  `connection` (`connect`), `describe` (`render` / `redact_url`), `identity`
  (`sha256_json`), `locations` (`file_location` / `table_location`), and `schema`
  (the shared `ValueRule` protocol + the Python↔pandas type mapping and
  annotation reading both schema adapters derive from). The leading underscore
  marks it private: application code (`pipelines/` + `case_review/`) never
  imports from here, and the public-API test enforces that. The sibling `tools/`
  package does, where a helper is genuinely shared with the framework.
- `cli/` (top-level) — the `python -m cli` **entry point**, not an import
  surface: `scaffold` (generate a feed) and `operator` (the `run` /
  `orchestrate` / `runs` / `status` / `log` commands), dispatched by
  `cli/__main__.py`. Run as a tool, never imported by application code.
  `run` resolves a pipeline by its path (`pipelines/<name>` -> the module
  `pipelines.<name>.pipeline`) at runtime; `orchestrate` resolves an application
  registry module by name (a required `--app`). Either way the framework never
  statically depends on `pipelines/` and carries no application name of its own.
- `tests/framework_testing/` — the test-only support surface (below).

These sub-package paths are the *internal layout*; only the facade names
(`framework.core` / `framework.io` / `framework.transform` / `framework.run`)
are the stable runtime import surface. `tests.framework_testing` is the separate
test-only surface, and `framework._internal` is private.

## The facades

Grouped by what a pipeline author reaches for: the base vocabulary (including the
data contract), get data in/out, reshape it, compose & run it.

### `framework.core` — the foundational vocabulary & data contract

The nouns every pipeline names regardless of task — what flows, where it lands,
and the contract that gates it. They sit below the task facades; everything else
builds on them.

| Names | What |
|-------|------|
| `Dataset` | The opaque bulk tabular carrier (pandas behind the seam) that flows through every Reader, Processor, Validator, and Writer. |
| `Reader`, `ChunkReader`, `Writer`, `Processor`, `Validator`, `DatasetProfiler`, `Severity` | Shared protocols used by framework internals and available for advanced typing. `ChunkReader` (`chunks(size) -> Iterator[Dataset]`) is the streaming dual of `Reader` for sources too big to hold whole. `DatasetProfiler` (`profile(dataset) -> (payload, warnings)`) is the injected port behind `Pipeline.profile` — the framework drives it and records the payload, while the concrete statistical computation lives in the upper `tools` layer (`DataProfiler`). Concrete implementations still live on their task facades. |
| `DEFAULT_CHUNK_SIZE` | The default chunk size (10,000 rows) a `ChunkReader` streams in. |
| `ChunkWritable` | The write-side dual of `ChunkReader`: `writing_chunks() -> AbstractContextManager[Writer]`, a session in which many chunk writes land as **one logical load**. A Writer that replaces its target offers none, which is how `Pipeline.read_chunks` refuses the pairing at wiring time. |
| `StreamingUniqueValidator`, `needs_whole_dataset` | The uniqueness check that survives a chunk boundary (an accumulating key set, optionally capped by `max_keys`), and the predicate reading a Validator's `whole_dataset` marker. `UniqueValidator` and `VolumeAnomalyValidator` carry that marker and are refused under a streamed source. |
| `Validator`, `ValidationError` | The check seam and the error it raises. |
| `ColumnValidator`, `RowCountValidator`, `VolumeAnomalyValidator`, `UniqueValidator`, `SchemaDriftValidator` | The concrete structural / volume / uniqueness / drift checks that *gate* a feed — they raise on breach rather than reshaping. Composed onto a `Pipeline` as pre/post validators. |
| `RunHistory`, `PriorColumns` | History inputs the run-aware checks read. |
| `SchemaValidator` | The declared-schema check: a Case Type dataclass's columns + dtypes + nullability + value rules + row checks, enforced at silver (and optionally gold). |
| `ValueRule`, `Nullable`, `NonNull`, `Pattern`, `Length`, `Range`, `Unique`, `OneOf` | The declared-schema value-level contract (`Annotated` field rules) the schema check runs. |
| `RowCheck`, `row_checks` | The declared-schema **row check** contract: cross-field checks over the relationship between a row's fields, declared via the `@row_checks(...)` class decorator (the horizontal sibling to the value rules). |
| `PipelineError`, `ErrorCategory` | The base of the expected, fail-fast failure family — `ValidationError`, `FreshnessError`, `UnknownPipelineError`, `RunAddressError`, `PipelineGraphError`, `CoercionError`, `ForEachPipelineError` all subclass it. Catch it at a run boundary to handle any deliberate abort with one `except`; a genuine bug is not a `PipelineError` and keeps its traceback. Each carries an `ErrorCategory` (`data` / `operational` / `config`) recorded on the run log for triage; a raw bug has none. |
| `format_failure` | Renders a caught `PipelineError` as a short, traceback-free ASCII block for `stderr` (the failure kind + its message). A pure formatter — it never catches, suppresses, or exits, so the caller keeps control flow. |

### `framework.io` — sources & sinks

Moving data across the boundary. (Where it *lands* — the namespace `Store` /
`StoreRegistry` — is application infrastructure in `tools.store`, not here.)

| Names | What |
|-------|------|
| `Reader`, `DatasetReader`, `CsvReader`, `StrictCsvReader`, `StrictCsvParseError`, `GlobCsvReader`, `ExcelReader`, `SqliteReader` | The `read() -> Dataset` port and its concrete sources (`StrictCsvReader` is the char-by-char RFC 4180 parser; `StrictCsvParseError` is the located error it raises). (The remote `SasReader` / `SharePointReader` live in `tools.integrations`, not this facade — see below.) |
| `ChunkReader`, `ChunkedCsvReader`, `SasFileReader`, `DEFAULT_CHUNK_SIZE` | The `chunks(size) -> Iterator[Dataset]` streaming port and its concrete sources for inputs too big to hold whole: a local CSV (`ChunkedCsvReader`) and an **already-landed** `.sas7bdat`/xport file, incl. gzipped (`SasFileReader`). `SasFileReader` is read-only by nature and distinct from the remote `tools.integrations` `SasReader` (no script, no remote run, no copy). |
| `writing_chunks`, `supports_chunk_writes` | Open a Writer's chunk-write session, or ask whether it has one. `writing_chunks` raises a `TypeError` naming the Writer when it has none, so a chunked load never silently degrades into one-load-per-chunk. |
| `KeyFilterChunkReader`, `PredicateChunkReader`, `ChunkFilter` | Chunk-level row filters that wrap any `ChunkReader`, applied **per chunk before accumulation** so a huge source narrows to the rows of interest with bounded memory and a bounded landed table. `KeyFilterChunkReader(inner, key_column, allowed_keys)` is the id-allow-list (semi-join) case (keys normalised so float-vs-int / bytes-vs-str don't drop rows); `PredicateChunkReader(inner, predicate)` the general `ChunkFilter` form. Both expose `rows_scanned` / `rows_kept`. |
| `Writer`, `CsvWriter`, `ExcelWriter`, `JsonWriter`, `SqliteTruncateReloadWriter`, `AccumulateByRunWriter`, `SqliteUpsertWriter`, `SqliteInsertOrIgnoreWriter`, `SqliteInsertIfAbsentWriter`, `SqliteAppendOnlyWriter`, `QuarantineWriter`, `StdoutWriter` | The `write(dataset)` port and its concrete sinks (`SqliteInsertIfAbsentWriter` is the `InsertIfAbsent` reference-table sink: it inserts new keys only, minting compact integer surrogates, and never modifies an existing row; `SqliteAppendOnlyWriter` is the `AppendOnly` immutable-version sink: unseen keys append, an unchanged key is a no-op, a changed key raises `AppendOnlyConflictError`; `StdoutWriter` is a console sink for *seeing* a result — e.g. an explainer trace — rather than persisting it). (The remote `SharePointWriter` lives in `tools.integrations`, not this facade — see below.) |
| `LoadStrategy`, `Refresh`, `AccumulateByRun`, `UpsertStrategy`, `InsertOrIgnore`, `InsertIfAbsent`, `AppendOnly`, `AppendOnlyConflictError` | The load strategies a Writer carries. Each **realises itself**: `writer_for(db_path, table, busy_timeout_ms=...)` mints the SQLite Writer implementing it (so `Store.writer` is a one-line delegation and any object satisfying the `LoadStrategy` protocol works), and the optional `apply_to_frame(frame, read_existing)` is the file-writer half. `UpsertStrategy` / `InsertIfAbsent` / `AppendOnly` define no `apply_to_frame` — they are table-backed only, and a file Writer handed one raises a `TypeError` naming both. `AppendOnlyConflictError` is the `PipelineError` (category `data`) an `AppendOnly` load raises when a key it has already accepted arrives with different values. |

### `framework.transform` — reshaping a feed mid-pipeline

| Names | What |
|-------|------|
| `Processor` | The mid-pipeline transform seam — `Callable[..., Dataset]`: one or more `Dataset`s in (one per wired upstream node), exactly one out. |
| `Filter`, `Score`, `VectorizedFilter`, `VectorizedDerive`, `Stamp`, `Sort`, `Rename`, `JoinColumns`, `JoinDependency`, `JoinWith`, `AntiJoinWith`, `LatestPerKey`, `SelectColumns`, `DropColumns`, `Unpivot`, `DeriveKey` | The concrete Selection / Ingest / fan-out transforms. |
| `TopNPerGroup`, `Sample`, `SamplePerGroup`, `Parse` | The bounded-subset reductions — top-`n` per group and the seeded, reproducible draws (pure functions of input + a fixed seed) — plus `Parse`, which decodes a packed text column through a callable. These existed in `framework.transform.processors` but were for a time **absent from the facade**; the omission is silent (unlike a missing Reader, an unexported processor raises nothing), and it caused a duplicate copy of them to grow in `tools/analytics/`. That fork is retired and this facade is now their only supported import. |
| `ExplodeJsonMap`, `ExplodeJsonList`, `FlattenJsonObject` | The JSON blob reshapers: walk a JSON object/array held in one column into rows, or a 0-or-1 object into columns on the same row. `Unpivot`'s siblings for a blob rather than wide columns. |
| `JsonShapeError` | Raised by the three JSON reshapers on malformed JSON, or JSON of the wrong shape, naming the column and the row. |
| `SchemaCoercion` | The *coerce* half of the schema adapter: casts round-trip-lossy columns (`date` / `datetime` / `bool`) to the declared types — plus every declared column when the frame has no rows — a reshape, so it lives here, not with the schema check. |
| `CoercionError` | Raised by `SchemaCoercion` on an uncastable value. |
| `SchemaValueRulePartitioner` | The quarantine partitioner that routes value-rule / row-check rejects aside while preserving good rows for the main path. Usually reached through `Pipeline.quarantine(...)`, but exported for advanced schema/quarantine wiring. |

### `framework.run` — composing, executing, observing

| Names | What |
|-------|------|
| `Pipeline` | The deferred DAG builder. Nodes are declared explicitly — `.read` / `.task` / `.validate` / `.write` (plus compatible `.transform`, `.action`, `.profile`, `.explain`, and `.quarantine`) each return a wired node that later steps depend on; `.describe()` renders the pre-run plan and `.run()` walks the graph from its leaves, executing each node after its inputs. A **task** is the preferred public name for a stable named unit of work inside a pipeline. Dataset→dataset work is any `Dataset -> Dataset` callable passed to `.task(name, func, *inputs)`; `.transform(func, *inputs, name=...)` remains supported with the same execution path (`framework.transform` ships `Score` / `Filter` / `JoinWith`). `.profile(profiler, node)` drives an injected `framework.core.DatasetProfiler` (the `tools.observability.profile.DataProfiler` in practice) and records its payload — the framework owns no profiling logic. |
| `PipelineGraphError` | Raised by `.run()` when the wired graph cannot be executed — today, when every node is an input to another node, so the leaf-first walk has no starting point. A config-category `PipelineError`: the fix is in the wiring. Without it a cyclic graph would execute nothing and report success, under a real run and a dry run alike. |
| `RunAddress`, `RunAddressError` | A stable address for dependency targets: whole Pipelines (`pipeline`, `subject/pipeline`) or named run steps (`pipeline.step`, `subject/pipeline.step`, for example `pipeline_2.step_4`). The builder wires these onto run-log records as `step_address`; `RunRegistry.records_for_address(...)`, `RunRegistry.has_successful_address(...)`, and `RunRegistry.latest_success(...)` use that key for upstream dependency checks. Use `RunAddress.for_pipeline(...)`, `RunAddress.for_step(...)`, or `RunAddress.parse(label)` when code already has structured pieces or accepts config labels. Invalid labels raise `RunAddressError`, a config-category `PipelineError`. |
| `run_pipeline`, `load_pipeline`, `LoadedPipeline`, `PipelineRunner`, `RunContext`, `Requirement`, `FreshnessRequirement`, `FreshnessError`, `UnknownPipelineError` | The `run_pipeline` execution core (used by the path-addressed `run` command) + `load_pipeline(path)`, which resolves a `pipelines/<name>` disk path to its runnable `LoadedPipeline` (`name` / `run` / `upstreams`) — the shared rule the `run` command and the `Orchestrator` both address pipelines by — plus the thin domain runner and requirement guard. `FreshnessRequirement` is the compatibility adapter for old pipeline-level freshness checks. |
| `dry_run_pipeline`, `DryRunReport` | The preview/dry-run path (used by `run --dry-run`): runs a handler under a dry-run `RunContext` that reads, processes, and validates real data but skips every side effect — the write/quarantine/explain commits and the `.action` escape hatch, whose callable is not called — returning a `DryRunReport` of columns, dtypes, row counts, and a bounded row sample per step. It takes the same `params` a real run does, so a handler reading `context.params` behaves identically under a preview. |
| `RunLog`, `RunRegistry` | The structured-observability seam and its query store (re-exported here from `tools.observability`). |

## The `tools` package — sibling utilities

`tools` is a top-level package beside `framework`, not a framework facade. Like
every other top-level package here it is a **regular** package — `tools/`,
`tools/observability/` and `tools/integrations/` each carry an `__init__.py`
— but that `__init__.py` re-exports nothing: each helper is imported by
its own module path, so adding a module under `tools/` makes no public-surface
commitment on its own. Its public helpers carry stable names and are imported
directly:

| Import | What |
|--------|------|
| `tools.store` — `Store`, `StoreRegistry`, `StoreBackend`, `DirectoryStoreBackend` | Where a feed lands: namespace-scoped stores (one logical database → file). `StoreRegistry(base_dir)` mints a namespace `Store` via `store(namespace)` **and** keeps a registry of named Readers/Writers — `register(name, reader\|writer)` then `reader(name)` / `writer(name)` — so a pipeline refers to a component by name. A `Store` mints `writer(table, strategy)` / `reader(table)` over its namespace. The raw/silver/gold `tools.medallion` profile builds on it. Application infrastructure, moved out of `framework.io`. |
| `tools.recipes` — `source_to_raw`, `raw_to_silver` | The **standard medallion hop recipes** every feed shares: `source_to_raw(reader, writer, expected_columns=…)` gates the source's shape and lands it faithfully; `raw_to_silver(reader, writer, schema=…, rename=…, reject_writer=…)` canonicalises, coerces, quarantines and validates. Each returns a plain, not-yet-run `Pipeline` the caller owns — composition, not inheritance, so a feed that must diverge inlines the recipe's body and edits it. They take the hop's **ports** rather than a medallion profile (the source end of a raw hop is not a medallion layer, and injected ports are what let a feed's test drive the real hop against a `RecordingWriter`). Application vocabulary, so `tools.*` and not `framework.*` — keeping the framework domain-free is why the medallion moved out of it. See [adding-a-feed.md](adding-a-feed.md). |
| `tools.retry` — `RetryPolicy`, `RetryingReader`, `RetryingWriter` | Targeted retry for transient I/O-edge failures — see [retry.md](retry.md). |
| `tools.calendar` — `WorkingDayCalendar` | Working-day availability arithmetic (pure utility). |
| `tools.environments` — `resolve_base_dir`, `known_environments` | Resolve a run's medallion `base_dir` from a named environment (`prod` / `dev`), each rooted at an OS environment variable with a `dev` fallback to `./data`. The operational env → path mapping the operator CLI and pipeline `main()`s use; see [operator-cli.md](operator-cli.md). |
| `tools.orchestration` — `Orchestrator`, `PipelineSet`, `ScheduledPipeline`, `PathPipelineInvoker`, `Schedule`, `Weekdays`, `SpecificWeekdays`, `DayOfMonth`, `NthWorkingDayOfMonth`, `LastWorkingDayOfMonth`, `ManualOnly` | Scheduled orchestration over **path-addressed** pipelines: each `ScheduledPipeline` names a `pipelines/<name>` path, invoked at runtime by the default `PathPipelineInvoker` (the same addressing as the `run` command — no handler registry). Evaluate due work for a run date, isolate failures by scheduled item/PipelineSet, and record decisions in `_orchestration/runs.db`. `Schedule` carries friendly constructors (`Schedule.daily()`, `Schedule.on_weekdays("monday", …)`, `Schedule.day_of_month(n)`, `Schedule.nth_working_day_of_month(n)`, `Schedule.last_working_day_of_month()`, `Schedule.manual_only()`) over the concrete schedule classes. |
| `tools.observability` — `RunLog`, `RunRegistry`, `RunStore`; `record_schema` module — `RUN_RECORD_FIELDS`, `Field`, `ensure_columns`; `profile` module — `DataProfiler`, `DatasetProfile`, `ColumnProfile`, `profile_dataset`, `ProfileDriftCheck`, `ProfileBaseline`, `ProfileError` | The structured-observability seam and its query store (`RunLog` / `RunRegistry` also re-exported via `framework.run`), plus the per-column profiling surface — the statistical sibling that records per-column shape on the run log and trends it via `RunRegistry.recent_profiles(...)`. `DataProfiler` is the concrete `framework.core.DatasetProfiler` the builder's `.profile(...)` drives; the profiling logic lives here in the upper `tools` layer, never imported down into `framework`. `record_schema` declares the run-record field set **once, as data** — the log record, the registry DDL/migration/`INSERT`/decode and the console line all derive from it, and `tools.orchestration`'s decision store reuses `Field` / `ensure_columns` for its own separate contract. `framework` never imports it: the framework knows the `RunLog` protocol, not the record schema. `run_store` owns the **on-disk layout** of a base directory's run metadata (`_runs/`, `_registry/runs.db`, `_orchestration/runs.db`) and the `catch_up()` sweep over it — the counterpart of `tools.store`'s `StoreRegistry`, which owns where the *data* lands; `timestamps` owns the UTC-instant / local-calendar-date rule every freshness comparison and date-bounded query reads. |
| `tools.integrations.remote` — `SasReader`, `SharePointReader`, `SharePointWriter` | The remote-source/sink Reader and Writer (SAS extract, SharePoint list) — same `read()` / `write()` ports as the file/SQLite ones, but reaching a remote client that is **stubbed** behind swappable seams (`RemoteRunner`, `SharePointFetcher` / `SharePointPusher`) until the on-prem SE client (NTLM/Kerberos/REST) lands. |
| `tools.integrations.sharepoint_rest` — `SharePointModifiedReader`, `ModifiedWindow`, `METADATA_COLUMNS`, `SharePointFeedError` | The **incremental** SharePoint Reader: the items of one list whose `Modified` falls in a caller-supplied half-open window, stamped with immutable observation metadata (`METADATA_COLUMNS`). Configures the organisational client behind the `SharePointListClient` seam (`fetch_items(list_name, expand_fields, select_fields, filters)`); the client owns auth, transport and paging. Holds no checkpoint, no retry, and no medallion knowledge — see [adding-a-feed.md](adding-a-feed.md#remote-feeds-sas-sharepoint). Note the seam declares the **fetch alone**, because the window is the caller's to supply; a feed that computes its own window also needs the list server's clock, and states that extension locally (`pipelines/sharepoint_cases`' `CaseListClient`, which extends this Protocol with `server_time()` so a missing client is diagnosed as a missing client). |
| `tools.integrations.sharepoint_checkpoint` — `SharePointCheckpointStore`, `SharePointSource` | The other half of that split: the durable per-list `Modified` watermark, and the pure rule over it — `end = server_now - safety_lag`, `start = watermark - overlap` (`None` on a first load), and `None` for the whole window when the safe bound has not advanced yet. `commit(...)` is the **last act of a successful run**; nothing else advances a watermark. A source is identified by the list **GUID** (a title is a mutable display name), and the site it is keyed on is credential-free. This is a base directory's **third** category — source *control state* at `<base>/_checkpoints/sharepoint.db`, beside the rows (`tools.store`) and the run metadata (`tools.observability.run_store`) rather than inside either. Note the word: this "checkpoint" is a source watermark, **not** the mid-graph `.write()` node the `Pipeline` sense means. See [adding-a-feed.md](adding-a-feed.md#sharepointcheckpointstorebase_dir--where-the-polling-got-to). |

## Internal modules — do not import from these

These are implementation detail. The facades draw from some of them, but the
**module paths and any name not re-exported above are not public** and may change
without notice:

- `framework._internal.connection` (`connect`) — the connection factory seam;
  used by Readers/Writers/Store, not by pipelines.
- `framework.io.sql` (`quote_identifier`) — the single place a table/column name is
  turned into a safely-quoted SQL identifier; applied at every
  identifier interpolation across the SQLite seam, not imported by pipelines.
- `tools.medallion` (`medallion`, `Medallion`, `RAW`/`SILVER`/`GOLD`) — the
  application-level raw/silver/gold profile over the namespace Store. It is a
  sibling-package convention, *not* a `framework` facade; the medallion `Layer`
  enum was removed from `framework.core`.
- `framework.run.trace` (`RowTrace`) — the generic per-row trace mechanics behind
  `Pipeline.explain()`; reached through the builder, not imported directly.
- `framework.run.freshness` (`evaluate_requirement`, `FreshnessVerdict`) — the
  one rule deciding whether a declared upstream is current enough, shared by the
  runner's `FreshnessGuard` (which records and raises) and
  `tools.orchestration`'s plan preview (which renders), so the two cannot drift
  apart. The public `Requirement` / `FreshnessRequirement` types are
  defined here and re-exported through `framework.run`; the predicate itself is
  reached through the guard or the plan, not imported by pipeline scripts.
- `framework.run.builder` (`Node` and its subclasses) / `framework.run.execution`
  (`PipelineExecution`) — the one execution engine: the wired node graph the
  builder mints, rendered by `.describe()` and executed in topological order by
  `.run()`, against the per-run mutable state in `PipelineExecution`. Reached
  through `Pipeline`, not imported by pipeline scripts. (A second, never-wired
  step-based engine, `framework.run.pipeline_steps`, has been deleted.)
- `framework._internal.describe` (`render`, `redact_url`) — shared helpers for the opt-in
  `describe()` protocol; a component implements `describe()` using these
  to render its own safe plan summary, not imported by pipeline scripts.
- `framework._internal.identity` (`sha256_json`) — the one canonical encoding
  every deterministic id in this repository is hashed through: sorted keys,
  tight separators, `sha256`. Shared by `DeriveKey` and the SharePoint Reader's
  observation ids, so the two cannot drift; a live on-disk format, so changing
  it re-keys history. Not imported by pipeline scripts.
- `framework._internal.locations` (`file_location`, `table_location`) — the
  two-part `{namespace, name}` shape a Reader/Writer reports on
  `data_locations` for the run record; not imported by pipeline scripts.
- `tools.integrations.remote` (`RemoteRunner`, `StubbedRemoteRunner`, `SharePointFetcher`,
  `SharePointPusher`,
  …) and `tools.integrations.sharepoint_rest` (`SharePointListClient`,
  `StubbedSharePointListClient`)
  — the **stubbed remote-client seams** behind the `tools.integrations`
  `SasReader` / `SharePointReader` / `SharePointWriter` /
  `SharePointModifiedReader`; and `tools.integrations.locations`
  (`sharepoint_location`) — the one `{namespace, name}` shape those components
  report on `data_locations`, credentials stripped, kept in one copy because a
  second copy of that redaction is a second place to forget it. This lives in
  the `tools` sibling package (above), not a `framework` facade. An advanced extension
  point, documented in [adding-a-feed.md](adding-a-feed.md); not part of the day-to-day surface.
- Other helpers inside `framework.transform.quarantine` — implementation details
  behind the exported `SchemaValueRulePartitioner` and the builder's
  schema/quarantine flow.
- `framework._internal.schema` (the `ValueRule` protocol, the `RowCheck` carrier +
  `row_checks` decorator, the Python↔pandas type mapping, and the
  dataclass-annotation reading) — the shared core both schema adapters
  (`core.SchemaValidator`, `transform.SchemaCoercion`) derive from, so they
  stay consistent without depending on each other. The public `ValueRule` /
  `RowCheck` / `row_checks` names surface via `framework.core`; the rest is private.
- Names prefixed `_` anywhere (`_NullRunLog`, `_RegisteredPipeline`, …), and the
  run-log/runner internals not listed in a facade (`StepMetrics`,
  `FreshnessGuard`, `pipeline_label`).

Code examples throughout the docs import via the facades. The per-slice deep
docs may still name a primitive's **home module** in prose to locate the
implementation (e.g. the processors live in `framework.transform.processors`); that is
where the code is, but it is not how pipeline scripts import it. The one
exception in examples is `tools.integrations.remote`, shown in
[adding-a-feed.md](adding-a-feed.md) only to swap the stubbed remote fetcher or
pusher — internal seams with no facade.

## `tests.framework_testing` — a test-only surface

`tests.framework_testing` (`given_rows`, `given_csv`, `rows_of`, `make_dataset`,
`read_rows`, `without_columns`, `assert_rows_equal`, `RecordingWriter`,
`RecordingRunLog`, `read_run_log` — split internally into the
`tests.framework_testing.rows` and `tests.framework_testing.run_log` modules, both
re-exported from the package) is a **test-support**
surface for pipeline authors, documented in
[testing-helpers.md](testing-helpers.md). It is *not* one of the four runtime
facades and **application code must not import it at runtime** — only a module's
tests do (the [boundary test](../tests/integration/test_public_api.py) holds both
`pipelines/` and `case_review/` to the runtime facades, and `tests.framework_testing`
is not among them). It is intentional
public surface for tests, so unlike the internal modules below its names are
stable, but it carries no runtime role.

## The case-review application layer is separate

`case_review` (`CaseType`, `Variation`, `CasePool`, `ingest_silver_to_gold`, …)
is the application/domain layer that sits **on top of** the framework, not part
of its public API. New case-review concepts belong in `case_review` (or pipeline
support modules), not under `framework/` — see
[`test_framework_boundary.py`](../tests/integration/test_framework_boundary.py) and
[selection.md](selection.md).

As a layer *above* the framework, `case_review` is a **plain facade consumer** —
the same architectural position as `pipelines/` — so it imports the framework
only through the runtime facades, and the boundary test holds it there. The
two boundary tests are complementary: `test_framework_boundary.py` governs *where
domain code lives*, while `test_public_api.py` governs *how `case_review` imports
the framework*.

## Packaging — an explicit non-goal

Installing or distributing the framework as a package (`pip install`, a
`pyproject.toml`, semantic-version releases) is **not a near-term goal**. The
framework is deployed by being on `sys.path` and imported; pipelines run as
modules from the repo root (`python -m pipelines.<name>`). Defining this public
API is about a **stable in-repo surface and a clear public/internal split**, not
about preparing a distribution. If packaging is ever taken up, these facades are
the natural unit to version — but until then there is no version, no release
cadence, and no installable artifact.
