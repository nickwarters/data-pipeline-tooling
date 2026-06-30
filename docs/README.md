# Usage guide — building & running pipelines

This is the **read-me-first** entry point for the data pipeline framework. It
gives you the shape of the system (Concepts), a one-line index of every building
block (Primitives reference), and the three task-oriented walkthroughs you reach
for most (How-to). Each section links out to the deep per-slice doc for the full
treatment and to the ADR for the *why*.

The framework ingests data about reviewable work from many heterogeneous
sources, refines it through medallion layers, and exposes it to review workflows
through clean domain abstractions (a `CasePool` of `Case`s) instead of raw
`pandas.read_*` calls.

- **The language** — every domain noun (Case, Feed, CasePool, SelectionPool,
  Reference Data, …) is defined once in [`../CONTEXT.md`](../CONTEXT.md). This
  guide uses those terms; that file is the glossary.
- **The decisions** — every "why is it built this way?" lives in an ADR under
  [`adr/`](adr/). They are referenced inline below.
- **Cross-platform** — the deployment target is **Windows**, with **macOS** as
  the development environment. Paths are `pathlib`, processing is pure Python,
  and dependencies are first-class on both (see [`../CLAUDE.md`](../CLAUDE.md)).

---

## Developer commands

Run commands from the repository root so the import-only `framework/` package is
on `sys.path`.

```sh
.venv/bin/python -m pytest
.venv/bin/python -m ruff check .
.venv/bin/python -m ruff format --check .
```

Use the same module form on Windows after activating `.venv`:

```bat
python -m pytest
python -m ruff check .
python -m ruff format --check .
```

---

## Concepts

### The four Pipelines form a loop

The platform is four end-to-end **Pipelines**, each refining data through its own
medallion store(s). They form a bidirectional loop: Cases flow *out* to the
review platform, Review Outcomes flow *back* for reporting.

```
                       Feeds (Excel, CSV, SAS, SharePoint, …)
                                     │
                                     ▼
        ┌──────────────┐      ┌──────────────┐   Deliverable    ┌──────────────────┐
        │   Ingest     │─────▶│  Selection   │─────────────────▶│  review platform │
        │ per Case Type│ Case │ per Case Type│  (SelectionPool  │  (not ours)      │
        └──────────────┘ Pool └──────────────┘   to SharePoint) └──────────────────┘
                                                                          │
                                                            Review Outcomes (a Feed)
                                                                          ▼
        ┌──────────────┐      Outcomes joined to        ┌──────────────┐
        │  Reporting   │◀─────  selected Cases  ────────│     Sync     │
        │ platform-wide│        Deliverables            │ platform-wide│
        └──────────────┘                                └──────────────┘
```

- **Ingest** (per Case Type) brings a Case Type's source **Feeds** in and refines
  them into **Cases**. Its clean output is the **CasePool**.
- **Selection** (per Case Type) reads the CasePool, narrows it (filter / score /
  sort / sample / join), and produces the **SelectionPool** — the Cases chosen
  for review — which it both lands in gold (audit) and emits to the review
  platform as a **Deliverable**.
- *The review platform (not part of this framework) reviews the Cases.*
- **Sync** (platform-wide) pulls the platform's state — the returned **Review
  Outcomes** and its full picture of each Case — back in as its own Feed.
- **Reporting** (platform-wide) joins Review Outcomes to the selected Cases and
  emits **Deliverables**.

**Ingest** and **Selection** are **per Case Type**; **Sync** and **Reporting**
are **platform-wide**. Note "Pipeline" the domain phase is distinct from the
`Pipeline` *builder class* (see Primitives) — a phase composes one or more
builder runs.

### The medallion layers (raw → silver → gold)

Every Pipeline reuses the **same** three-layer medallion. A **subject**
(a Case Type, or a shared Reference Data set) owns its own medallion — three
SQLite databases `<subject>/{raw,silver,gold}.db` on a network share, isolated
from every other subject's files for blast-radius containment and independent
onboarding ([ADR-0001](adr/0001-sqlite-per-subject-medallion-store.md)).
The medallion is an **application-level profile** (`tools.medallion`), not
framework vocabulary (#232): the framework stores an opaque `namespace` → file,
and `medallion(registry, subject)` exposes the `.raw` / `.silver` / `.gold`
namespace Stores. Each layer Store mints `writer(table, strategy)` /
`reader(table)` over its file.

| Layer  | Generic guarantee | Discipline |
|--------|-------------------|------------|
| **raw**   | Landed source data with minimal framework interpretation. | Keep it faithful and diagnosable; the caller still chooses `Refresh()` or `AccumulateByRun(...)`. |
| **silver** | Refined data that has crossed declared validation and normalisation checks. | Coerce/repair storage-lossy types where needed, validate, then write using the caller's explicit strategy. |
| **gold**  | Consumption-ready data for the pipeline's caller. | Enforce the pipeline-specific consumption contract, such as current grain or audit history, with an explicit strategy. |

Case-review meanings are layered on top by the application code: Ingest may make
gold the current CasePool, Selection may make gold an accumulating SelectionPool,
and Sync may make gold review-platform history. Those meanings are common
case-review profiles, not framework guarantees. Common boundaries still apply by
convention: silver is often the schema boundary
([ADR-0006](adr/0006-graduated-schema-enforcement.md)) and gold is often the
consumption/grain boundary
([ADR-0009](adr/0009-case-identity-and-gold-grain.md)).

> **Load strategy is per-feed, owned by the Writer** — the Store maps `layer →
> location` only ([ADR-0004](adr/0004-per-feed-load-strategy-owned-by-writer.md)). "Refresh upstream / accumulate downstream" is a common profile,
> not a framework law. The **Ingest** profile is *history-upstream /
> current-gold* (raw + silver accumulate the change-over-time record; gold
> reduces to one current row per Case). See the deep docs below for the full load model.

### How the pieces fit

A **Feed** is read by a **Reader** into a **Dataset** (the opaque tabular
carrier), composed into a **Pipeline** builder, optionally **coerced** /
**validated** / **processed**, and handed to a **Writer** the **Store** mints for
the target layer. The **CasePool** then reads the ingested silver and surfaces
**Cases** through intention-revealing retrievals; the **Selection** pipeline
narrows them into the **SelectionPool**. Every `.run()` is fail-fast and atomic,
and emits a structured **RunLog**. Repeated independent runs can choose their
own orchestration policy: `ForEach` is fail-fast by default, or explicit
best-effort when later items should continue after one item fails. Scheduled
work uses `Orchestrator` above `PipelineRunner`: it evaluates the day's due
`PipelineSet`s, enforces freshness dependencies, isolates failures, and records
its decisions in a separate orchestration store.

---

## Primitives reference

The foundational vocabulary. Each links to its deep doc; the consolidated
reference with worked examples is [`core-primitives.md`](core-primitives.md).

> **Importing.** Application code (`pipelines/` + `case_review/`) imports these through the public **facades**
> — `framework.core` (`Dataset` plus the
> declared-schema contract: the `validate(dataset)` checks, `SchemaValidator`, the
> value rules, and the row checks), `framework.io` (sources/sinks/stores),
> `framework.transform` (the reshaping processors + `SchemaCoercion`), and
> `framework.run` (the `Pipeline` builder, runner, observability)
> — not from the modules behind them. The cross-cutting `retry` / `calendar` /
> orchestration / observability utilities are a sibling top-level `tools` package,
> not a facade. The facade names are the stable surface.
> `import framework` exposes only those facade modules for discovery; it is
> not a shortcut for
> `framework.CsvReader` / `framework.Filter` / `framework.Pipeline`. See
> [`public-api.md`](public-api.md) for the full member list, the
> internal-module boundary, and why packaging is an explicit non-goal.

| Primitive | What it is / when to use it |
|-----------|------------------------------|
| **`Dataset`** | The opaque, bulk in-memory **tabular carrier** — pandas behind the seam, swappable later. Tiny public surface (`.columns`, `len()`); pandas never leaks past it. ([ADR-0002](adr/0002-python-processing-opaque-dataset-carrier.md)) |
| **`Reader`** | `read() -> Dataset`. One per source shape: `CsvReader`, `GlobCsvReader`, `ExcelReader`, `SqliteReader`, and the stubbed-remote `SasReader` / `SharePointReader`. Swap the Reader to ingest the same feed from a different source. → [adding-a-feed.md](adding-a-feed.md) |
| **`ChunkReader`** | `chunks(size) -> Iterator[Dataset]`. The **streaming dual** of `Reader` for a source too big to hold whole — yields *bounded* Datasets (default 10,000 rows), so the in-memory contract holds per chunk. `ChunkedCsvReader` (local CSV) and `SasFileReader` (an **already-landed** `.sas7bdat`/xport file, gzip read on the fly — distinct from the remote `SasReader`: no script, no remote run, no copy). Wrap any of them in `KeyFilterChunkReader(inner, key_column, allowed_keys)` to keep only rows whose key is in an id allow-list (semi-join, keys type-normalised) — or `PredicateChunkReader` for an arbitrary per-chunk filter — applied **before accumulation** so a 100M-row source lands just the ~100K rows wanted, with bounded memory; both expose `rows_scanned` / `rows_kept`. Drive the streaming loop (read→filter→write) under one fail-fast JSONL run-log step with `tools.observability.stream_step`. → [streaming-large-sources.md](streaming-large-sources.md) |
| **`Writer`** | `write(dataset) -> None`. The dual of Reader. Owns **both** target location and **load strategy**. File Deliverables use `CsvWriter`, `ExcelWriter`, or `JsonWriter`; SharePoint list Deliverables use the stubbed `SharePointWriter`; SQLite tables use `SqliteTruncateReloadWriter` or `AccumulateByRunWriter`; `StdoutWriter` is a console sink for *seeing* a result (e.g. an explainer trace) rather than persisting it. → [gold-accumulation.md](gold-accumulation.md) |
| **`RetryPolicy` / `RetryingReader` / `RetryingWriter`** | Targeted retry for **transient I/O-edge failures** (remote access, SharePoint/SAS fetch, SQLite busy). An allowlist of exception types is retried; schema-validation and configuration errors abort immediately. Scoped to the `read()`/`write()` seam, never around validation. → [retry.md](retry.md) |
| **`Store` / `StoreRegistry`** (`tools.store`) | A Store binds one **namespace** (a logical database → file) to `writer(table, strategy)` / `reader(table)` creation; `StoreRegistry(root).store(namespace)` mints those from shared root/configuration, and `StoreRegistry.register(name, reader\|writer)` → `reader(name)` / `writer(name)` keeps named components a pipeline refers to by name. The raw/silver/gold medallion is the `tools.medallion` profile over it (`<subject>/{raw,silver,gold}.db`). Holds no business logic and makes no load decision. **Application infrastructure in the sibling `tools` package, not `framework.io`** (#232). ([ADR-0001](adr/0001-sqlite-per-subject-medallion-store.md)) |
| **`Validator`** | `validate(dataset) -> None`, **raises** on breach. `ColumnValidator`, `RowCountValidator` (engine-agnostic), `VolumeAnomalyValidator` (trips when a run's volume deviates from its recent-history baseline — catches truncated source exports), `SchemaDriftValidator` (warns at the raw boundary when a feed's columns drift from the prior run's landed set — catches owner-controlled source schema change). Severity (`error`/`warn`) is set where it's attached. |
| **`Schema` / `SchemaValidator`** | A Case Type **dataclass** whose annotations *are* the column, dtype, nullability, and value-rule contract; the validator is the dataclass→validator adapter, enforced at silver (and optionally gold). Nullability/value rules extend the same dataclass via `Annotated`; cross-field **row checks** attach via the `@row_checks(...)` class decorator. → [schema-enforcement.md](schema-enforcement.md) ([ADR-0006](adr/0006-graduated-schema-enforcement.md)) |
| **`Processor`** | a callable `(dataset) -> Dataset`, run mid-pipeline via a named `.task(...)` (`.transform(...)` remains compatible). `SchemaCoercion` (repair storage-lossy types); the Selection transforms `Filter` / `Score` / `VectorizedFilter` / `VectorizedDerive` / `Sort` / `Rename` / `Stamp`, the explicit-dependency cross-feed `JoinWith` / `AntiJoinWith`; the column-shaping `JoinColumns`; and the Ingest / fan-out transforms `SelectColumns` / `DropColumns` / `Unpivot` / `DeriveKey` / `LatestPerKey`. → [processors.md](processors.md) |
| **Pipeline tasks** | A `Pipeline` is wired from named **tasks**, each returning a node the next consumes: `.read(reader)`, `.task(name, processor)`, `.validate(validator)`, `.write(writer)`, `.profile(...)`, and `.explain(...)`. Order and any fan-in / fan-out are explicit in how nodes are wired — validation, processing, and explicit checkpoint writes land exactly where you place them. |
| **`Profile`** (data profiling) | A read-only task `p.profile(profiler, node)` that records per-column **null rate / distinct count / min-max / bounded top-N** on the run log so a feed's *shape* is trended across runs (the statistical sibling of the row-count volume guardrail). The computation is an injected `tools.observability.profile.DataProfiler` (the framework's `DatasetProfiler` port — `tools` is never imported down into `framework`); it bounds cost via `top_n` / a column allow-list and, with a baseline, warns (or fails via `ProfileError`) when a column's null rate drifts from its recent-history baseline — catching a column that quietly slides 5% → 60% null. → [core-primitives.md](core-primitives.md) |
| **`Pipeline`** (builder) | The deferred DAG builder: `p = Pipeline(name)`, then wire tasks — `r = p.read(reader, name=...)`, `v = p.task("normalise", processor, r)` or `p.validate(..., r, name=...)`, `p.write(writer, v, name=...)`. It builds one ordered plan; call `.describe()` to inspect it without executing, then `.run(context=…)` to execute fail-fast and atomic with RunLog observability. ([ADR-0003](adr/0003-deferred-dag-composition.md)) |
| **`RunAddress`** | A stable dependency-target address for a whole Pipeline or a named run step inside one. Labels are `pipeline`, `subject/pipeline`, `pipeline.step`, or `subject/pipeline.step` (for example `pipeline_2.step_4`). The builder records this as `step_address`, and the run registry can query it with `records_for_address(...)`, `has_successful_address(...)`, and `latest_success(...)`. Construct with `RunAddress.pipeline(...)` / `RunAddress.step(...)`, parse with `RunAddress.parse(label)`. Invalid labels raise config-category `RunAddressError`. |
| **`ForEach`** | Runnable orchestration for independent repeated runs: pass items plus `pipeline_builder(item, context)`, then call `.run(context)`. It creates a fresh builder and per-item `RunContext` for each item. Default behavior fails fast on the first failed item; `continue_on_error=True` returns per-item success/failure outcomes and continues. Use when files must remain separate logical runs. |
| **`DatedFileDiscovery` / `SourceArtifact`** | Source-artifact discovery for dated-file catch-up (`tools.discovery`). `DatedFileDiscovery(directory, pattern)` finds files whose names encode a business date (e.g. `"claims_{date:%Y%m%d}_*.csv"`). `.available_between(start, end)` returns `SourceArtifact` value objects (each with `path`, `business_date`, `file_id`) where `start < business_date <= end`, sorted deterministically. Use with `ForEach` when each file needs its own run history and idempotency key. Use `GlobCsvReader` instead when all files together form one logical batch. → [core-primitives.md](core-primitives.md) |
| **`Orchestrator` / `PipelineSet` / `ScheduledPipeline`** | Scheduled due-work orchestration above `PipelineRunner`. Python definitions own sets, dependencies, and default schedules; YAML can override enablement, schedule timing, and freshness windows. A single pass or bounded loop runs due items for one run date, marks failed items terminal, blocks their downstream dependants, and lets independent items and other sets continue. |
| **`PipelineError` / `format_failure`** | The base of the expected fail-fast failure family (`ValidationError`, `FreshnessError`, `UnknownPipelineError`, `RunAddressError`, `CoercionError`, `ForEachPipelineError` all subclass it) and the pure formatter that renders a caught one as a short, traceback-free block for `stderr`. At a run boundary — the operator CLI, a scaffolded `main()` — `except PipelineError` + `format_failure(exc)` turns a deliberate abort into a clear message; a genuine bug is not a `PipelineError` and keeps its trace. |
| **`RunLog` / `RunRegistry`** | `RunLog` emits one JSON record per step (+ a run summary) to a `.log` file — the observability seam. `RunRegistry` ingests that JSONL into a queryable run-history store. → [run-log-format.md](run-log-format.md) ([ADR-0005](adr/0005-fail-fast-atomic-runs-and-observability.md)) |
| **`RunContext` / `PipelineRunner` / `Requirement`** | The thin domain runner: register handlers by `(case_type, pipeline)`, receive a context carrying execution/logical identity, dates, explicit run params, RunLog, and RunRegistry, and block stale downstream runs with `Requirement.succeeded(RunAddress.pipeline(...)).same_day()` or task-level `within_days(...)` predicates. `FreshnessRequirement` remains compatible. → [core-primitives.md](core-primitives.md) |
| **`CaseType` / `Variation`** | Case-review application/domain objects in `case_review.case_type`, not framework primitives: a Case Type bundles its `schema`, its identity contract (`natural_key` + a `namespace` derived from `name`, ADR-0009), and its `variations`, imported directly (no global CaseType config registry). A Variation overrides only what differs — most often the `question_bank_id`. → [selection.md](selection.md) |
| **`CasePool`** | Case-review application/domain helper in `case_review.case_pool`: the per-Case-Type population read from ingested silver, surfaced through intention-revealing retrievals (e.g. `fetch_available_cases(...)`) instead of raw `read_*`. → [selection.md](selection.md) |
| **`WorkingDayCalendar`** | A config-seeded **pure utility** for availability arithmetic ("the last 20 working days"). Touches no Dataset/Store/engine; not a Feed. → [working-day-calendar.md](working-day-calendar.md) |

Two cross-cutting flows extend the pipeline: **quarantine** routes value-rule
rejects aside (keeping good rows — [ADR-0007](adr/0007-row-level-quarantine.md))
and **`.explain()`** lands a per-row **RowTrace**. The framework owns the generic
trace mechanics; the case-review pipeline gives them domain meaning by writing a
selection trace table ([ADR-0008](adr/0008-selection-explainability.md);
see the Selection how-to below).

---

## How-to

### Build a new Case Type — schema → Variations → CasePool → SelectionPool

Adding a Case Type is declaring data, not writing engine code. The end-to-end
walkthrough (with the runnable demo) is [`selection.md`](selection.md); the steps:

**1. Declare the schema** — an ordinary dataclass; its annotations *are* the
column + type contract (enforced at silver, and optionally gold). Add explicit
nullability and value-level rules with `typing.Annotated` (`Nullable`, `NonNull`,
`Pattern`, `Length`, `Range`, `Unique`, `OneOf`), and cross-field **row checks**
over the relationship between a row's fields with the `@row_checks(...)` class
decorator (`RowCheck`).

```python
from dataclasses import dataclass
from datetime import date

@dataclass
class ActivityCase:
    case_ref: str
    adviser: str
    activity_date: date
    amount: int
```

**2. Declare the Case Type + its Variations** — a Variation inherits the type's
config and overrides only what differs, most often the `question_bank_id` (the
case-review domain stores only the *reference* id; the bank's content is the
review platform's). One Case Type has many Variations, so they are data.

```python
from case_review.case_type import CaseType, Variation

CASES = CaseType(
    name="cases",                 # the subject: medallion dir + table name;
                                  #   also seeds the case_id namespace (ADR-0009)
    schema=ActivityCase,          # enforced at silver/gold boundaries
    natural_key=("case_ref",),    # identifies a Case → the deterministic case_id
    variations=(
        Variation(id="v1", question_bank_id="qb-100"),
        Variation(id="v2", question_bank_id="qb-200"),
    ),
)
```

**3. Ingest a Feed into the medallion** — land raw, then refine to silver with the
schema enforced (compose `SchemaCoercion` to repair storage-lossy types, then
`SchemaValidator` to validate, before the silver write). See the *Add a new Feed*
how-to.

**4. Read it through the CasePool** — the clean domain abstraction over silver:

```python
from case_review.case_pool import CasePool
from tools.store import StoreRegistry
from tools.calendar import WorkingDayCalendar
from tools.medallion import medallion

med = medallion(StoreRegistry("/share"), CASES.name)
pool = CasePool(CASES, med.gold, WorkingDayCalendar())
available = pool.fetch_available_cases(
    as_of=date(2026, 5, 29), activity_column="activity_date", within_working_days=5,
)
```

**5. Run Selection into the SelectionPool** — see the *Selection pipeline* how-to.

### Add a new Feed — pick a Reader, compose, land it

A Feed is one source ingested into a subject's medallion. For the source types
that already ship, **no engine code is needed** — pick the Reader, compose it
into a `Pipeline`, point it at a Store-minted Writer. Full walkthrough (incl.
remote SAS / SharePoint feeds and their stubbed seams):
[`adding-a-feed.md`](adding-a-feed.md).

To skip the boilerplate for a fresh CSV feed, **scaffold** one — feed code as a
`pipelines/<feed>/` subpackage (schema + pipeline + sample fixture) and its test
under `tests/pipelines/`, ready to run — and then customise it:

```sh
python -m cli scaffold orders              # -> pipelines/orders/ + tests/pipelines/test_orders.py
python -m pipelines.orders.pipeline --base-dir /data  # land the bundled sample into raw
python -m pytest tests/pipelines/test_orders.py  # the generated test passes as-is
```

When the feed's rows *are* a Case Type, add `--case-type` for the variant that
also declares the Case Type's identity contract and refines source → raw →
silver (stopping at silver — gold assembly is the author's call); see
[`adding-a-feed.md`](adding-a-feed.md):

```sh
python -m cli scaffold --case-type claims  # + case_type.py; source -> raw -> silver
```

```python
from framework.io import ExcelReader, Refresh
from tools.store import StoreRegistry
from framework.run import Pipeline
from framework.core import ColumnValidator  # optional input gate
from tools.medallion import medallion

med = medallion(StoreRegistry("/share"), "cases")     # the "cases" subject
p = Pipeline("cases")
raw = p.read(ExcelReader("feed.xlsx", sheet="cases"), name="read")
gated = p.validate(ColumnValidator(["case_ref"]), raw, name="columns")  # optional: gate input
p.write(med.raw.writer("cases", Refresh()), gated, name="write")
p.run()
```

Then refine raw → silver with the schema enforced, composing the coercion and the
schema check explicitly onto the hop:

```python
from framework.core import SchemaValidator
from framework.transform import SchemaCoercion

p = Pipeline("cases")
raw = p.read(med.raw.reader("cases"), name="read")
coerced = p.task("coerce", SchemaCoercion(ActivityCase), raw)
validated = p.validate(SchemaValidator(ActivityCase), coerced, name="post-validate")
p.write(med.silver.writer("cases", Refresh()), validated, name="write")
p.run()   # coerce -> validate -> write silver
```

Swapping the Reader is the only change needed to ingest the same feed from a
different source type. A wide feed (one Case table + Detail Tables) is fanned out
into N single-table pipelines over the shared raw table —
[ADR-0009](adr/0009-case-identity-and-gold-grain.md), `pipelines/demo_fan_out.py`.

For a fuller authoring example, run
`python -m pipelines.comprehensive_examples /tmp/comprehensive-demo`. It lands
four source feeds (cases, accounts, contacts, advisers), validates reference and
detail tables, joins read-only dependencies into a `case_snapshot` silver table,
derives an `open_contact_count`, then assembles two gold outputs: a scored review
queue and an adviser-level summary. The example is intentionally multi-source so
pipeline authors can copy a realistic shape instead of a three-row toy. It
follows the scaffold layout under `pipelines/comprehensive_examples/`, with
separate `schema.py`, `rules.py`, `processors.py`, `pipeline.py`, and
`sample_data/` files.

For a worked **selection** example — two source feeds (all sales + all case
reviews) narrowed to one Case to check per adviser by a real multi-rule policy
(recency, highest risk, rolling-year quotas, cooldowns) — see
[`example-case-selection.md`](example-case-selection.md) and
`pipelines/case_selection/`. It keeps every selection criterion as a named, pure,
unit-tested rule while the framework owns the IO, schema enforcement, and gold
write.

### Emit a file Deliverable

Reporting can emit file-form Deliverables by swapping the destination Writer.
Only the `write` step's Writer changes; the file adapter owns the path, format,
and load strategy.

```python
from framework.io import CsvReader, CsvWriter, JsonWriter, Refresh
from framework.run import Pipeline

p = Pipeline("report")
rows = p.read(CsvReader("report_rows.csv"), name="read")
p.write(CsvWriter("deliverables/report.csv", Refresh()), rows, name="write")
p.run()

pj = Pipeline("report-json")
rows = pj.read(CsvReader("report_rows.csv"), name="read")
pj.write(JsonWriter("deliverables/report.json", Refresh()), rows, name="write")
pj.run()
```

When a directory contains many files, choose the shape by the logical run you
need:

- Use `GlobCsvReader(directory, pattern)` when the files together form one Feed
  snapshot: files are matched with `pathlib.Path.glob`, read in sorted order,
  concatenated into one `Dataset`, then validated/written under one logical run
  id. Pass `columns=[...]` to project the same way `CsvReader` does.
- Use `ForEach(files, pipeline_builder, ...).run(context)` when each file is its
  own independent run using the same recipe. The factory receives
  `pipeline_builder(item, context)`, where `context.logical_run_id` can be
  derived per item for idempotent `AccumulateByRun` writes. The orchestrator
  builds a fresh `Pipeline` per item. By default it stops at the first failure,
  naming the item that failed. Pass `continue_on_error=True` for best-effort
  batches: the run continues and returns one outcome per item with `status`,
  `item`, `logical_run_id`, the successful `dataset`, or the original
  `exception`.

Best-effort batches can partially succeed. Each successful item still uses its
own fail-fast, atomic `Pipeline.run()` and Writer behavior, so no single item is
half-written. For idempotent reruns, derive stable per-item logical run ids; an
`AccumulateByRun` retry can then replace or add the affected item's slice
without depending on the batch's previous successes.

### Write a Selection pipeline — CasePool → processors → gold

Selection is its **own** pipeline that reuses the `Pipeline` builder, so it
inherits the same fail-fast/atomic run, observability, and gold write as Ingest.
Feed the CasePool's available cases in through a `DatasetReader` (no SQL
round-trip), narrow with the Selection processors, stamp the Variation's question
bank, and accumulate into gold. Full treatment: [`selection.md`](selection.md)
and the processor reference [`processors.md`](processors.md).

```python
from typing import Any, Mapping

from framework.io import AccumulateByRun, DatasetReader
from tools.store import StoreRegistry
from framework.run import Pipeline
from tools.medallion import medallion
from framework.transform import (
    Filter,
    AntiJoinWith,
    JoinDependency,
    JoinWith,
    Score,
    Sort,
    Stamp,
)


def high_value_case(row: Mapping[str, Any]) -> bool:
    return row["amount"] >= 100


def priority_score(row: Mapping[str, Any]) -> int:
    return row["amount"] * 2


variation = CASES.variation("v1")
registry = StoreRegistry("/share")
reference = JoinDependency(
    "advisers", medallion(registry, "advisers").silver.reader("advisers")
)
already_reviewed = JoinDependency(
    "already-reviewed", medallion(registry, "reviews").silver.reader("review_outcomes")
)
strategy = AccumulateByRun.from_context(context)
med = medallion(registry, CASES.name)

p = Pipeline("selection")
r = p.read(DatasetReader(available), name="read")
scored = p.task("score", Score("priority_score", priority_score), r)
high = p.task("filter", Filter(high_value_case, name="high-value"), scored)
anti = p.task(
    "anti-join",
    AntiJoinWith(already_reviewed, on="case_ref", name="already-reviewed"),
    high,
)
joined = p.task("join", JoinWith(reference, on="adviser"), anti)  # read-only dependency
ranked = p.task("sort", Sort("priority_score", ascending=False), joined)
stamped = p.task(
    "stamp",
    Stamp("question_bank_id", variation.question_bank_id),
    ranked,
)
p.explain(                                                    # optional: RowTrace
    med.gold.writer("selection_trace", strategy),
    stamped,
    id_column="case_ref",
    score_column="priority_score",
)
p.write(med.gold.writer("selection_pool", strategy), stamped, name="write")
p.run(context=context)
```

- **Business rules are plain Python** over a row mapping, never SQL —
  [ADR-0002](adr/0002-python-processing-opaque-dataset-carrier.md).
- **Name explainable gates and joins** (`name="high-value"`,
  `name="adviser-hierarchy"`) so the Selection trace can report the business
  reason a Case was excluded.
- **Keep predicates and scorers pure**: deterministic functions of the row and
  explicit constants, with no hidden reads from files, databases, clocks, or
  mutable module state.
- **Extract and test repeated rules as helpers**. A predicate or scorer can be
  tested directly with a small `dict`; reserve full Pipeline tests for wiring,
  trace, ranking, and writes.
- **Remember row-wise cost**: each `Filter`/`Score` callable runs once per row,
  so avoid network I/O, disk I/O, expensive parsing, or repeated reference
  lookups inside the row function. Precompute or join Reference Data instead,
  or use `VectorizedFilter` / `VectorizedDerive` for whole-column expressions on
  larger feeds.
- **Declare join dependencies explicitly** with `JoinDependency(name, reader)`
  or a materialized `Dataset`. `JoinWith` and
  `AntiJoinWith` never run another pipeline; upstream execution
  belongs to the runner/catalog layer.
- **Reference Data** (the Adviser hierarchy, product codes) is read-only to Case
  Types and joined in Python — never written by them.
- **`.explain()`** uses the framework's generic **RowTrace** mechanics to land a
  case-review selection trace (why each Case was/wasn't chosen) as a sibling table.
- The SelectionPool reaches the review platform as a **Deliverable** (a later
  slice); the returned **Review Outcomes** come back via **Sync**, not here.
- Run pipelines through the framework when upstream requirements matter:
  `python -m cli run pipelines/selection --base-dir /tmp/demo --run-date 2026-05-29`
  checks declared upstream run history before Selection executes.

### Assemble silver into gold outputs

Silver-to-gold work can be more than pass-through accumulation. A reporting or
selection pipeline often reads one or more validated silver tables, derives
business measures, filters to a consumption contract, and writes several gold
tables with explicit load strategies. The comprehensive example keeps those
steps separate from bronze-to-silver:

```python
from pipelines.comprehensive_examples import bronze_to_silver, silver_to_gold

bronze_to_silver("/tmp/comprehensive-demo", logical_run_id="2026-05-29")
silver_to_gold("/tmp/comprehensive-demo", logical_run_id="2026-05-29")
```

The gold half reads `complex_cases.silver.case_snapshot`, scores and filters the
review queue with plain-Python rules, and separately aggregates an
`adviser_summary`. Both are written to `complex_reporting/gold.db` using
`AccumulateByRun`, so rerunning the same `logical_run_id` replaces that run's
rows without touching prior loads.

### Operate pipelines from the CLI — run, status, runs, log

For the everyday operator tasks — running a pipeline, checking its status,
listing recent runs, inspecting a run log — use `python -m cli` instead
of writing a wrapper script. It is a thin shell over the runner and the
`RunRegistry` / `RunLog` seam; full reference with example output is
[`operator-cli.md`](operator-cli.md).

```sh
python -m cli run pipelines/ingest --base-dir /data --run-date 2026-05-29
python -m cli run pipelines/ingest --base-dir /data --dry-run   # preview each step, write nothing
python -m cli run pipelines/ingest --env dev         # or resolve base_dir from a named environment
python -m cli status --base-dir /data --pipeline ingest
python -m cli runs --base-dir /data --pipeline ingest --limit 5
python -m cli log ingest --base-dir /data --run-id 5f8ff8c7
```

`run` addresses a pipeline by **its location on disk**: `pipelines/ingest` maps
to the module `pipelines.ingest.pipeline`, imported at runtime, whose
`run(context)` callable the framework executes after checking its declared
`UPSTREAMS` — so the dependency stays one-way and the framework carries no
application name. Pass `run --logical-run-id <id>` to re-drive a business run: a
re-run under the same logical id replaces that run's accumulated rows instead of
duplicating them (it defaults to `<pipeline>:run_date`). Pass repeatable
`--param KEY=VALUE` entries for explicit per-run inputs such as
`source_file=/share/upstream/claims/claims_20260622_a.csv`; pipeline code reads
them from `context.params`. Each command reports a clear one-line error and a
non-zero exit on the expected failures (unknown
pipeline path, stale upstream, validation failure, missing run history) rather
than a traceback. Only `orchestrate` takes a required `--app` naming an
application's registry module (`build_runner()` / `build_pipeline_sets()`).

### Test a pipeline — given source rows, expect output rows

To test a concrete pipeline script, reach for `tests.framework_testing` rather than
wiring temp directories and SQLite assertions by hand. `given_rows(...)` hands a
pipeline an in-memory feed, `RecordingWriter()` captures what it wrote, and
`rows_of(...)` reads it back as plain row dicts for a direct `==`:

```python
from framework.run import Pipeline
from framework.transform import Filter
from tests.framework_testing import given_rows, rows_of, RecordingWriter

reader = given_rows([{"amount": 100}, {"amount": 50}])
writer = RecordingWriter()
p = Pipeline("selection")
r = p.read(reader, name="read")
high = p.task("filter", Filter(lambda row: row["amount"] >= 100, name="high-value"), r)
p.write(writer, high, name="write")
p.run()
assert rows_of(writer) == [{"amount": 100}]
```

`read_rows(store, table)` reads a landed table back; `RecordingRunLog()`
and `read_run_log(path)` make run-log records and validation failures easy to
assert. Full reference: [`testing-helpers.md`](testing-helpers.md).

---

## The rest of the docs

| Doc | Covers |
|-----|--------|
| [`public-api.md`](public-api.md) | The public API: the facades (`framework.core` / `io` / `transform` / `validate` / `run` / `recipes` / `shared`), the internal-module boundary, and the packaging non-goal. |
| [`core-primitives.md`](core-primitives.md) | The consolidated framework primitives reference with worked examples and build status per slice. |
| [`adding-a-feed.md`](adding-a-feed.md) | Every Reader, and the stubbed remote (SAS / SharePoint) seams. |
| [`schema-enforcement.md`](schema-enforcement.md) | `Schema` / `SchemaValidator` / `SchemaCoercion`, value-level rules, composing the schema boundary onto a pipeline. |
| [`data-dictionary-template.md`](data-dictionary-template.md) | The Confluence-ready template for documenting what every table/Feed and each of its fields means — the prose companion to `schema.py`. |
| [`gold-accumulation.md`](gold-accumulation.md) | Gold's accumulate-by-run semantics, idempotent re-run, reading "current". |
| [`processors.md`](processors.md) | The Selection transforms (`JoinWith`, per-group sampling) and the Ingest / fan-out transforms (`SelectColumns`, `Unpivot`, `DeriveKey`, `LatestPerKey`). |
| [`selection.md`](selection.md) | The full CaseType / Variation → CasePool → SelectionPool flow + explainability. |
| [`working-day-calendar.md`](working-day-calendar.md) | Availability arithmetic. |
| [`run-log-format.md`](run-log-format.md) | The JSONL record schema and the run registry. |
| [`streaming-large-sources.md`](streaming-large-sources.md) | Streaming a source too big to hold whole: chunk-level row filtering (id allow-list / predicate), why it's a streaming module not a deferred DAG node, and driving the run log with `stream_step` (fail-fast + JSONL). |
| [`retry.md`](retry.md) | Targeted retry at the reader/writer edges — `RetryPolicy`, where to use it and where not. |
| [`operator-cli.md`](operator-cli.md) | The operator CLI (`run` / `status` / `runs` / `log`) with example commands and output. |
| [`resolving-a-failed-run.md`](resolving-a-failed-run.md) | The operator loop from a failed run — investigate (`status`/`log`), diagnose, resolve, and re-drive idempotently. |
| [`escape-hatch-store.md`](escape-hatch-store.md) | Iterating against a flat scratch db (and a pre-baked SQL query) outside the medallion / namespace Store, and migrating back. |
| [`testing-helpers.md`](testing-helpers.md) | `tests.framework_testing` — the test-only helpers for testing concrete pipelines (`given_rows`, `RecordingWriter`, `read_rows`, `RecordingRunLog`, `read_run_log`). |
| [`testing-external-systems.md`](testing-external-systems.md) | Mocking remote external systems (SAS, SFTP) to maintain fast, in-memory orchestration tests using Dependency Injection and boundary Protocols. |
| [`adr/`](adr/) | Every architectural decision (the *why*). |
| [`../CONTEXT.md`](../CONTEXT.md) | The domain language — the canonical glossary. |
