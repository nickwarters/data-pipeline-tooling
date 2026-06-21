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
with the Case Type's schema enforced (`SchemaCoercion` + `SchemaValidator`
composed onto the hop — see [`schema-enforcement.md`](schema-enforcement.md)). That validated **silver is the
CasePool**: the current-state population of Cases. Sources are current-state
snapshots, so raw and silver are full-refreshed each run (ADR-0006); the
accumulating layer is gold, where the **SelectionPool** lands stamped by run.

## `CaseType` / `Variation` — the declarative domain objects

A **Case Type** is a first-class classification of Cases that determines its
fields, its Variations, and — over time — its ingest/selection/processing
(CONTEXT.md). It is an **explicit declarative object imported directly**, not an
entry in a global domain registry. The minimal `PipelineRunner` registry is only
for dispatching named domain Pipelines such as `cases/ingest` and
`cases/selection` (ADR-0005).

```python
from dataclasses import dataclass
from datetime import date
from case_review.case_type import CaseType, Variation

@dataclass
class ActivityCase:          # the Case Type's schema (its columns + types)
    case_ref: str
    adviser: str
    activity_date: date
    amount: int

CASES = CaseType(
    name="cases",            # the subject: medallion directory + table name;
                             #   also seeds the case_id namespace (ADR-0009)
    schema=ActivityCase,     # enforced at the silver/gold boundaries
    natural_key=("case_ref",),  # identifies a Case; hashed to the deterministic case_id
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
are data, not code. The case-review domain stores only the **reference** id,
never the bank's content (owned by the review platform — CONTEXT.md); Selection
stamps that id onto the chosen Cases. `CaseType.variation(id)` resolves a Variation and
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
from case_review.case_pool import CasePool
from framework.io import StoreCatalog
from tools.calendar import WorkingDayCalendar

store = StoreCatalog("/share").store(CASES.name)
pool = CasePool(CASES, store, WorkingDayCalendar())
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
from typing import Any, Mapping

from framework.core import GOLD
from framework.io import AccumulateByRun, DatasetReader
from framework.run import Pipeline
from framework.transform import Filter, Score, Sort, Stamp


def high_value_case(row: Mapping[str, Any]) -> bool:
    return row["amount"] >= 100


def priority_score(row: Mapping[str, Any]) -> int:
    return row["amount"] * 2


variation = CASES.variation("v1")
p = Pipeline("selection")
r = p.read(DatasetReader(available), name="read")
scored = p.transform(Score("priority_score", priority_score), r, name="score")
high = p.transform(Filter(high_value_case, name="high-value"), scored, name="filter")
ranked = p.transform(Sort("priority_score", ascending=False), high, name="sort")  # top-first
stamped = p.transform(
    Stamp("question_bank_id", variation.question_bank_id), ranked, name="stamp"
)
p.write(
    store.writer(GOLD, "selection_pool", AccumulateByRun(run_id, load_date)),
    stamped,
    name="write",
)
p.run()
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

Write the row rules as named, pure functions rather than inline lambdas once
they are business rules. Name filters and joins that can exclude a Case, keep
predicates/scorers deterministic and free of hidden external state, and extract
shared calculations into helpers that can be tested directly with a small row
`dict`. Row-wise Python keeps rules traceable and portable, but it calls the
predicate/scorer once per row, so do not put network calls, file reads, database
queries, or expensive repeated parsing inside the callable. See
[`processors.md#authoring-selection-rules`](processors.md#authoring-selection-rules)
for the full conventions.

The SelectionPool reaches the review platform as a **Deliverable** (a later
slice); the returned **Review Outcomes** come back through the **Sync** Pipeline,
not here — they live in the Sync store, not the SelectionPool (CONTEXT.md).

Selection is guarded by current Ingest history. The `selection` pipeline declares
a freshness requirement on `ingest` (its `UPSTREAMS` tuple); before running its
handler the framework checks the latest successful upstream run in `RunRegistry`
(caught up from every `_runs/*.log`). A stale Ingest aborts Selection before any
SelectionPool write. A first run with no upstream history is allowed, but a
`freshness` warn-hit is recorded so the missing baseline is visible.

## Explainability — why each Case was (or wasn't) selected

Selecting *which advisers' Cases get reviewed* is itself a governed act that will
be challenged after the fact ("why wasn't this adviser picked up last quarter?").
But `Filter`/`Score`/`JoinWith`/`AntiJoinWith` **silently drop** the Cases they
exclude (ADR-0002 plain-Python callables), leaving no trace.
`.explain(writer, id_column=…)` closes that gap (#53): it is the
eligibility-stage twin of `.quarantine()` (#50) — the same *route aside with a
reason, never silently drop* shape, pointed at
**eligibility** rather than **validity** (ADR-0007 amendment 02).

```python
p = Pipeline("selection")
r = p.read(DatasetReader(available), name="read")
scored = p.transform(Score("priority_score", priority_score), r, name="score")
high = p.transform(Filter(high_value_case, name="high-value"), scored, name="filter")
ranked = p.transform(Sort("priority_score", ascending=False), high, name="sort")
stamped = p.transform(
    Stamp("question_bank_id", variation.question_bank_id), ranked, name="stamp"
)
# land a per-Case trace alongside the SelectionPool (a sibling branch of `stamped`)
p.explain(
    store.writer(GOLD, "selection_trace", AccumulateByRun(run_id, load_date)),
    stamped,
    id_column="case_ref",
    score_column="priority_score",
)
p.write(
    store.writer(GOLD, "selection_pool", AccumulateByRun(run_id, load_date)),
    stamped,
    name="write",
)
p.run()
```

The framework's generic **RowTrace** mechanics land a case-review selection trace
as a sibling table of the SelectionPool, one row per *considered* Case (not just
the survivors), stamped `run_id`:

| `case_ref` | `verdict` | `reason` | `score` | `rank` |
|---|---|---|---:|---|
| `c1` | `selected` | `passed high-value` | 1000 | 1 |
| `c2` | `selected` | `passed high-value` | 240 | 2 |
| `c3` | `excluded` | `excluded by filter 'high-value'` | 160 | — |

Naming a gate (`Filter(..., name="high-value")`, `JoinWith(..., name=…)`,
`AntiJoinWith(..., name=…)`) locates its reasons; an unnamed gate still traces,
under a generic label. Pass `score_column="…"` to retain each Case's score —
kept even for a Case a *later* gate excludes, so a low scorer dropped by a top-N
cut still shows what it scored. A Case dropped by an **inner** `JoinWith` (e.g.
an adviser absent from the hierarchy Reference Data) or by an `AntiJoinWith`
exclusion list is recorded as excluded by that gate, not silently absent. The
run's `explain` step logs the governance counts —
considered / selected / excluded (see [`run-log-format.md`](run-log-format.md)).

Explainability is the trace of *one run*. Re-deriving what Selection *would* have
picked "as of" a past date (reproducibility against accumulated silver — #38) is a
separate concern, deferred to a follow-up.

## End to end — the runnable demo

The whole path for one Case Type is two path-addressed pipelines:
[`../pipelines/ingest/pipeline.py`](../pipelines/ingest/pipeline.py) (CSV feed ->
`raw` -> `silver` (the CasePool) -> `gold`) and
[`../pipelines/selection/pipeline.py`](../pipelines/selection/pipeline.py) (the
available cases -> the `gold` SelectionPool). Run them in order from the repo
root:

```sh
python -m cli run pipelines/ingest /tmp/demo --run-date 2026-05-29
python -m cli run pipelines/selection /tmp/demo --run-date 2026-05-29
```

`selection` declares `ingest` as a freshness upstream (`UPSTREAMS`), so the
framework checks for recent successful `ingest` history before Selection runs,
then prints, e.g.:

```
available cases: 3 -> SelectionPool: 2 cases (Question Bank qb-100, logical run selection:2026-05-29)
```

Each pipeline records its run summary under its name (`ingest`, `selection`) and
`selection` writes the `freshness` guard record. The handlers derive their
`AccumulateByRun` strategy from the `RunContext`
(`AccumulateByRun.from_context(context)`), so each gold row is stamped with the
run's logical run id (default `<pipeline>:run_date`) and `execution_id`.
Re-driving a business run under the same id replaces its rows rather than
duplicating them — over the CLI, `python -m cli run pipelines/selection
/tmp/demo --logical-run-id <id>` (see [operator-cli.md](operator-cli.md)). The
`as_of` date is fixed so the working-day window lines up with the sample feed and
the run is deterministic. Each pipeline can also be run directly with a default
run context (`python -m pipelines.ingest.pipeline /tmp/demo`).
