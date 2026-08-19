# The Selection flow — Case Type declarations, CasePool, SelectionPool

The domain capstone ties the primitives the earlier slices built into the
full per-Case-Type path the framework exists to make routine: a source feed is
**ingested** into a Case Type's medallion, surfaced as a **CasePool**, then
**Selection** narrows it into the **SelectionPool** written to gold. This doc
covers the declarative Case Type data (schema, identity, and `Variation`), the `CasePool`
that reads the current ingested gold, and the Selection pipeline that produces
the SelectionPool. For the domain language behind the terms, see
[`../CONTEXT.md`](../CONTEXT.md); for the processors Selection composes, see
[`processors.md`](processors.md).

## Where this sits

```
  Ingest (per Case Type)            Selection (per Selection group)
  ┌───────────────────────┐        ┌──────────────────────────────────┐
  feed → raw → silver → gold ─▶ CasePool ─▶ filter/score/sort/stamp ─▶ gold
                     (current)   (available cases)         (the SelectionPool)
  └───────────────────────┘        └──────────────────────────────────┘
```

**Ingest** lands a feed into `raw` (schema-light), refines it into accumulated
`silver` with the Case Type's schema enforced (`SchemaCoercion` +
`SchemaValidator` composed onto the hop — see
[`schema-enforcement.md`](schema-enforcement.md)), then reduces it into current
ingested `gold`: the **CasePool**. The separate **Selection** pipeline lands the
**SelectionPool** in its own gold table, stamped by run.

## Case Type declarations / `Variation`

A **Case Type** is a first-class classification of Cases that determines its
fields, its Variations, and — over time — its ingest/selection/processing
(CONTEXT.md). A feed keeps the row schema, identity values, and Variations
together as **explicit module data**, not an entry in a global domain registry.
There is no `CaseType` wrapper: `Variation` and the tuple lookup
`variation_by_id` live in the canonical `case_review.variation` module.
The minimal `PipelineRunner` registry is only for dispatching named domain
Pipelines such as `cases/ingest` and `cases/selection`.

```python
from dataclasses import dataclass
from datetime import date
from case_review.variation import Variation, variation_by_id

@dataclass
class ActivityCase:          # the Case Type's schema (its columns + types)
    case_ref: str
    adviser: str
    activity_date: date
    amount: int

NAMESPACE = "cases"            # medallion directory, table, case_id namespace
NATURAL_KEY = ("case_ref",)    # identifies a Case
VARIATIONS = (
    Variation(id="v1", question_bank_id="qb-100"),
    Variation(id="v2", question_bank_id="qb-200"),
)

variation_by_id(VARIATIONS, "v1").question_bank_id   # -> "qb-100"
```

A **Variation** is a specialization within a Case Type that inherits its config
and overrides only what differs — most commonly the **Question Bank**
(`question_bank_id`). One Case Type has many Variations (A ~3; B ~100), so they
are data, not code. The case-review domain stores only the **reference** id,
never the bank's content (owned by the review platform — CONTEXT.md); Selection
stamps that id onto the chosen Cases. Selection resolves a Variation by its
declared `id` and raises `KeyError("No Variation with id '<id>'")` on an unknown
id, so a misconfiguration surfaces where it is asked for rather than as a silent
miss downstream. Further overrides (ingest, selection criteria, divergent
processing) are deferred.

## `CasePool` — the domain population, behind intention-revealing reads

The `CasePool` is the clean domain abstraction the platform exposes *instead of*
raw `pandas.read_*` calls (CONTEXT.md). It is scoped **per Case Type**,
constructed from that type's gold table name and schema, its **gold** `Store`
(to read its current Cases), and a `WorkingDayCalendar` (the availability
arithmetic — see [`working-day-calendar.md`](working-day-calendar.md)). In this
API, `CasePool` accepts the table name and schema explicitly; the caller sources
those values from the feed's declarations:

```python
from case_review.case_pool import CasePool
from tools.store import StoreRegistry
from tools.calendar import WorkingDayCalendar
from tools.medallion import medallion

med = medallion(StoreRegistry("/share"), NAMESPACE)
pool = CasePool(NAMESPACE, ActivityCase, med.gold, WorkingDayCalendar())
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

1. reads the Case Type's current **gold** table through the `Store`;
2. repairs the round-trip-lossy date column toward the schema's types
   (`SchemaCoercion` — SQLite stores dates as text), so the window comparison is
   date-vs-date;
3. narrows to the working-day window in **Python**, never SQL.

A bare `WorkingDayCalendar()` counts weekends only, so a bank holiday inside the
window silently narrows it by a day. `pipelines/selection` therefore seeds its
calendar from the `calendar` run parameter — `--param
calendar=/config/calendar.yml`, the same file `orchestrate --calendar` reads — so
the window and the schedule agree about which days were working days.

It returns the bulk-tier `Dataset` (the carrier), which flows straight into the
Selection pipeline. Surfacing fully typed `Case` objects is the
**typed-on-demand** edge at the domain layer — the *concept* of
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

from case_review.variation import variation_by_id
from framework.io import AccumulateByRun, DatasetReader
from framework.run import Pipeline
from framework.transform import Filter, Score, Sort, Stamp


def high_value_case(row: Mapping[str, Any]) -> bool:
    return row["amount"] >= 100


def priority_score(row: Mapping[str, Any]) -> int:
    return row["amount"] * 2


variation = variation_by_id(VARIATIONS, "v1")
p = Pipeline("selection")
r = p.read(DatasetReader(available), name="read")
scored = p.transform(Score("priority_score", priority_score), r, name="score")
high = p.transform(Filter(high_value_case, name="high-value"), scored, name="filter")
ranked = p.transform(Sort("priority_score", ascending=False), high, name="sort")  # top-first
stamped = p.transform(
    Stamp("question_bank_id", variation.question_bank_id), ranked, name="stamp"
)
p.write(
    med.gold.writer("selection_pool", AccumulateByRun(logical_run_id, load_date)),
    stamped,
    name="write",
)
p.run()
```

The **availability and selection criteria are specific Python processors** —
`Filter`/`Score`/`Sort` carry plain-Python row rules, and `Stamp`
records the Variation's `question_bank_id` on every chosen Case. The result is
the **SelectionPool**: the narrowed set of Cases actually chosen for review,
accumulated into **gold** by the `AccumulateByRunWriter` (stamped `logical_run_id` /
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

> **Caution — written when Ingest and Selection shared a cadence.**
> A `FreshnessRequirement` defaults to `max_age_days=0`, i.e. *"the upstream
> succeeded today"*. Where Ingest is **monthly** and Selection is **daily**, that
> default blocks Selection on roughly twenty days in every twenty-one. Selection
> reads the persisted **CasePool**, not the day's file, so the requirement should
> either be widened (`.within_days(...)`, past the delivery interval) or dropped
> in favour of the same-day requirement on **Sync** that Selection genuinely
> needs — it cannot size the **Hopper** without today's unallocated count. Which
> of the two is right is **not yet decided**; do not copy this paragraph into a
> new feed without choosing.
>
> `pipelines/complaint_selection` has since decided, for itself: it takes
> **both** branches, deliberately, rather than one instead of the other — see
> its own section below.

## Explainability — why each Case was (or wasn't) selected

Selecting *which advisers' Cases get reviewed* is itself a governed act that will
be challenged after the fact ("why wasn't this adviser picked up last quarter?").
But `Filter`/`Score`/`JoinWith`/`AntiJoinWith` **silently drop** the Cases they
exclude (they are plain-Python callables), leaving no trace.
`.explain(writer, id_column=…)` closes that gap: it is the
eligibility-stage twin of `.quarantine()` — the same *route aside with a
reason, never silently drop* shape, pointed at
**eligibility** rather than **validity**.

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
    med.gold.writer("selection_trace", AccumulateByRun(logical_run_id, load_date)),
    stamped,
    id_column="case_ref",
    score_column="priority_score",
)
p.write(
    med.gold.writer("selection_pool", AccumulateByRun(logical_run_id, load_date)),
    stamped,
    name="write",
)
p.run()
```

The framework's generic **RowTrace** mechanics land a case-review selection trace
as a sibling table of the SelectionPool, one row per *considered* Case (not just
the survivors), stamped `logical_run_id`:

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
picked "as of" a past date (reproducibility against accumulated silver) is a
separate concern, deferred to a follow-up.

## End to end — the runnable demo

The whole path for one Case Type is two path-addressed pipelines:
[`../pipelines/ingest/pipeline.py`](../pipelines/ingest/pipeline.py) (CSV feed ->
`raw` -> `silver` -> `gold` (the CasePool)) and
[`../pipelines/selection/pipeline.py`](../pipelines/selection/pipeline.py) (the
available cases -> the `gold` SelectionPool). Run them in order from the repo
root:

```sh
python -m cli run pipelines/ingest --base-dir /tmp/demo --run-date 2026-05-29
python -m cli run pipelines/selection --base-dir /tmp/demo --run-date 2026-05-29
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
run's logical run id (default `<pipeline>:run_date`) — and, from the Writer
rather than the strategy, with the `pipeline_run_id` of the attempt that wrote
it.
Re-driving a business run under the same id replaces its rows rather than
duplicating them — over the CLI, `python -m cli run pipelines/selection
--base-dir /tmp/demo --logical-run-id <id>` (see [operator-cli.md](operator-cli.md)). The
`as_of` date is fixed so the working-day window lines up with the sample feed and
the run is deterministic. Each pipeline can also be run directly with a default
run context (`python -m pipelines.ingest.pipeline /tmp/demo`).

## Complaint Selection — a deployed Selection group

`pipelines/complaint_selection/` is the same shape put to real use: Complaints
A/B/C are one SAS complaints export split three ways, each its own Case Type
ingest (source -> raw -> silver, no gold — CONTEXT.md's Selection group entry
treats the three as one group). `SELECTION_GROUP` in
`pipelines/complaint_selection/pipeline.py` is the one place a Case Type joins
the group: a Shared Reader over its silver, its natural-key column, and its
priority rule.

The group's output does not belong to any one Case Type's medallion, so it
lands in its own plain namespace store under `<base_dir>/selection_output/` —
`complaint_selection.db` (`selection_pool` + `selection_trace`) plus
`selection_pool.json`, i.e. `CWD/data/selection_output` under the dev default.
The JSON file is an inspection artifact, not a second copy of history: it holds
only the latest run's pool (`Refresh`, overwritten every run), beside a database
that accumulates one row per run per Case selected (`AccumulateByRun`) — the two
intentionally differ once a base directory has more than one run behind it.

The freshness Caution above is resolved here by taking **both** branches, for
two different reasons that happen to sit in the one `UPSTREAMS` tuple. Each
Case Type's ingest is widened: `max_age_days=10` (the export is weekly, so
weekly plus slack), not same-day. `sharepoint_cases` is **not** widened —
its default `max_age_days=0` ("succeeded today") stands, because this run
sizes the **Hopper** from today's unallocated count (see the Hopper section
below) and a cap must not be sized against a number that might already be
stale. `sharepoint_cases` is orchestrated daily in the `case_management`
schedule set ahead of `complaint_selection`'s own `selection` set, and
`reviewer_activity` already depends on the same bare label, so this resolves
in production; the default first-run policy (warn) still lets a fresh
environment — no `sharepoint_cases` history at all yet — run, where "no
history seen, fill to the declared depth" is genuinely correct.

Every requirement here resolves against the **bare** run-history label each
upstream records under (`complaints_a`, `sharepoint_cases`, and siblings) —
the label `python -m cli run pipelines/complaints_a` records, not the
subject-qualified label (`complaints_a/complaints_a`) an ingest run via its own
`python -m pipelines.complaints_a.pipeline` module-main records instead. So
the complaints ingests must be run path-addressed for their requirement to
ever resolve against real history; run any other way, it is stuck on the
silent first-run "allow" fallback forever. `orchestrate --app
case_review.schedules` schedules `complaint_selection` itself but does not run
the three ingests — they are not on any schedule — so something else (an
operator, a separate job) still has to run them path-addressed for that
requirement to mean anything.

The deployed group narrows in two ways today: a fixed-threshold `Filter`
(`PRIORITY_THRESHOLD`) and a Hopper cap (`HOPPER_DEPTH`, see below) — still no
volume target or composition split, unlike the plans-per-group model the rest
of this doc describes. And until the three complaints feeds have run at least
once in a base directory, its daily schedule warns first-run (no upstream
history) and then fails outright once it tries to read a silver database that
does not exist yet — expected until ingest history exists.

### Hopper cap — ADR-0021, a declared starting depth

`HOPPER_DEPTH = 60` is a declared placeholder for the ADR's sizing rule, `3D`
(three times the group's daily *assignment* rate) — monitoring real throughput
and adjusting the constant from it is the recorded follow-up, not yet done.
Each run tops the cap up from a **direct count** of the group's unallocated
Cases (`unallocated_case_count`): Cases in `To-allocate` — the status the
platform creates a Case in and the one its allocation claim replaces — joined
by title to the Cases *this pool has already selected*. One status equality on
the sync gold, per CONTEXT.md's **Hopper** entry: no scan for a blank assigned
reviewer, which would reintroduce the by-elimination read the platform's
`To-allocate` status (`platform_frontend/docs/adr/0051-to-allocate-is-the-status-a-case-starts-in.md`)
exists to remove. Never `target − completed − voided` either (ADR-0021): a
Case that is assigned but not yet finished has left the Hopper without
reaching any terminal state, so that arithmetic overstates what is actually
sitting there.

### Void replacement — ADR-0021, in reduced form

The group also implements [ADR-0021](adr/0021-selection-plans-per-group-over-the-whole-eligible-pool.md)'s
**void replacement**: a Case voided since Complaint Selection's own previous
successful run is made good like-for-like, and a currently-voided Case is never
itself re-selected (CONTEXT.md's **Void replacement**). `MATCH_LADDER` in
`pipelines/complaint_selection/pipeline.py` is the configured, ordered set of
match attempts and the one place to change like-for-like matching.

Say this plainly so nobody mistakes it for a live attribute match:
`attribute_a` and `related_date` are **dormant placeholders**, all-`None` until
a feed actually carries them, so today the ladder's first two rungs never
match anything and the live rung is always `("case_type",)` — the third and
last. With `related_date` also always `None`, its "oldest first" tie-break has
nothing to compare and degrades to the pool's existing sorted order (by
`priority_score`), so the effective rule today is "the highest-priority
same-case-type Case not already claimed". The pairing a replacement made is
recorded on the selected pool row itself — `replaces_case_ref` +
`void_match_rung` — never as an extra or below-threshold selection: steering
never gates.

The replacement window is **since Complaint Selection's own previous
successful run**, not the ADR's "since the last working day" — a deliberate
deviation. It needs no `WorkingDayCalendar` threaded through, and it
self-corrects across a missed run (a skipped day's voids are still "since the
previous success" the day it next runs) rather than silently losing them at a
fixed weekend/holiday boundary. The comparison is **instant-grain**: both ends
are parsed to timezone-aware `datetime`s before comparing (never string
comparison — a naive-vs-offset string compare sorts on the separator character
alone and can silently drop a same-day void).

**The two failure directions are handled differently, deliberately.** A
*stale* `sharepoint_cases` — history exists, but not from today — **blocks the
run outright**, via the same-day `FreshnessRequirement` above: a cap must not
be sized against a number that might already be wrong, so over-filling is the
failure that requirement exists to prevent. An *absent* `sharepoint_cases` — a
fresh environment with no sync history at all yet — degrades safely instead:
the freshness guard's first-run policy (warn) lets the run through, and the
soft-dependency reads (`voided_cases`, `unallocated_case_count`) each catch
exactly the reader's own `sqlite3.OperationalError` and answer "no voids seen"
/ "0 unallocated" — correct there, since filling to the declared depth with no
signal otherwise is the right default for an environment with no history to
read.

The ADR's other change — **rung-first sort** (void-replacement rung, then
oldest by related date, as the single sort choosing every Case) is no longer
fully deferred: **queue order is consumed now**, by the Hopper. Ahead of the
`hopper` gate, `replacements_first` reorders the pool — this run's
replacements lead, oldest void first — with priority-desc standing in for
"oldest by related date" while `related_date` stays dormant (not a second sort
over the whole pool: with a ladder, rung is a relation between one void and
one candidate, not a column every row can be ranked by). The `hopper` gate
then cuts the queue at its remaining capacity; a Case it cuts still lands in
the trace with its score (`excluded by gate 'hopper'`) — the gate the trace
observes, never a limit on the read (ADR-0021). `rank` in `selection_trace`
now records **queue position**, so a replacement can rank above a Case that
scored higher than it. A replacement past capacity is cut like any other
Case, but rarely: the oldest voids' replacements lead the queue and so survive
first, and only a shortfall smaller than the number of replacements themselves
reaches one at all, cutting the *youngest* voids' first. The run's printed
`voids: ... replaced, ... lapsed` counts from the landed pool, so a
replacement that *was* matched but didn't survive the cut is indistinguishable
there from one that never matched at all — both read as "not replaced" in the
summary, even though only the latter is a lapse in ADR-0021's sense (no
candidate at all). The existing `Sort("priority_score", ascending=False)` is
unchanged; queue order sits downstream of it.

Voids are matched by **title**, which `readers.sharepoint_cases` hands back as
the sync feed's own Case title — joined here as the Complaint Selection
`case_ref`. A Case Reference is unique only *within* a Case Type, which is
sound here only because Complaints A/B/C share one id space by construction;
a void whose title matches nothing in *this* pool (another Case Type entirely,
or a Case never selected) is dropped rather than guessed at — CONTEXT.md's "a
void with no candidate lapses, never carries forward" reading applies equally
to a void this pool never had a stake in.
