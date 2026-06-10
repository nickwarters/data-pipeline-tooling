# The public API — what pipeline authors import (#95)

The framework is **import-only** (on `sys.path`, never `pip install`ed — see
[CLAUDE.md](../CLAUDE.md) and *Packaging* below). This document is the contract
between the framework and the pipeline scripts that depend on it: it states
**which names are public**, **which modules are internal layout**, and the one
rule that follows from that split.

> **The rule.** Pipeline code imports from the three **facades** —
> `framework.io`, `framework.transform`, `framework.run` — never from the
> modules behind them. The facade names are the stable surface; the submodule
> paths can be reorganised without notice. A test
> (`tests/integration/test_public_api.py`) holds `pipelines/` to this boundary.

```python
from framework.io import CsvReader, StoreCatalog, RAW, Refresh
from framework.transform import Filter, Score, SchemaValidator, ColumnValidator
from framework.run import Pipeline, PipelineRunner, RunContext
```

The facades are thin re-export modules: `framework.transform.Filter` **is**
`framework.processors.Filter` (the same object). Nothing is reimplemented — the
facade only curates and groups.

## The three facades

Grouped by what a pipeline author reaches for: get data in/out, shape & check it,
compose & run it.

### `framework.io` — sources, sinks, stores

Moving data across the boundary.

| Names | What |
|-------|------|
| `Dataset` | The opaque bulk tabular carrier (pandas behind the seam). |
| `Reader`, `DatasetReader`, `CsvReader`, `GlobCsvReader`, `ExcelReader`, `SqliteReader`, `SasReader`, `SharePointReader` | The `read() -> Dataset` port and its concrete sources. |
| `Writer`, `CsvWriter`, `ExcelWriter`, `JsonWriter`, `SqliteTruncateReloadWriter`, `AccumulateByRunWriter`, `SqliteUpsertWriter`, `QuarantineWriter`, `SharePointWriter` | The `write(dataset)` port and its concrete sinks. |
| `RetryPolicy`, `RetryingReader`, `RetryingWriter` | Targeted retry for transient I/O-edge failures — see [retry.md](retry.md). |
| `Store`, `StoreCatalog`, `StoreBackend`, `DirectoryStoreBackend` | Per-subject medallions minted from shared configuration. |
| `Layer`, `RAW`, `SILVER`, `GOLD` | The medallion layer constants. |
| `Refresh`, `AccumulateByRun`, `UpsertStrategy` | The load strategies a Writer carries. |

### `framework.transform` — shaping & checking a feed mid-pipeline

| Names | What |
|-------|------|
| `Processor` | The `process(dataset) -> Dataset` seam. |
| `Filter`, `Score`, `Stamp`, `Sort`, `Rename`, `JoinDependency`, `JoinWith`, `AntiJoinWith`, `LatestPerKey`, `SelectColumns`, `Unpivot`, `DeriveKey`, `TopNPerGroup`, `SamplePerGroup` | The concrete Selection / Ingest / fan-out transforms. |
| `CoercionError` | Raised by `SchemaCoercion` on an uncastable value. |
| `Validator`, `ValidationError`, `ColumnValidator`, `RowCountValidator`, `VolumeAnomalyValidator`, `UniqueValidator`, `RunHistory` | The `validate(dataset)` checks (raise on breach). |
| `SchemaValidator`, `SchemaCoercion`, `ValueRule`, `Nullable`, `NonNull`, `Pattern`, `Length`, `Unique`, `OneOf` | The declared-schema contract + nullability/value-level rules. |
| `WorkingDayCalendar` | Availability arithmetic (pure utility). |

### `framework.run` — composing, executing, observing

| Names | What |
|-------|------|
| `Pipeline` | The deferred fluent builder (`.add_stage(...)`, `.describe()` for a pre-run plan, `.run()` to execute). |
| `Stage`, `ValidationStage`, `ProcessingStage`, `CheckpointStage` | Ordered stage contract and built-in stage types for validation, processing, and explicit checkpoint side effects inside one class-level `Pipeline` run. |
| `raw_to_silver`, `silver_to_gold`, `current_silver_to_gold`, `detail_current_silver_to_gold` | The layer-composing builders. |
| `ForEach`, `ForEachOutcome`, `ForEachPipelineError` | Independent per-item runs. |
| `PipelineRunner`, `RunContext`, `FreshnessRequirement`, `FreshnessError`, `UnknownPipelineError` | Thin domain orchestration + the freshness guard. |
| `RunLog`, `RunRegistry` | The structured-observability seam and its query store. |

## Internal modules — do not import from these

These are implementation detail. The facades draw from some of them, but the
**module paths and any name not re-exported above are not public** and may change
without notice:

- `framework.connection` (`connect`) — the connection factory seam (ADR-0001);
  used by Readers/Writers/Store, not by pipelines.
- `framework.sql` (`quote_identifier`) — the single place a table/column name is
  turned into a safely-quoted SQL identifier (issue #138); applied at every
  identifier interpolation across the SQLite seam, not imported by pipelines.
- `framework.layers` (`layer_name`, `LAYERS`) — internal layer-name validation;
  the public layer surface is `Layer`/`RAW`/`SILVER`/`GOLD` via `framework.io`.
- `framework.trace` (`RowTrace`) — the generic per-row trace mechanics behind
  `Pipeline.explain()`; reached through the builder, not imported directly.
- `framework.pipeline_steps` (`PipelineStep`, `PipelineExecution`, …) — the
  builder's internal ordered execution plan; inspected by `.describe()` and
  executed by `.run()`, not imported by pipeline scripts.
- `framework.describe` (`render`, `redact_url`) — shared helpers for the opt-in
  `describe()` protocol (#145); a component implements `describe()` using these
  to render its own safe plan summary, not imported by pipeline scripts.
- `framework.remote` (`RemoteRunner`, `StubbedRemoteRunner`, `SharePointFetcher`,
  `SharePointPusher`,
  …) — the **stubbed remote-client seam** behind `SasReader` / `SharePointReader`
  / `SharePointWriter` (ADR-0004/0005). An advanced extension point, documented in
  [adding-a-feed.md](adding-a-feed.md); not part of the day-to-day surface.
- `framework.quarantine` (`SchemaValueRulePartitioner`, …) — the value-rule
  quarantine partitioner; wired by the schema/quarantine flow.
- Names prefixed `_` anywhere (`_NullRunLog`, `_RegisteredPipeline`, …), and the
  run-log/runner internals not listed in a facade (`StepMetrics`,
  `FreshnessGuard`, `pipeline_label`).

Code examples throughout the docs import via the facades. The per-slice deep
docs may still name a primitive's **home module** in prose to locate the
implementation (e.g. the processors live in `framework.processors`); that is
where the code is, but it is not how pipeline scripts import it. The one
exception in examples is `framework.remote`, shown in
[adding-a-feed.md](adding-a-feed.md) only to swap the stubbed remote fetcher or
pusher — internal seams with no facade.

## `framework.testing` — a test-only surface

`framework.testing` (`given_rows`, `rows_of`, `make_dataset`, `read_rows`,
`RecordingWriter`, `RecordingRunLog`, `read_run_log`) is a **test-support**
surface for pipeline authors, documented in
[testing-helpers.md](testing-helpers.md). It is *not* one of the three runtime
facades and **pipeline code must not import it at runtime** — only a pipeline's
tests do (the [boundary test](../tests/integration/test_public_api.py) holds `pipelines/` to
the three facades, and `framework.testing` is not among them). It is intentional
public surface for tests, so unlike the internal modules below its names are
stable, but it carries no runtime role.

## The case-review application layer is separate

`case_review` (`CaseType`, `Variation`, `CasePool`, `ingest_silver_to_gold`, …)
is the application/domain layer that sits **on top of** the framework, not part
of its public API. New case-review concepts belong in `case_review` (or pipeline
support modules), not under `framework/` — see
[`test_framework_boundary.py`](../tests/integration/test_framework_boundary.py) and
[selection.md](selection.md).

## Packaging — an explicit non-goal

Installing or distributing the framework as a package (`pip install`, a
`pyproject.toml`, semantic-version releases) is **not a near-term goal**. The
framework is deployed by being on `sys.path` and imported; pipelines run as
modules from the repo root (`python -m pipelines.<name>`). Defining this public
API is about a **stable in-repo surface and a clear public/internal split**, not
about preparing a distribution. If packaging is ever taken up, these facades are
the natural unit to version — but until then there is no version, no release
cadence, and no installable artifact.
