# The Selection flow — CaseType / Variation, CasePool, SelectionPool

The domain capstone (#11) ties the primitives the earlier slices built into the
full per-Case-Type path the framework exists to make routine: a source feed is
**ingested** into a Case Type's medallion, surfaced as a **CasePool**, then
**Selection** narrows it into the **SelectionPool** written to gold. This doc
covers the declarative domain objects (`CaseType` / `Variation`), the `CasePool`
that reads the ingested silver, and the Selection pipeline that produces the
SelectionPool. For the domain language behind the terms, see
[`../CONTEXT.md`](../CONTEXT.md); for the processors Selection composes, see
[`processors.md`](processors.md).

## Where this sits

```
  Ingest (per Case Type)            Selection (per Case Type)
  ┌───────────────────────┐        ┌──────────────────────────────────┐
  feed → raw → silver  ───────▶  CasePool ─▶ filter/score/sort/stamp ─▶ gold
            (the CasePool)      (available cases)         (the SelectionPool)
  └───────────────────────┘        └──────────────────────────────────┘
```

**Ingest** lands a feed into `raw` (schema-light) and refines it into `silver`
with the Case Type's schema enforced (`raw_to_silver` — see
[`schema-enforcement.md`](schema-enforcement.md)). That validated **silver is the
CasePool**: the current-state population of Cases. Sources are current-state
snapshots, so raw and silver are full-refreshed each run (ADR-0006); the
accumulating layer is gold, where the **SelectionPool** lands stamped by run.

## `CaseType` / `Variation` — the declarative domain objects

A **Case Type** is a first-class classification of Cases that determines its
fields, its Variations, and — over time — its ingest/selection/processing
(CONTEXT.md). It is an **explicit declarative object imported directly**, not an
entry in a global registry: a registry is deferred to the runner era (ADR-0005).

```python
from dataclasses import dataclass
from datetime import date
from framework.case_type import CaseType, Variation

@dataclass
class ActivityCase:          # the Case Type's schema (its columns + types)
    case_ref: str
    adviser: str
    activity_date: date
    amount: int

CASES = CaseType(
    name="cases",            # the subject: medallion directory + table name
    schema=ActivityCase,     # enforced at the silver/gold boundaries
    variations=(
        Variation(id="v1", question_bank_id="qb-100"),
        Variation(id="v2", question_bank_id="qb-200"),
    ),
)

CASES.variation("v1").question_bank_id   # -> "qb-100"
```

A **Variation** is a specialization within a Case Type that inherits its config
and overrides only what differs — most commonly the **Question Bank**
(`question_bank_id`). One Case Type has many Variations (A ~3; B ~100), so they
are data, not code. The framework stores only the **reference** id, never the
bank's content (owned by the review platform — CONTEXT.md); Selection stamps that
id onto the chosen Cases. `CaseType.variation(id)` resolves a Variation and
raises `KeyError` with a located message on an unknown id, so a mis-config
surfaces where it is asked for rather than as a silent miss downstream. Further
overrides (ingest, selection criteria, divergent processing) are deferred
(ADR-0005).

## `CasePool` — the domain population, behind intention-revealing reads

The `CasePool` is the clean domain abstraction the platform exposes *instead of*
raw `pandas.read_*` calls (CONTEXT.md). It is scoped **per Case Type**,
constructed from that type's `CaseType` (for its schema), its `Store` (to read
its silver), and a `WorkingDayCalendar` (the availability arithmetic — see
[`working-day-calendar.md`](working-day-calendar.md)):

```python
from framework.case_pool import CasePool
from framework.calendar import WorkingDayCalendar
from framework.store import Store

pool = CasePool(CASES, Store("/share/cases"), WorkingDayCalendar())
available = pool.fetch_available_cases(
    as_of=date(2026, 5, 29),
    activity_column="activity_date",
    within_working_days=5,
)   # -> a Dataset of the eligible Cases
```

`fetch_available_cases` is the headline retrieval — the *concept* of **available
cases**: the candidate Cases eligible to enter Selection, here those with
activity dated within the last N working days on or before `as_of` (CONTEXT.md).
The retrieval:

1. reads the Case Type's **silver** through the `Store`;
2. repairs the round-trip-lossy date column toward the schema's types
   (`SchemaCoercion` — silver stores dates as text), so the window comparison is
   date-vs-date;
3. narrows to the working-day window in **Python**, never SQL (ADR-0002).

It returns the bulk-tier `Dataset` (the carrier), which flows straight into the
Selection pipeline. Surfacing fully typed `Case` objects is the
**typed-on-demand** edge ADR-0002 reserves for a later slice — the *concept* of
the retrieval is the deliverable here, not a mandated signature.
`fetch_available_cases` is illustrative; a Case Type may name its own retrievals.

## Selection — narrowing the CasePool into the SelectionPool

**Selection is its own pipeline**, and it reuses the `Pipeline` builder so it
inherits the same fail-fast/atomic run, observability, and gold write as ingest.
The available cases (a `Dataset`) are fed into the builder through a
`DatasetReader` — the small bridge that adapts an already-in-memory dataset to
the `Reader` shape, so Selection composes read → process → write without a SQL
round-trip:

```python
from framework.builder import Pipeline
from framework.processors import Filter, Sort, Stamp
from framework.readers import DatasetReader

variation = CASES.variation("v1")
(
    Pipeline("selection", DatasetReader(available))
    .with_processor(Filter(lambda row: row["amount"] >= 100))   # high-value only
    .with_processor(Sort("amount", ascending=False))            # rank top-first
    .with_processor(Stamp("question_bank_id", variation.question_bank_id))
    .write_to(store.writer("gold", "selection_pool", run_id, load_date))
    .run()
)
```

The **availability and selection criteria are specific Python processors**
(ADR-0002) — `Filter`/`Score`/`Sort` carry plain-Python row rules, and `Stamp`
records the Variation's `question_bank_id` on every chosen Case. The result is
the **SelectionPool**: the narrowed set of Cases actually chosen for review,
accumulated into **gold** by the `AccumulateByRunWriter` (stamped `run_id` /
`load_date`, idempotent re-run — see
[`gold-accumulation.md`](gold-accumulation.md)). Cross-feed joins (e.g. against
the Adviser hierarchy Reference Data) slot in as a `JoinWith` processor — see
[`processors.md`](processors.md).

The SelectionPool reaches the review platform as a **Deliverable** (a later
slice); the returned **Review Outcomes** come back through the **Sync** Pipeline,
not here — they live in the Sync store, not the SelectionPool (CONTEXT.md).

## End to end — the runnable demo

[`../pipelines/demo_source_to_selection.py`](../pipelines/demo_source_to_selection.py)
runs the whole path for one Case Type. From the repo root:

```sh
python -m pipelines.demo_source_to_selection /tmp/demo
```

It lands the bundled feed into `raw`, refines it to `silver` (the CasePool),
fetches the available cases, and runs Selection into `gold` — printing, e.g.:

```
available cases: 3 -> SelectionPool: 2 cases (Question Bank qb-100, run 2026-05-29)
```

The `as_of` date is fixed so the working-day window lines up with the sample feed
and the run is deterministic.
