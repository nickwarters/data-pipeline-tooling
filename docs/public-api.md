# The public API — what pipeline authors import (#95)

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
> `case_review/` to this boundary.

```python
from framework.core import Dataset, RAW, SILVER, GOLD
from framework.io import CsvReader, StoreCatalog, Refresh
from framework.transform import Filter, VectorizedFilter, SchemaCoercion
from framework.core import ColumnValidator, SchemaValidator, ValidationError
from framework.run import Pipeline, PipelineRunner, RunContext
from tools.retry import RetryPolicy
from tools.calendar import WorkingDayCalendar
```

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
  `dataset` (`Dataset`), `layers` (the medallion `Layer` / `RAW` / `SILVER` /
  `GOLD`), `protocols` (the small shared `Reader` / `Writer` / `Processor` /
  `Validator` shapes), and the **declared-schema contract** — the
  `validate(dataset)` `validators`, the `schema` check (`SchemaValidator`), and
  the `value_rules` (`Nullable` / `Pattern` / ...). It sits *below* the task
  facades.
- `framework/io/` — `readers`, `writers`, `store`, `strategy`, `sql`, `remote`.
- `framework/transform/` — the dataset-reshaping primitives: `processors`,
  `coercion` (`SchemaCoercion` — the *coerce* half of the schema adapter),
  `quarantine`.
- `framework/run/` — `builder`, `execution`, `pipeline_steps`,
  `trace`, `runner`, `run_context`. It also re-exports the observability seam
  (`RunLog`, `RunRegistry`) that lives in the sibling `tools.observability`
  package.

One non-facade package sits inside `framework/`, and two more are top-level
siblings beside it:

- `framework/_internal/` — cross-cutting helpers with **no** public name:
  `connection` (`connect`), `describe` (`render` / `redact_url`), and `schema`
  (the shared `ValueRule` protocol + the Python↔pandas type mapping and
  annotation reading both schema adapters derive from). The leading underscore
  marks it private; nothing outside the framework imports from here.
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
| `Layer`, `RAW`, `SILVER`, `GOLD` | The medallion layer constants. |
| `Reader`, `Writer`, `Processor`, `Validator`, `Severity` | Shared protocols used by framework internals and available for advanced typing. Concrete implementations still live on their task facades. |
| `Validator`, `ValidationError` | The check seam and the error it raises. |
| `ColumnValidator`, `RowCountValidator`, `VolumeAnomalyValidator`, `UniqueValidator`, `SchemaDriftValidator` | The concrete structural / volume / uniqueness / drift checks that *gate* a feed — they raise on breach rather than reshaping. Composed onto a `Pipeline` as pre/post validators. |
| `RunHistory`, `PriorColumns` | History inputs the run-aware checks read. |
| `SchemaValidator` | The declared-schema check: a Case Type dataclass's columns + dtypes + nullability + value rules + row checks, enforced at silver (and optionally gold). |
| `ValueRule`, `Nullable`, `NonNull`, `Pattern`, `Length`, `Range`, `Unique`, `OneOf` | The declared-schema value-level contract (`Annotated` field rules) the schema check runs. |
| `RowCheck`, `row_checks` | The declared-schema **row check** contract: cross-field checks over the relationship between a row's fields, declared via the `@row_checks(...)` class decorator (the horizontal sibling to the value rules). |
| `PipelineError` | The base of the expected, fail-fast failure family — `ValidationError`, `FreshnessError`, `UnknownPipelineError`, `CoercionError`, `ForEachPipelineError` all subclass it. Catch it at a run boundary to handle any deliberate abort with one `except`; a genuine bug is not a `PipelineError` and keeps its traceback. |
| `format_failure` | Renders a caught `PipelineError` as a short, traceback-free ASCII block for `stderr` (the failure kind + its message). A pure formatter — it never catches, suppresses, or exits, so the caller keeps control flow. |

### `framework.io` — sources, sinks, stores

Moving data across the boundary.

| Names | What |
|-------|------|
| `Reader`, `DatasetReader`, `CsvReader`, `GlobCsvReader`, `ExcelReader`, `SqliteReader` | The `read() -> Dataset` port and its concrete sources. (The remote `SasReader` / `SharePointReader` live in `tools.integrations`, not this facade — see below.) |
| `Writer`, `CsvWriter`, `ExcelWriter`, `JsonWriter`, `SqliteTruncateReloadWriter`, `AccumulateByRunWriter`, `SqliteUpsertWriter`, `QuarantineWriter`, `StdoutWriter` | The `write(dataset)` port and its concrete sinks (`StdoutWriter` is a console sink for *seeing* a result — e.g. an explainer trace — rather than persisting it). (The remote `SharePointWriter` lives in `tools.integrations`, not this facade — see below.) |
| `Store`, `StoreCatalog`, `StoreBackend`, `DirectoryStoreBackend` | Per-subject medallions minted from shared configuration. |
| `Refresh`, `AccumulateByRun`, `UpsertStrategy` | The load strategies a Writer carries. |

### `framework.transform` — reshaping a feed mid-pipeline

| Names | What |
|-------|------|
| `Processor` | The mid-pipeline transform seam — `Callable[..., Dataset]`: one or more `Dataset`s in (one per wired upstream node), exactly one out. |
| `Filter`, `Score`, `VectorizedFilter`, `VectorizedDerive`, `Stamp`, `Sort`, `Rename`, `Parse`, `SplitColumn`, `JoinColumns`, `Zfill`, `IntegerText`, `JoinDependency`, `JoinWith`, `AntiJoinWith`, `LatestPerKey`, `SelectColumns`, `DropColumns`, `Unpivot`, `DeriveKey`, `TopNPerGroup`, `Sample`, `SamplePerGroup` | The concrete Selection / Ingest / fan-out transforms. |
| `SchemaCoercion` | The *coerce* half of the schema adapter: casts round-trip-lossy columns (`date` / `datetime` / `bool`) to the declared types — a reshape, so it lives here, not with the schema check. |
| `CoercionError` | Raised by `SchemaCoercion` on an uncastable value. |

### `framework.run` — composing, executing, observing

| Names | What |
|-------|------|
| `Pipeline` | The deferred DAG builder. Nodes are declared explicitly — `.read` / `.transform` / `.validate` / `.write` (plus `.action` / `.explain` / `.quarantine`) each return a wired node that later steps depend on; `.describe()` renders the pre-run plan and `.run()` executes it in topological order. The dataset→dataset transform extension point is any `Dataset -> Dataset` callable passed to `.transform` (`framework.transform` ships `Score` / `Filter` / `JoinWith`). |
| `run_pipeline`, `PipelineRunner`, `RunContext`, `FreshnessRequirement`, `FreshnessError`, `UnknownPipelineError` | The `run_pipeline` execution core (used by the path-addressed `run` command) + the thin domain runner and freshness guard. |
| `RunLog`, `RunRegistry` | The structured-observability seam and its query store (re-exported here from `tools.observability`). |

## The `tools` package — sibling utilities

`tools` is a top-level package beside `framework`, not a framework facade. Its
public helpers carry stable names and are imported directly:

| Import | What |
|--------|------|
| `tools.retry` — `RetryPolicy`, `RetryingReader`, `RetryingWriter` | Targeted retry for transient I/O-edge failures — see [retry.md](retry.md). |
| `tools.calendar` — `WorkingDayCalendar` | Working-day availability arithmetic (pure utility). |
| `tools.orchestration` — `Orchestrator`, `PipelineSet`, `ScheduledPipeline`, `Weekdays`, `SpecificWeekdays`, `DayOfMonth`, `NthWorkingDayOfMonth`, `LastWorkingDayOfMonth`, `ManualOnly` | Scheduled orchestration above `PipelineRunner`: evaluate due work for a run date, isolate failures by scheduled item/PipelineSet, and record decisions in `_orchestration/runs.db`. |
| `tools.observability` — `RunLog`, `RunRegistry` | The structured-observability seam and its query store (also re-exported via `framework.run`). |
| `tools.integrations.remote` — `SasReader`, `SharePointReader`, `SharePointWriter` | The remote-source/sink Reader and Writer (SAS extract, SharePoint list) — same `read()` / `write()` ports as the file/SQLite ones, but reaching a remote client that is **stubbed** behind swappable seams (`RemoteRunner`, `SharePointFetcher` / `SharePointPusher`) until the on-prem SE client (NTLM/Kerberos/REST) lands (ADR-0004/0005). |

## Internal modules — do not import from these

These are implementation detail. The facades draw from some of them, but the
**module paths and any name not re-exported above are not public** and may change
without notice:

- `framework._internal.connection` (`connect`) — the connection factory seam (ADR-0001);
  used by Readers/Writers/Store, not by pipelines.
- `framework.io.sql` (`quote_identifier`) — the single place a table/column name is
  turned into a safely-quoted SQL identifier (issue #138); applied at every
  identifier interpolation across the SQLite seam, not imported by pipelines.
- `framework.core.layers` (`layer_name`, `LAYERS`) — internal layer-name validation;
  the public layer surface is `Layer`/`RAW`/`SILVER`/`GOLD` via `framework.core`.
- `framework.run.trace` (`RowTrace`) — the generic per-row trace mechanics behind
  `Pipeline.explain()`; reached through the builder, not imported directly.
- `framework.run.pipeline_steps` (`PipelineStep`, `PipelineExecution`, …) — the
  builder's internal ordered execution plan; inspected by `.describe()` and
  executed by `.run()`, not imported by pipeline scripts.
- `framework._internal.describe` (`render`, `redact_url`) — shared helpers for the opt-in
  `describe()` protocol (#145); a component implements `describe()` using these
  to render its own safe plan summary, not imported by pipeline scripts.
- `tools.integrations.remote` (`RemoteRunner`, `StubbedRemoteRunner`, `SharePointFetcher`,
  `SharePointPusher`,
  …) — the **stubbed remote-client seam** behind the `tools.integrations`
  `SasReader` / `SharePointReader` / `SharePointWriter` (ADR-0004/0005). This lives in
  the `tools` sibling package (above), not a `framework` facade. An advanced extension
  point, documented in [adding-a-feed.md](adding-a-feed.md); not part of the day-to-day surface.
- `framework.transform.quarantine` (`SchemaValueRulePartitioner`, …) — the
  value-rule / row-check quarantine partitioner; wired by the schema/quarantine flow.
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
only through the runtime facades, and the boundary test holds it there (#159). The
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
