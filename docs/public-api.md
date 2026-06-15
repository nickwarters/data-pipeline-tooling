# The public API — what pipeline authors import (#95)

The framework is **import-only** (on `sys.path`, never `pip install`ed — see
[CLAUDE.md](../CLAUDE.md) and *Packaging* below). This document is the contract
between the framework and the pipeline scripts that depend on it: it states
**which names are public**, **which modules are internal layout**, and the one
rule that follows from that split.

> **The rule.** Application code — both `pipelines/` and the `case_review/`
> domain layer — imports from the six **facades** — `framework.core`,
> `framework.io`, `framework.transform`, `framework.validate`, `framework.run`,
> `framework.shared` — never from the modules behind them. The facade names are
> the stable surface; the submodule paths can be reorganised without notice. A
> test (`tests/integration/test_public_api.py`) holds both `pipelines/` and
> `case_review/` to this boundary.

```python
from framework.core import Dataset, RAW, SILVER, GOLD
from framework.io import CsvReader, StoreCatalog, Refresh
from framework.transform import Filter, VectorizedFilter, SchemaCoercion
from framework.validate import ColumnValidator, SchemaValidator, ValidationError
from framework.run import Pipeline, PipelineRunner, RunContext
from framework.shared import RetryPolicy, WorkingDayCalendar
```

For interactive discovery, `import framework` exposes only those facade modules:

```python
import framework

framework.__all__  # ["core", "io", "transform", "validate", "run", "shared"]
framework.core.Dataset
framework.io.CsvReader
framework.transform.Filter
framework.validate.ColumnValidator
framework.run.Pipeline
framework.shared.WorkingDayCalendar
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
  `dataset` (`Dataset`) and `layers` (the medallion `Layer` / `RAW` / `SILVER` /
  `GOLD`). It sits *below* the task facades and depends on nothing.
- `framework/io/` — `readers`, `writers`, `store`, `strategy`, `sql`, `remote`.
- `framework/transform/` — the dataset-reshaping primitives: `processors`,
  `coercion` (`SchemaCoercion` — the *coerce* half of the schema adapter),
  `quarantine`.
- `framework/validate/` — checking, not reshaping: the `validate(dataset)`
  `validators`, the declared-schema check `schema` (`SchemaValidator`), and the
  `value_rules` (`Nullable` / `Pattern` / ...). They raise on breach, so they
  form their own facade apart from the transforms.
- `framework/run/` — `builder`, `stages`, `pipeline_steps`, `trace`, `silver`,
  `gold`, `orchestration`, `runner`, `run_context`, `run_log`, `run_registry`.
- `framework/shared/` — cross-cutting utilities that carry a public name but
  don't belong to a task facade: `retry` (`RetryPolicy` & friends) and
  `calendar` (`WorkingDayCalendar`).

Two non-facade packages sit beside them:

- `framework/_internal/` — cross-cutting helpers with **no** public name:
  `connection` (`connect`), `describe` (`render` / `redact_url`), and `schema`
  (the shared `ValueRule` protocol + the Python↔pandas type mapping and
  annotation reading both schema adapters derive from). The leading underscore
  marks it private; nothing outside the framework imports from here.
- `framework/testing/` — the test-only support surface (below).

These sub-package paths are the *internal layout*; only the six facade names
(`framework.core` / `framework.io` / `framework.transform` / `framework.validate`
/ `framework.run` / `framework.shared`) are the stable runtime import surface.
`framework.testing` is the separate test-only surface, and `framework._internal`
is private.

## The facades

Grouped by what a pipeline author reaches for: the base vocabulary, get data
in/out, reshape it, check it, compose & run it, plus cross-cutting utilities.

### `framework.core` — the foundational data vocabulary

The two nouns every pipeline names regardless of task — what flows, and where it
lands. They sit below the task facades; everything else builds on them.

| Names | What |
|-------|------|
| `Dataset` | The opaque bulk tabular carrier (pandas behind the seam) that flows through every Reader, Processor, Validator, and Writer. |
| `Layer`, `RAW`, `SILVER`, `GOLD` | The medallion layer constants. |

### `framework.io` — sources, sinks, stores

Moving data across the boundary.

| Names | What |
|-------|------|
| `Reader`, `DatasetReader`, `CsvReader`, `GlobCsvReader`, `ExcelReader`, `SqliteReader`, `SasReader`, `SharePointReader` | The `read() -> Dataset` port and its concrete sources. |
| `Writer`, `CsvWriter`, `ExcelWriter`, `JsonWriter`, `SqliteTruncateReloadWriter`, `AccumulateByRunWriter`, `SqliteUpsertWriter`, `QuarantineWriter`, `SharePointWriter` | The `write(dataset)` port and its concrete sinks. |
| `Store`, `StoreCatalog`, `StoreBackend`, `DirectoryStoreBackend` | Per-subject medallions minted from shared configuration. |
| `Refresh`, `AccumulateByRun`, `UpsertStrategy` | The load strategies a Writer carries. |

### `framework.transform` — reshaping a feed mid-pipeline

| Names | What |
|-------|------|
| `Processor` | The `process(dataset) -> Dataset` seam. |
| `Filter`, `Score`, `VectorizedFilter`, `VectorizedDerive`, `Stamp`, `Sort`, `Rename`, `JoinDependency`, `JoinWith`, `AntiJoinWith`, `LatestPerKey`, `SelectColumns`, `DropColumns`, `Unpivot`, `DeriveKey`, `TopNPerGroup`, `SamplePerGroup` | The concrete Selection / Ingest / fan-out transforms. |
| `SchemaCoercion` | The *coerce* half of the schema adapter: casts round-trip-lossy columns (`date` / `datetime` / `bool`) to the declared types — a reshape, so it lives here, not with the schema check. |
| `CoercionError` | Raised by `SchemaCoercion` on an uncastable value. |

### `framework.validate` — declaring & enforcing the data contract

The checks that *gate* a feed: they raise on breach rather than reshaping, so
they sit on their own facade. Composed onto a `Pipeline` as pre/post validators.

| Names | What |
|-------|------|
| `Validator`, `ValidationError` | The check seam and the error it raises. |
| `ColumnValidator`, `RowCountValidator`, `VolumeAnomalyValidator`, `UniqueValidator`, `SchemaDriftValidator` | The concrete structural / volume / uniqueness / drift checks. |
| `RunHistory`, `PriorColumns` | History inputs the run-aware checks read. |
| `SchemaValidator` | The declared-schema check: a Case Type dataclass's columns + dtypes + nullability + value rules, enforced at silver (and optionally gold). |
| `ValueRule`, `Nullable`, `NonNull`, `Pattern`, `Length`, `Unique`, `OneOf` | The declared-schema value-level contract (`Annotated` field rules) the schema check runs. |

### `framework.run` — composing, executing, observing

| Names | What |
|-------|------|
| `Pipeline` | The deferred fluent builder (`.add_stage(...)`, `.describe()` for a pre-run plan, `.run()` to execute). |
| `ValidationStage`, `ProcessingStage`, `CheckpointStage` | Built-in ordered stage types for validation, processing, and explicit checkpoint side effects inside one class-level `Pipeline` run, composed via `.add_stage(...)`. Each is a spec that compiles to the internal step plan `.run()` executes — there is no public custom-`Stage` contract; the dataset→dataset transform extension point is the `Processor` (`framework.transform`). |
| `raw_to_silver`, `silver_to_gold`, `current_silver_to_gold`, `detail_current_silver_to_gold` | The layer-composing builders. |
| `ForEach`, `ForEachOutcome`, `ForEachPipelineError` | Independent per-item runs. |
| `PipelineSet`, `ScheduledPipeline`, `Weekdays`, `SpecificWeekdays`, `DayOfMonth`, `NthWorkingDayOfMonth`, `LastWorkingDayOfMonth`, `ManualOnly`, `Orchestrator` | Scheduled orchestration above `PipelineRunner`: evaluate due work for a run date, isolate failures by scheduled item/PipelineSet, and record decisions in `_orchestration/runs.db`. |
| `PipelineRunner`, `RunContext`, `FreshnessRequirement`, `FreshnessError`, `UnknownPipelineError` | Thin domain runner + the freshness guard. |
| `RunLog`, `RunRegistry` | The structured-observability seam and its query store. |

### `framework.shared` — cross-cutting utilities

Small helpers that carry a public name but don't belong to a single task facade.

| Names | What |
|-------|------|
| `RetryPolicy`, `RetryingReader`, `RetryingWriter` | Targeted retry for transient I/O-edge failures — see [retry.md](retry.md). |
| `WorkingDayCalendar` | Working-day availability arithmetic (pure utility). |

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
- `framework.io.remote` (`RemoteRunner`, `StubbedRemoteRunner`, `SharePointFetcher`,
  `SharePointPusher`,
  …) — the **stubbed remote-client seam** behind `SasReader` / `SharePointReader`
  / `SharePointWriter` (ADR-0004/0005). An advanced extension point, documented in
  [adding-a-feed.md](adding-a-feed.md); not part of the day-to-day surface.
- `framework.transform.quarantine` (`SchemaValueRulePartitioner`, …) — the value-rule
  quarantine partitioner; wired by the schema/quarantine flow.
- `framework._internal.schema` (the `ValueRule` protocol, the Python↔pandas type
  mapping, and the dataclass-annotation reading) — the shared core both schema
  adapters (`validate.SchemaValidator`, `transform.SchemaCoercion`) derive from,
  so they stay consistent without depending on each other. The public `ValueRule`
  name surfaces via `framework.validate`; the rest is private.
- Names prefixed `_` anywhere (`_NullRunLog`, `_RegisteredPipeline`, …), and the
  run-log/runner internals not listed in a facade (`StepMetrics`,
  `FreshnessGuard`, `pipeline_label`).

Code examples throughout the docs import via the facades. The per-slice deep
docs may still name a primitive's **home module** in prose to locate the
implementation (e.g. the processors live in `framework.transform.processors`); that is
where the code is, but it is not how pipeline scripts import it. The one
exception in examples is `framework.io.remote`, shown in
[adding-a-feed.md](adding-a-feed.md) only to swap the stubbed remote fetcher or
pusher — internal seams with no facade.

## `framework.testing` — a test-only surface

`framework.testing` (`given_rows`, `given_csv`, `rows_of`, `make_dataset`,
`read_rows`, `without_columns`, `assert_rows_equal`, `RecordingWriter`,
`RecordingRunLog`, `read_run_log` — split internally into the
`framework.testing.rows` and `framework.testing.run_log` modules, both
re-exported from the package) is a **test-support**
surface for pipeline authors, documented in
[testing-helpers.md](testing-helpers.md). It is *not* one of the five runtime
facades and **application code must not import it at runtime** — only a module's
tests do (the [boundary test](../tests/integration/test_public_api.py) holds both
`pipelines/` and `case_review/` to the runtime facades, and `framework.testing`
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
