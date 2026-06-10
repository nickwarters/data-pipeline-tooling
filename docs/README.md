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

Every Pipeline reuses the **same generic** three-layer medallion. A **subject**
(a Case Type, or a shared Reference Data set) owns its own medallion — three
SQLite databases `<subject>/{raw,silver,gold}.db` on a network share, isolated
from every other subject's files for blast-radius containment and independent
onboarding ([ADR-0001](adr/0001-sqlite-medallion-store-on-network-share.md)).
Use the framework layer constants (`RAW`, `SILVER`, `GOLD`) rather than new
string literals when composing new pipeline code.

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
([ADR-0008](adr/0008-graduated-schema-enforcement.md)) and gold is often the
consumption/grain boundary
([ADR-0009](adr/0009-case-identity-and-gold-grain.md)).

> **Load strategy is per-feed, owned by the Writer** — the Store maps `layer →
> location` only ([ADR-0006](adr/0006-load-idempotency-refresh-upstream-accumulate-downstream.md)
> amendment). "Refresh upstream / accumulate downstream" is a common profile,
> not a framework law. The **Ingest** profile is moving to *history-upstream /
> current-gold* (raw + silver accumulate the change-over-time record; gold
> reduces to one current row per Case). See the deep docs below for what has
> landed vs. what is decided-not-yet-built.

### How the pieces fit

A **Feed** is read by a **Reader** into a **Dataset** (the opaque tabular
carrier), composed into a **Pipeline** builder, optionally **coerced** /
**validated** / **processed**, and handed to a **Writer** the **Store** mints for
the target layer. The **CasePool** then reads the ingested silver and surfaces
**Cases** through intention-revealing retrievals; the **Selection** pipeline
narrows them into the **SelectionPool**. Every `.run()` is fail-fast and atomic,
and emits a structured **RunLog**. Repeated independent runs can choose their
own orchestration policy: `ForEach` is fail-fast by default, or explicit
best-effort when later items should continue after one item fails.

---

## Primitives reference

The foundational vocabulary. Each links to its deep doc; the consolidated
reference with worked examples is [`core-primitives.md`](core-primitives.md).

> **Importing.** Pipeline code imports these through the three public **facades**
> — `framework.io` (sources/sinks/stores), `framework.transform` (processors,
> validators, schema, calendar), and `framework.run` (the `Pipeline` builder,
> orchestration, runner, observability) — not from the modules behind them. The
> facade names are the stable surface; see [`public-api.md`](public-api.md) for
> the full member list, the internal-module boundary, and why packaging is an
> explicit non-goal.

| Primitive | What it is / when to use it |
|-----------|------------------------------|
| **`Dataset`** | The opaque, bulk in-memory **tabular carrier** — pandas behind the seam, swappable later. Tiny public surface (`.columns`, `len()`); pandas never leaks past it. ([ADR-0002](adr/0002-python-only-processing-dumb-store-two-tier-carrier.md)) |
| **`Reader`** | `read() -> Dataset`. One per source shape: `CsvReader`, `GlobCsvReader`, `ExcelReader`, `SqliteReader`, and the stubbed-remote `SasReader` / `SharePointReader`. Swap the Reader to ingest the same feed from a different source. → [adding-a-feed.md](adding-a-feed.md) |
| **`Writer`** | `write(dataset) -> None`. The dual of Reader. Owns **both** target location and **load strategy**. File Deliverables use `CsvWriter`, `ExcelWriter`, or `JsonWriter`; SharePoint list Deliverables use the stubbed `SharePointWriter`; SQLite tables use `SqliteTruncateReloadWriter` or `AccumulateByRunWriter`. → [gold-accumulation.md](gold-accumulation.md) |
| **`RetryPolicy` / `RetryingReader` / `RetryingWriter`** | Targeted retry for **transient I/O-edge failures** (remote access, SharePoint/SAS fetch, SQLite busy). An allowlist of exception types is retried; schema-validation and configuration errors abort immediately. Scoped to the `read()`/`write()` seam, never around validation. → [retry.md](retry.md) |
| **`Store` / `StoreCatalog`** | `Store(subject_dir)` binds one subject to Writer/Reader creation over `<subject>/{raw,silver,gold}.db`; `StoreCatalog(root).store(subject)` mints those stores from shared root/configuration. Holds no business logic and makes no load decision. ([ADR-0001](adr/0001-sqlite-medallion-store-on-network-share.md)) |
| **`Validator`** | `validate(dataset) -> None`, **raises** on breach. `ColumnValidator`, `RowCountValidator` (engine-agnostic), `VolumeAnomalyValidator` (trips when a run's volume deviates from its recent-history baseline — catches truncated source exports, #54), `SchemaDriftValidator` (warns at the raw boundary when a feed's columns drift from the prior run's landed set — catches owner-controlled source schema change, #51). Severity (`error`/`warn`) is set where it's attached. |
| **`Schema` / `SchemaValidator`** | A Case Type **dataclass** whose annotations *are* the column, dtype, nullability, and value-rule contract; the validator is the dataclass→validator adapter, enforced at silver (and optionally gold). Nullability/value rules extend the same dataclass via `Annotated`. → [schema-enforcement.md](schema-enforcement.md) ([ADR-0008](adr/0008-graduated-schema-enforcement.md)) |
| **`Processor`** | `process(dataset) -> Dataset`, run mid-pipeline via `.with_processor()`. `SchemaCoercion` (repair storage-lossy types); the Selection transforms `Filter` / `Score` / `Sort` / `Rename` / `Stamp`, the per-group `TopNPerGroup` / `SamplePerGroup`, the explicit-dependency cross-feed `JoinWith` / `AntiJoinWith`; and the Ingest / fan-out transforms `SelectColumns` / `Unpivot` / `DeriveKey` / `LatestPerKey`. → [processors.md](processors.md) |
| **`Stage`** | A position-sensitive step inside one class-level `Pipeline` run: current `Dataset` in, next `Dataset` out. Compose with `.add_stage(...)` when validation, processing, or explicit checkpoint writes must appear at an exact point. Built-ins: `ValidationStage`, `ProcessingStage`, `CheckpointStage`. |
| **`Pipeline`** (builder) | The deferred fluent builder: `Pipeline(name, reader).add_stage(…).write_to(writer)`. It builds one ordered plan; call `.describe()` to inspect the planned reader/stages/governance/writer without executing, then `.run(context=…)` to execute that plan fail-fast and atomic with RunLog observability. ([ADR-0003](adr/0003-deferred-fluent-builder-composition-model.md)) |
| **`ForEach`** | Runnable orchestration for independent repeated runs: pass items plus `pipeline_builder(item, context)`, then call `.run(context)`. It creates a fresh builder and per-item `RunContext` for each item. Default behavior fails fast on the first failed item; `continue_on_error=True` returns per-item success/failure outcomes and continues. Use when files must remain separate logical runs. |
| **`RunLog` / `RunRegistry`** | `RunLog` emits one JSON record per step (+ a run summary) to a `.log` file — the observability seam. `RunRegistry` ingests that JSONL into a queryable run-history store. → [run-log-format.md](run-log-format.md) ([ADR-0007](adr/0007-fail-fast-atomic-runs-jsonl-observability.md)) |
| **`RunContext` / `PipelineRunner` / `FreshnessRequirement`** | The thin domain runner: register handlers by `(case_type, pipeline)`, receive a context carrying execution/logical identity, dates, RunLog, and RunRegistry, and block stale downstream runs by querying recent successful upstream history. → [core-primitives.md](core-primitives.md) |
| **`CaseType` / `Variation`** | Case-review application/domain objects in `case_review.case_type`, not framework primitives: a Case Type bundles its `schema` + `variations`, imported directly (no global CaseType config registry). A Variation overrides only what differs — most often the `question_bank_id`. → [selection.md](selection.md) |
| **`CasePool`** | Case-review application/domain helper in `case_review.case_pool`: the per-Case-Type population read from ingested silver, surfaced through intention-revealing retrievals (e.g. `fetch_available_cases(...)`) instead of raw `read_*`. → [selection.md](selection.md) |
| **`WorkingDayCalendar`** | A config-seeded **pure utility** for availability arithmetic ("the last 20 working days"). Touches no Dataset/Store/engine; not a Feed. → [working-day-calendar.md](working-day-calendar.md) |

Two cross-cutting flows extend the pipeline: **quarantine** routes value-rule
rejects aside (keeping good rows — [ADR-0007 amd 01](adr/0007-amendment-01-quarantine.md))
and **`.explain()`** lands a per-row **RowTrace**. The framework owns the generic
trace mechanics; the case-review pipeline gives them domain meaning by writing a
selection trace table ([ADR-0007 amd 02](adr/0007-amendment-02-selection-explainability.md);
see the Selection how-to below).

---

## How-to

### Build a new Case Type — schema → Variations → CasePool → SelectionPool

Adding a Case Type is declaring data, not writing engine code. The end-to-end
walkthrough (with the runnable demo) is [`selection.md`](selection.md); the steps:

**1. Declare the schema** — an ordinary dataclass; its annotations *are* the
column + type contract (enforced at silver, and optionally gold). Add explicit
nullability and value-level rules with `typing.Annotated` (`Nullable`, `NonNull`,
`Pattern`, `Length`, `Unique`, `OneOf`).

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
    name="cases",                 # the subject: medallion dir + table name
    schema=ActivityCase,          # enforced at silver/gold boundaries
    variations=(
        Variation(id="v1", question_bank_id="qb-100"),
        Variation(id="v2", question_bank_id="qb-200"),
    ),
)
```

**3. Ingest a Feed into the medallion** — land raw, then refine to silver with the
schema enforced (`raw_to_silver` coerces storage-lossy types, then validates).
See the *Add a new Feed* how-to.

**4. Read it through the CasePool** — the clean domain abstraction over silver:

```python
from case_review.case_pool import CasePool
from framework.io import StoreCatalog
from framework.transform import WorkingDayCalendar

store = StoreCatalog("/share").store(CASES.name)
pool = CasePool(CASES, store, WorkingDayCalendar())
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

```python
from framework.io import RAW, ExcelReader, Refresh, StoreCatalog
from framework.run import Pipeline
from framework.transform import ColumnValidator  # optional input gate

store = StoreCatalog("/share").store("cases")       # the "cases" subject
(
    Pipeline("cases", ExcelReader("feed.xlsx", sheet="cases"))
    .with_validator(ColumnValidator(["case_ref"]))  # optional: gate the input
    .write_to(store.writer(RAW, "cases", Refresh()))
    .run()
)
```

Then refine raw → silver with the schema enforced:

```python
from framework.run import raw_to_silver

raw_to_silver(store, "cases", ActivityCase).run()   # coerce -> validate -> write silver
```

Swapping the Reader is the only change needed to ingest the same feed from a
different source type. A wide feed (one Case table + Detail Tables) is fanned out
into N single-table pipelines over the shared raw table —
[ADR-0009](adr/0009-case-identity-and-gold-grain.md), `pipelines/demo_fan_out.py`.

### Emit a file Deliverable

Reporting can emit file-form Deliverables by swapping the destination Writer.
The builder still sees only `write_to(writer).run()`; the file adapter owns the
path, format, and load strategy.

```python
from framework.io import CsvReader, CsvWriter, JsonWriter, Refresh
from framework.run import Pipeline

Pipeline("report", CsvReader("report_rows.csv")).write_to(
    CsvWriter("deliverables/report.csv", Refresh())
).run()

Pipeline("report-json", CsvReader("report_rows.csv")).write_to(
    JsonWriter("deliverables/report.json", Refresh())
).run()
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

from framework.io import GOLD, SILVER, AccumulateByRun, DatasetReader, StoreCatalog
from framework.run import Pipeline
from framework.transform import (
    Filter,
    AntiJoinWith,
    JoinDependency,
    JoinWith,
    Score,
    Sort,
    Stamp,
    TopNPerGroup,
)


def high_value_case(row: Mapping[str, Any]) -> bool:
    return row["amount"] >= 100


def priority_score(row: Mapping[str, Any]) -> int:
    return row["amount"] * 2


variation = CASES.variation("v1")
catalog = StoreCatalog("/share")
reference = JoinDependency(
    "advisers", catalog.store("advisers").reader(SILVER, "advisers")
)
already_reviewed = JoinDependency(
    "already-reviewed", catalog.store("reviews").reader(SILVER, "review_outcomes")
)
strategy = AccumulateByRun.from_context(context)

(
    Pipeline("selection", DatasetReader(available))
    .with_processor(Score("priority_score", priority_score))
    .with_processor(Filter(high_value_case, name="high-value"))
    .with_processor(AntiJoinWith(already_reviewed, on="case_ref", name="already-reviewed"))
    .with_processor(JoinWith(reference, on="adviser"))          # read-only dependency join
    .with_processor(TopNPerGroup(key="adviser", by="priority_score", n=1))
    .with_processor(Sort("priority_score", ascending=False))
    .with_processor(Stamp("question_bank_id", variation.question_bank_id))
    .explain(                                                    # optional: RowTrace
        store.writer(GOLD, "selection_trace", strategy),
        id_column="case_ref",
        score_column="priority_score",
    )
    .write_to(store.writer(GOLD, "selection_pool", strategy))
    .run(context=context)
)
```

- **Business rules are plain Python** over a row mapping, never SQL —
  [ADR-0002](adr/0002-python-only-processing-dumb-store-two-tier-carrier.md).
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
  lookups inside the row function. Precompute or join Reference Data instead.
- **Declare join dependencies explicitly** with `JoinDependency(name, reader)`
  or a materialized `Dataset`. `JoinWith.process()` and
  `AntiJoinWith.process()` never run another pipeline; upstream execution
  belongs to the runner/catalog layer.
- **Reference Data** (the Adviser hierarchy, product codes) is read-only to Case
  Types and joined in Python — never written by them.
- **`.explain()`** uses the framework's generic **RowTrace** mechanics to land a
  case-review selection trace (why each Case was/wasn't chosen) as a sibling table.
- The SelectionPool reaches the review platform as a **Deliverable** (a later
  slice); the returned **Review Outcomes** come back via **Sync**, not here.
- Run domain Pipelines through the thin runner when freshness matters:
  `python -m pipelines.cli run cases selection /tmp/demo --run-date 2026-05-29`
  checks recent successful `cases/ingest` history before Selection executes.

### Operate pipelines from the CLI — run, status, runs, log

For the everyday operator tasks — running a pipeline, checking its status,
listing recent runs, inspecting a run log — use `python -m pipelines.cli` instead
of writing a wrapper script. It is a thin shell over the runner and the
`RunRegistry` / `RunLog` seam; full reference with example output is
[`operator-cli.md`](operator-cli.md).

```sh
python -m pipelines.cli run cases ingest /data --run-date 2026-05-29
python -m pipelines.cli status /data --case-type cases
python -m pipelines.cli runs /data --pipeline cases/ingest --limit 5
python -m pipelines.cli log /data cases --run-id 5f8ff8c7
```

Pass `run --logical-run-id <id>` to re-drive a business run: a re-run under the
same logical id replaces that run's accumulated rows instead of duplicating them
(it defaults to `case_type/pipeline:run_date`). Each command reports a clear
one-line error and a non-zero exit on the expected
failures (unknown pipeline, stale upstream, validation failure, missing run
history) rather than a traceback. `python -m pipelines.run …` remains as the
historical `run`-only shortcut.

---

## The rest of the docs

| Doc | Covers |
|-----|--------|
| [`public-api.md`](public-api.md) | The public API: the three facades (`framework.io` / `transform` / `run`), the internal-module boundary, and the packaging non-goal. |
| [`core-primitives.md`](core-primitives.md) | The consolidated framework primitives reference with worked examples and build status per slice. |
| [`adding-a-feed.md`](adding-a-feed.md) | Every Reader, and the stubbed remote (SAS / SharePoint) seams. |
| [`schema-enforcement.md`](schema-enforcement.md) | `Schema` / `SchemaValidator` / `SchemaCoercion`, value-level rules, `raw_to_silver`. |
| [`gold-accumulation.md`](gold-accumulation.md) | Gold's accumulate-by-run semantics, idempotent re-run, reading "current". |
| [`processors.md`](processors.md) | The Selection transforms (`JoinWith`, per-group sampling) and the Ingest / fan-out transforms (`SelectColumns`, `Unpivot`, `DeriveKey`, `LatestPerKey`). |
| [`selection.md`](selection.md) | The full CaseType / Variation → CasePool → SelectionPool flow + explainability. |
| [`working-day-calendar.md`](working-day-calendar.md) | Availability arithmetic. |
| [`run-log-format.md`](run-log-format.md) | The JSONL record schema and the run registry. |
| [`retry.md`](retry.md) | Targeted retry at the reader/writer edges — `RetryPolicy`, where to use it and where not. |
| [`operator-cli.md`](operator-cli.md) | The operator CLI (`run` / `status` / `runs` / `log`) with example commands and output. |
| [`adr/`](adr/) | Every architectural decision (the *why*). |
| [`../CONTEXT.md`](../CONTEXT.md) | The domain language — the canonical glossary. |
</content>
</invoke>
