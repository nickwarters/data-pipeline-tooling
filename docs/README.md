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

Every Pipeline reuses the **same** three-layer medallion. A **subject** (a Case
Type, or a shared Reference Data set) owns its own medallion — three SQLite
databases `<subject>/{raw,silver,gold}.db` on a network share, isolated from
every other subject's files for blast-radius containment and independent
onboarding ([ADR-0001](adr/0001-sqlite-medallion-store-on-network-share.md)).

| Layer  | Holds | Discipline |
|--------|-------|------------|
| **raw**   | A faithful, **schema-light** mirror of the source as landed (booleans as `TRUE`/`FALSE` text, dates unparsed). | Full refresh each run, so re-runs are deterministic. The diagnosable landing zone. |
| **silver** | Validated, normalised data — the **schema boundary**: a Case Type's declared columns + dtypes are enforced *before* data lands. | Coerce (repair storage-lossy types) → validate → write. This **silver is the CasePool**. |
| **gold**  | The accumulating record: the **SelectionPool**, Review Outcomes, Reporting views. Ingest's gold is current-only, one row per Case (the **grain boundary**). | Accumulates, stamped `run_id` / `load_date`; idempotent re-run. |

Two boundaries fall out of this: **silver is the schema boundary** (declared
columns + dtypes validated — [ADR-0008](adr/0008-graduated-schema-enforcement.md))
and **gold is the grain boundary** (one row per Case enforced —
[ADR-0009](adr/0009-case-identity-and-gold-grain.md)).

> **Load strategy is per-feed, owned by the Writer** — the Store maps `layer →
> location` only ([ADR-0006](adr/0006-load-idempotency-refresh-upstream-accumulate-downstream.md)
> amendment). The "refresh upstream / accumulate downstream" rule above is the
> *default* profile, not a law. The **Ingest** profile is moving to
> *history-upstream / current-gold* (raw + silver accumulate the change-over-time
> record; gold reduces to one current row per Case). See the deep docs below for
> what has landed vs. what is decided-not-yet-built.

### How the pieces fit

A **Feed** is read by a **Reader** into a **Dataset** (the opaque tabular
carrier), composed into a **Pipeline** builder, optionally **coerced** /
**validated** / **processed**, and handed to a **Writer** the **Store** mints for
the target layer. The **CasePool** then reads the ingested silver and surfaces
**Cases** through intention-revealing retrievals; the **Selection** pipeline
narrows them into the **SelectionPool**. Every `.run()` is fail-fast and atomic,
and emits a structured **RunLog**.

---

## Primitives reference

The foundational vocabulary. Each links to its deep doc; the consolidated
reference with worked examples is [`core-primitives.md`](core-primitives.md).

| Primitive | What it is / when to use it |
|-----------|------------------------------|
| **`Dataset`** | The opaque, bulk in-memory **tabular carrier** — pandas behind the seam, swappable later. Tiny public surface (`.columns`, `len()`); pandas never leaks past it. ([ADR-0002](adr/0002-python-only-processing-dumb-store-two-tier-carrier.md)) |
| **`Reader`** | `read() -> Dataset`. One per source type: `CsvReader`, `ExcelReader`, `SqliteReader`, and the stubbed-remote `SasReader` / `SharePointReader`. Swap the Reader to ingest the same feed from a different source. → [adding-a-feed.md](adding-a-feed.md) |
| **`Writer`** | `write(dataset) -> None`. The dual of Reader. Owns **both** target location and **load strategy** (`SqliteTruncateReloadWriter` for full-refresh raw/silver; `AccumulateByRunWriter` for gold). → [gold-accumulation.md](gold-accumulation.md) |
| **`Store`** | One subject's medallion mouth: `Store(subject_dir)` *mints* the layer-appropriate Writer/Reader over `<subject>/{raw,silver,gold}.db`. Holds no business logic and makes no load decision. ([ADR-0001](adr/0001-sqlite-medallion-store-on-network-share.md)) |
| **`Validator`** | `validate(dataset) -> None`, **raises** on breach. `ColumnValidator`, `RowCountValidator` (engine-agnostic). Severity (`error`/`warn`) is set where it's attached. |
| **`Schema` / `SchemaValidator`** | A Case Type **dataclass** whose annotations *are* the column+dtype contract; the validator is the dataclass→validator adapter, enforced at silver (and optionally gold). Value-level rules extend the same dataclass via `Annotated`. → [schema-enforcement.md](schema-enforcement.md) ([ADR-0008](adr/0008-graduated-schema-enforcement.md)) |
| **`Processor`** | `process(dataset) -> Dataset`, run mid-pipeline via `.with_processor()`. `SchemaCoercion` (repair storage-lossy types); the Selection transforms `Filter` / `Score` / `Sort` / `Rename` / `Stamp`, the per-group `TopNPerGroup` / `SamplePerGroup`, and the lazy cross-feed `JoinWith`. → [processors.md](processors.md) |
| **`Pipeline`** (builder) | The deferred fluent builder: `Pipeline(name, reader).with_processor(…).write_to(writer).run()`. Runs nothing until `.run()`, which is **fail-fast and atomic** and drives the RunLog. ([ADR-0003](adr/0003-deferred-fluent-builder-composition-model.md)) |
| **`RunLog` / `RunRegistry`** | `RunLog` emits one JSON record per step (+ a run summary) to a `.log` file — the observability seam. `RunRegistry` ingests that JSONL into a queryable run-history store. → [run-log-format.md](run-log-format.md) ([ADR-0007](adr/0007-fail-fast-atomic-runs-jsonl-observability.md)) |
| **`CaseType` / `Variation`** | The declarative domain objects: a Case Type bundles its `schema` + `variations`, imported directly (no global registry). A Variation overrides only what differs — most often the `question_bank_id`. → [selection.md](selection.md) |
| **`CasePool`** | The per-Case-Type population read from ingested silver, surfaced through intention-revealing retrievals (e.g. `fetch_available_cases(...)`) instead of raw `read_*`. → [selection.md](selection.md) |
| **`WorkingDayCalendar`** | A config-seeded **pure utility** for availability arithmetic ("the last 20 working days"). Touches no Dataset/Store/engine; not a Feed. → [working-day-calendar.md](working-day-calendar.md) |

Two cross-cutting flows extend the pipeline: **quarantine** routes value-rule
rejects aside (keeping good rows — [ADR-0007 amd 01](adr/0007-amendment-01-quarantine.md))
and **`.explain()`** lands a per-Case **SelectionTrace** of *why* each Case was or
wasn't chosen ([ADR-0007 amd 02](adr/0007-amendment-02-selection-explainability.md);
see the Selection how-to below).

---

## How-to

### Build a new Case Type — schema → Variations → CasePool → SelectionPool

Adding a Case Type is declaring data, not writing engine code. The end-to-end
walkthrough (with the runnable demo) is [`selection.md`](selection.md); the steps:

**1. Declare the schema** — an ordinary dataclass; its annotations *are* the
column + type contract (enforced at silver, and optionally gold). Add value-level
rules with `typing.Annotated` (`Pattern`, `Length`, `Unique`, `OneOf`).

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
framework stores only the *reference* id; the bank's content is the review
platform's). One Case Type has many Variations, so they are data.

```python
from framework.case_type import CaseType, Variation

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
from framework.case_pool import CasePool
from framework.calendar import WorkingDayCalendar
from framework.store import Store

pool = CasePool(CASES, Store("/share/cases"), WorkingDayCalendar())
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
from framework.builder import Pipeline
from framework.readers import ExcelReader
from framework.store import Store
from framework.validators import ColumnValidator  # optional input gate

store = Store("/share/cases")                       # the "cases" subject
(
    Pipeline("cases", ExcelReader("feed.xlsx", sheet="cases"))
    .with_validator(ColumnValidator(["case_ref"]))  # optional: gate the input
    .write_to(store.writer("raw", "cases"))         # raw = full-refresh Writer
    .run()
)
```

Then refine raw → silver with the schema enforced:

```python
from framework.silver import raw_to_silver

raw_to_silver(store, "cases", ActivityCase).run()   # coerce → validate → write silver
```

Swapping the Reader is the only change needed to ingest the same feed from a
different source type. A wide feed (one Case table + Detail Tables) is fanned out
into N single-table pipelines over the shared raw table —
[ADR-0009](adr/0009-case-identity-and-gold-grain.md), `pipelines/demo_fan_out.py`.

### Write a Selection pipeline — CasePool → processors → gold

Selection is its **own** pipeline that reuses the `Pipeline` builder, so it
inherits the same fail-fast/atomic run, observability, and gold write as Ingest.
Feed the CasePool's available cases in through a `DatasetReader` (no SQL
round-trip), narrow with the Selection processors, stamp the Variation's question
bank, and accumulate into gold. Full treatment: [`selection.md`](selection.md)
and the processor reference [`processors.md`](processors.md).

```python
from framework.builder import Pipeline
from framework.processors import Filter, Sort, Stamp, JoinWith, TopNPerGroup
from framework.readers import DatasetReader

variation = CASES.variation("v1")
reference = Pipeline("advisers", Store("/share/advisers").reader("silver", "advisers"))

(
    Pipeline("selection", DatasetReader(available))
    .with_processor(Filter(lambda row: row["amount"] >= 100, name="high-value"))
    .with_processor(JoinWith(reference, on="adviser"))          # lazy cross-feed join
    .with_processor(TopNPerGroup(key="adviser", by="amount", n=1))  # one per adviser
    .with_processor(Sort("amount", ascending=False))
    .with_processor(Stamp("question_bank_id", variation.question_bank_id))
    .explain(                                                    # optional: SelectionTrace
        store.writer("gold", "selection_trace", run_id, load_date),
        id_column="case_ref",
    )
    .write_to(store.writer("gold", "selection_pool", run_id, load_date))
    .run()
)
```

- **Business rules are plain Python** over a row mapping, never SQL —
  [ADR-0002](adr/0002-python-only-processing-dumb-store-two-tier-carrier.md).
- **`JoinWith` is lazy**: `reference` is an *unexecuted* builder resolved at
  `.run()` — a DAG without a DAG engine
  ([ADR-0003](adr/0003-deferred-fluent-builder-composition-model.md)).
- **Reference Data** (the Adviser hierarchy, product codes) is read-only to Case
  Types and joined in Python — never written by them.
- **`.explain()`** lands a per-Case **SelectionTrace** (why each Case was/wasn't
  chosen) as a sibling table — the eligibility twin of quarantine.
- The SelectionPool reaches the review platform as a **Deliverable** (a later
  slice); the returned **Review Outcomes** come back via **Sync**, not here.

---

## The rest of the docs

| Doc | Covers |
|-----|--------|
| [`core-primitives.md`](core-primitives.md) | The consolidated primitives reference with worked examples and build status per slice. |
| [`adding-a-feed.md`](adding-a-feed.md) | Every Reader, and the stubbed remote (SAS / SharePoint) seams. |
| [`schema-enforcement.md`](schema-enforcement.md) | `Schema` / `SchemaValidator` / `SchemaCoercion`, value-level rules, `raw_to_silver`. |
| [`gold-accumulation.md`](gold-accumulation.md) | Gold's accumulate-by-run semantics, idempotent re-run, reading "current". |
| [`processors.md`](processors.md) | The Selection transforms, `JoinWith`, per-group sampling. |
| [`selection.md`](selection.md) | The full CaseType / Variation → CasePool → SelectionPool flow + explainability. |
| [`working-day-calendar.md`](working-day-calendar.md) | Availability arithmetic. |
| [`run-log-format.md`](run-log-format.md) | The JSONL record schema and the run registry. |
| [`adr/`](adr/) | Every architectural decision (the *why*). |
| [`../CONTEXT.md`](../CONTEXT.md) | The domain language — the canonical glossary. |
</content>
</invoke>
