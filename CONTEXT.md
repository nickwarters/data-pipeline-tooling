# Case Review Platform — Data Pipeline Framework

The data pipeline framework ingests data about reviewable work from many heterogeneous sources, processes it through medallion layers, and exposes it to review workflows through clean domain abstractions (e.g. `CasePool`) instead of raw `pandas.read_*` calls.

## Language

**Case**:
A normalized, source-agnostic record representing one thing to be reviewed; every feed maps its raw rows into this common shape. Its grain is **one row per Case**, identified by a deterministic **`case_id`** (`uuid5(case_type_namespace, natural_key)` — stable across runs; ADR-0009).
_Avoid_: record, row, item

**Detail Table**:
A supporting table produced by the *same* Feed as a Case but holding data that does not fit the one-row-per-Case grain — repeated sections (e.g. product 1..10) or child collections — at its own finer grain (many lines per Case). Keyed back to its Case by the deterministic `case_id`, **not independently reviewable**, and rolled up to the Case downstream. A Feed yields exactly **one Case table and zero or more Detail Tables** (ADR-0009).
_Avoid_: child table, sub-table, line item (until disambiguated), Deliverable (that is outbound)

**CasePool**:
The full population of Cases, read from the ingested silver/gold data. It exposes intention-revealing, domain-named retrievals (a representative example being `fetch_available_cases(...)`) that pipelines call instead of raw `pandas.read_sql`/`read_csv`. Method names/shapes vary by case type — `fetch_available_cases` is illustrative, not a mandated universal API.
_Avoid_: repository, dataset (as a name for the CasePool — the capitalised framework primitive `Dataset` is the bulk in-memory carrier, a distinct concept; see Flagged ambiguities), queue

**SelectionPool**:
The narrowed set of Cases the Selection pipeline produces by pulling from the CasePool and applying filter/score/sort/join — i.e. the Cases actually chosen for review.
_Avoid_: shortlist, batch

**Selection trace**:
The per-Case audit of *why* each Case considered by Selection was or wasn't chosen: which **Filter**/**Join** excluded it (located by name), what it **Score**d, and — for survivors — where it ranked. A sibling table of the **SelectionPool**, stamped with the `logical_run_id` and, when run through a `RunContext`, the `pipeline_run_id` that matches RunLog/RunRegistry, so the selection decision is defensible after the fact ("why wasn't this Adviser picked up last quarter?"). It is the eligibility-stage twin of **quarantine** (validity) — the same "route aside *with a reason*, never silently drop" shape, pointed at selection rather than schema (ADR-0008). Produced by `.explain(writer, id_column=…)` on the Selection pipeline.
_Avoid_: log (it is queryable state, not free text); audit log (reserve for the run-level JSONL)

**Selection rule**:
A named, deterministic business rule used by Selection to narrow or rank the CasePool. Predicates back `Filter` gates, scorers back `Score` columns, and joins can also act as named gates when unmatched Cases are excluded. Rules should be pure functions of the Case row plus explicit configuration so they are independently testable and their effects are traceable in the **Selection trace**.
_Avoid_: hidden side-effect rule, ad hoc lambda (for governed business criteria)

**Sampling**:
A narrowing technique Selection may apply, reducing a population to at most *N* Cases — either **per group** (one or more key columns, e.g. **Adviser**, or Adviser × region) or **ungrouped** (the whole feed as one population). Two forms of cut: **ranked** — the highest-scoring *N*, deterministic by a score (the common case is *N*=1, "the single highest available per Adviser"); and **random** — *N* drawn at random, made **reproducible** by a fixed **seed** (a pure function of input + seed; run-to-run variation comes from the upstream-narrowed population, not the seed — ADR-0010). The cut is itself a **selection decision**: the Cases dropped beyond *N* are excluded *with a reason*, captured by the selection trace, never silently absent.
_Avoid_: picking; "sample" as a loose name for the **SelectionPool** as a whole (sampling is one technique that helps produce it, not the result)

**Available Cases**:
An illustrative retrieval on the CasePool: candidate Cases eligible to enter Selection, defined by business availability criteria (e.g. activity dated yesterday; a subset of Advisers within the last 20 working days). Eligibility is computed in Python, not SQL.
_Avoid_: queue, outstanding cases

**Advisor**:
The actor who conducted the work captured in a Case (e.g. gave advice, made a sale).
_Avoid_: agent, rep, salesperson

**Reviewer**:
The actor who reviews a Case.
_Avoid_: checker, assessor

**Case Type**:
A first-class classification of Cases that determines its fields, selection criteria, ingest rules, destination, and processing; new case types are added over time without changing the core. Referred to generically (case type A, B, C…) — the specific set is not yet fixed. It also **owns its identity contract** (ADR-0009): the **natural key** column(s) that identify a Case, and the per-type **namespace** they are hashed under to mint the deterministic `case_id`. The namespace is *derived from the Case Type's name*, so each type gets its own UUID space without a hand-written UUID — at the cost that renaming a Case Type re-keys its history (a rare, documented trade-off). Both the Case builder and each Detail-Table builder read this one contract off the Case Type, so a Case and its Detail rows derive the *same* `case_id` independently — the parent/child link is structural, not a convention kept in step by hand.
_Avoid_: category, kind

**Variation**:
A specialization within a Case Type that inherits the Case Type's config and overrides only what differs — most commonly the Question Bank, occasionally the ingest, selection criteria, or processing. One Case Type has many Variations (A ~3; B ~100). Declarative/data-driven; code only for the rare divergent processing.
_Avoid_: variant, subtype, flavour

**Question Bank**:
The set of questions a Reviewer works through when reviewing a Case; the attribute that most often distinguishes one Variation from another.
_Avoid_: questionnaire, form, checklist (until disambiguated)

**Review Outcome**:
The completed result of a Reviewer reviewing a Case, captured in the (separate) review platform and ingested back by the **Sync** Pipeline as its own **Feed**; joined to the selected Case in **Reporting**.
_Avoid_: result, verdict, assessment

**Feed**:
A single configured **inbound** data stream the framework ingests (e.g. one Excel workbook, one SharePoint list, one SAS extract, the returned Review Outcomes); outbound artifacts are **Deliverables**, not Feeds.
_Avoid_: source (reserved for source *type*: Excel/CSV/SAS/SQLite/SharePoint), import, Deliverable (that is outbound)

**Deliverable**:
An outbound artifact a Pipeline produces for downstream consumption, in one of three concrete forms: a **file** (CSV/Excel/JSON), a **directly-readable view/table** the consumer reads, or **rows pushed to a platform-owned remote list** (a SharePoint Subscription Edition list — the canonical **Selection** Deliverable, one list per Case Type). The push form is an *active* write to a system the framework does not own, not a passive artifact left for collection; files are reserved for **Reporting** outputs. Emitted by a **Writer**: `CsvWriter`, `ExcelWriter`, and `JsonWriter` emit file Deliverables; SQLite Writers emit directly-readable tables; the stubbed `SharePointWriter` is the outbound dual of the **SharePoint Reader** (same source type, both directions).
_Avoid_: report, export, output feed

**Data Dictionary**:
The human-readable description of a table/Feed and what each of its fields *means* — the prose companion to the machine-enforced `schema.py` (columns, dtypes, nullability, value rules). One entry per table per medallion layer (raw column names differ from the canonical silver/gold shape). Stored in **Confluence**; the checked-in [`docs/data-dictionary-template.md`](docs/data-dictionary-template.md) is the source-of-truth template. A new column is not "done" until it has a Data Dictionary row.
_Avoid_: schema (reserved for the enforced dataclass contract), glossary (that is this file, for domain nouns)

**Reference Data**:
Shared, cross-cutting data that many Case Types' Selection joins against (e.g. the **Adviser hierarchy**, product codes, mappings). Ingested as ordinary **Feeds** and refined through its own per-subject medallion exactly like a Case Type's data, but **read-only** to Case Types — a Case Type joins it (in Python) and never writes it.
_Avoid_: master data, lookup, static data

### Pipelines

**Pipeline**:
One of the four end-to-end phases of the platform — **Ingest**, **Selection**, **Sync**, **Reporting** — each processing data through its own medallion store(s). (Distinct from the `Pipeline` builder *class*, which composes one Feed/table from named **Tasks** — see Flagged ambiguities.)
_Avoid_: task (reserved for named units inside a builder run), layer (reserved for raw/silver/gold), job

**Task**:
A stable, named unit of work inside a `Pipeline` builder run. A Task may read, process, validate, write, explain, quarantine, or perform an action; it records its supplied name in `Pipeline.describe()` and the RunLog so later dependency work can address it consistently. Public authoring prefers `.task(name, callable, *inputs)` for dataset→dataset work; existing builder vocabulary such as `.read`, `.transform`, `.validate`, and `.write` remains compatible.
_Avoid_: stage (older/informal for a run step), job, layer

**Run Address**:
A stable dependency-target label for either a whole Pipeline or one named run step inside it. The four label forms are `pipeline`, `subject/pipeline`, `pipeline.step`, and `subject/pipeline.step`; `framework.run.RunAddress` owns parsing and formatting so logs, dependency declarations, and registry queries use the same vocabulary. This follows the DAG design's `pipeline_2.step_4` address shape while the builder can still expose `.task(...)` as the authoring method. Invalid labels are configuration failures, not data or runtime failures.
_Avoid_: ad hoc pipeline key, path (unless referring to a filesystem path)

**Ingest**:
The Pipeline that brings a Case Type's source **Feeds** in and refines them into **Cases** through that Case Type's medallion (raw→silver→gold). Per Case Type.
_Avoid_: import, load, ETL

**Selection**:
The Pipeline that reads the **CasePool** and produces the **SelectionPool** (filter/score/sort/join with other feeds' silver/gold), then emits it as a **Deliverable** to the review platform; governed by a Case Type / Variation's selection criteria. Per Case Type.
_Avoid_: picking; **sampling** (now a defined per-group narrowing *technique* within Selection — see **Sampling** — not a synonym for this Pipeline)

**Sync**:
The Pipeline that pulls the review platform's own state — **Review Outcomes** and its full picture of each Case — into a platform-wide store; one-way inbound, no correlation. Spans all Case Types.
_Avoid_: writeback, reconcile, import

**Reporting**:
The final Pipeline: it reads across all upstream Pipelines, builds the cross-Pipeline views (joining **Review Outcomes** to selected **Cases**) in its own platform-wide medallion, and emits **Deliverables**. Spans all Case Types.
_Avoid_: analytics, BI, warehouse

**Schema** (of a Case Type):
The declared expected columns, types, and field-level nullability/**value rules** for a Case Type — the single, named replacement for today's scattered, implicit "assume field X exists" checks. A validation contract first (enforced at silver & gold), and the optional basis for typed objects. Currently a dataclass; Pydantic later.
_Avoid_: model, shape, structure (informal)

**Value rule** / **Row check**:
The two axes of a **Schema**'s content contract. A **value rule** is *vertical* — one column across many rows (format, length, range, membership, uniqueness), declared on the field via `Annotated`. A **row check** is *horizontal* — one row across many fields, validating the relationship *between* a row's fields (`opened <= closed`; "if status is closed then closed_date is present"). A row check is a plain function over a row returning a breach phrase or `None`, paired with the **footprint** of columns it spans (so a column already failing its dtype check suppresses the check rather than crashing it); declared as `RowCheck`s via the `@row_checks(...)` class decorator above the schema. Both feed the same two consumers — abort (collected into one `SchemaValidator` message) or quarantine (a `failed_rule` reason). Unlike value rules, a row check runs over **every** row including nulls — presence may be the very thing it tests — so the author handles nulls explicitly.
_Avoid_: cross-field rule (informal), constraint

**Schema Drift**:
A **Feed**'s landed column set changing run-over-run — an owner-controlled source (SharePoint list, SAS export) silently adding or dropping a column between snapshots. Detected at the **raw** boundary by diffing the incoming columns against the prior run's landed columns, and surfaced as a **warning** that does not stop the run (raw stays a faithful mirror of the source — ADR-0006). Names-only and run-over-run; a type change on a surviving column is a **Schema Breach**'s concern, not drift.
_Avoid_: schema change, schema mismatch (use the precise term)

**Schema Breach**:
Data violating a Case Type's declared **Schema** (a missing column or wrong dtype) at the **silver** or **gold** boundary — a hard, fail-fast abort (ADR-0005, ADR-0006), not a warning. Contrast **Schema Drift**: drift is a soft, run-over-run *change* signal at raw; a breach is a hard *contract* violation downstream.
_Avoid_: drift, schema error

## Engineering vocabulary (cross-cutting)

General software-engineering terms that recur in design discussion. Unlike the
**Language** above, these are **not** project-specific domain nouns — they are
the shared vocabulary we reason *with*. Each entry notes where it shows up here
so the abstraction stays tied to concrete practice.

**Seam**:
A place where you can change behaviour without editing code *at* that place
(Feathers) — a point where two parts meet through a narrow contract, so one side
can be substituted without the other noticing. _Here_: pandas lives **behind the
`Dataset` seam** (`from_pandas`/`to_pandas`) so the engine is swappable
(ADR-0002); `.transform` / `.task` is the processing seam; the
**dataclass→validator adapter** is the seam to Pydantic-later (ADR-0011, ADR-0006).

**Edge**:
Where the system meets something outside itself — external I/O, or the
hand-off to a different layer/representation. _Here_: **Readers/Writers** sit at
the *I/O edge* (files, SQLite, SharePoint); the **CasePool returning typed
`Case` objects** is the *domain edge*, the "typed-on-demand" edge ADR-0002
reserves for a later slice. A seam is a *substitution* point; an edge is a
*crossing* point — they often coincide but are not the same idea.

**Boundary**:
A line across which a guarantee changes, and therefore the natural place to
**enforce** that guarantee. _Here_: silver is the **schema boundary** (declared
columns + dtypes validated *before* data lands — ADR-0006); gold is the **grain
boundary** (one-row-per-Case enforced — ADR-0009).

**Expected failure / `PipelineError`**:
A *deliberate, fail-fast abort* of a pipeline run — the data or environment broke
a declared expectation, so the run stops on purpose. The distinction we reason
with: an **expected failure** is something an operator should read and act on (a
**Schema Breach**, a stale upstream, an uncoercible value, an unknown pipeline),
versus a **bug** — a defect in our own code that should never have shipped.
_Here_: every expected failure subclasses `PipelineError`, so a run boundary
(the operator CLI, a scaffolded `main()`) catches the whole family with one
`except` and presents it via `format_failure` — kind + message, no stack trace;
a bug is *not* a `PipelineError`, so it keeps its traceback and gets noticed.
Each expected failure also carries a **triage category** (`ErrorCategory`:
`data` / `operational` / `config`) recorded on the run log (`error_category`),
so an operator can route a failure — fix the data, the run, or the wiring —
without reading every message; a bug has no category (the absence is the signal).

**Port / Adapter**:
A **port** is the abstract contract a collaborator must satisfy (in Python, a
`Protocol` — `Reader`, `Writer`, `Validator`); an **adapter** is a concrete
implementation that maps one specific technology onto that port (`CsvReader`,
`SqliteReader`, `SchemaValidator`). Seams are usually *expressed as* ports;
swapping behaviour means supplying a different adapter for the same port.

**Opaque (type / carrier)**:
A type whose concrete innards are deliberately hidden behind its interface, so
callers depend only on the contract and the implementation can change freely.
_Here_: `Dataset` is the **opaque tabular carrier** — pandas today, polars
plausibly later — and the concrete engine must never appear in a `Protocol`
signature, pipeline script, or the domain layer (ADR-0002).

**Walking skeleton**:
A minimal end-to-end implementation that exercises the *whole* architecture —
every layer wired together — before any one part is fleshed out, so the shape is
validated early. _Here_: the CSV → raw path through the core primitives.

**Vertical slice / tracer bullet**:
A unit of work cut **top-to-bottom through every layer** (rather than building one
layer at a time), delivering a thin but complete capability that proves the path
end-to-end and can be built on. _Here_: features land as numbered slices
(e.g. the processor slice, the schema-enforcement slice); our
issue-breakdown deliberately favours these over horizontal layer-by-layer work.

**Blast radius**:
The scope of damage when something goes wrong; good designs **contain** it
through isolation. _Here_: per-subject medallions mean a bad load or corrupt
file is contained to one subject rather than poisoning the whole store
(ADR-0001).

**Fail-fast**:
Detect a violation and stop at the **earliest** boundary, rather than letting bad
data propagate downstream where the failure is harder to trace. _Here_:
**Validators** abort at the silver boundary *before* silver is written, so an
invalid feed never lands. Some failures are invisible per-row — a **truncated
source export** where every row is valid yet thousands are missing — and are
caught only run-over-run: the **volume-anomaly guardrail** (`VolumeAnomalyValidator`) trips when a run's row count deviates wildly from a baseline derived from the
feed's **recent run history** (the run registry), not a hand-set threshold. Its
**statistical sibling** is the **`Profile` task**: it records each column's *shape*
— null rate, distinct count, min/max, a bounded top-N distribution — on the run
log so it can be trended, and (via `ProfileDriftCheck`) warns or fails when a
column's null rate drifts from the same recent-history baseline. Where the volume
guardrail watches one number, profiling generalises it to any column, catching a
silent regression like a field quietly sliding 5% → 60% null.

**For-each orchestration**:
A repeated-run shape for independent items that all use the same pipeline recipe.
_Here_: `ForEach(items, pipeline_builder, ...).run(context)` calls
`pipeline_builder(item, context)` for each item, using a fresh `Pipeline`
builder and per-item `RunContext` every time. Use it when each file/source item
is its own logical run (including its own logical run id for idempotent
`AccumulateByRun` writes). It is fail-fast by default, or can explicitly run
best-effort and return one success/failure outcome per item while preserving the
original exception for failed items. Do **not** use it for many files that
together form one Feed snapshot; that is a multi-file Reader returning one
`Dataset`.

**Dated-file discovery** (`tools.discovery`):
Source-artifact discovery for dated-file catch-up, modelled as an orchestration
concern (not a Reader). _Here_: `DatedFileDiscovery(directory, pattern)` scans
a directory for files whose names encode a business date using a
`{date:FORMAT}` placeholder (e.g. `"claims_{date:%Y%m%d}_*.csv"`).
`.available_between(start, end)` returns `SourceArtifact` value objects —
each with `path`, `business_date`, and a stable `file_id` — for every file
where `start < business_date <= end`, sorted deterministically by
`(business_date, path)`. Pair with `ForEach` when each file needs its own run
history, retry boundary, and idempotency key. Use `GlobCsvReader` instead when
all matched files together form one logical Feed snapshot.

**Scheduled orchestration**:
The framework-level coordinator that decides which pipelines are due for a run
date. _Here_: an `Orchestrator` owns one or more `PipelineSet`s of
`ScheduledPipeline` items, each naming a `pipelines/<name>` path, and invokes the
due ones **by that path at runtime** — the same addressing as the `run` command,
so no handler registry is wired up front; it is not a Pipeline that runs other
Pipelines. Python
definitions own the canonical sets, dependencies, and default schedules, while
YAML may override enablement, timing, and freshness windows. Schedules are
expressed with the friendly `Schedule.*` constructors (`Schedule.daily()`,
`Schedule.on_weekdays("monday", …)`, `Schedule.day_of_month(n)`,
`Schedule.nth_working_day_of_month(n)`, `Schedule.last_working_day_of_month()`,
`Schedule.manual_only()`) over the concrete schedule classes, keeping `is_due`
the core protocol. Decisions are
recorded in `_orchestration/runs.db`; actual executions remain in
`RunLog` / `RunRegistry`. Failures are isolated: a failed scheduled item blocks
its downstream dependants for that orchestrator run, but independent items and
other PipelineSets continue.

## Relationships

- A **Case** is produced by exactly one **feed** but conforms to a single common shape regardless of origin
- A **Feed** yields exactly **one Case table and zero or more Detail Tables**; a wide feed is fanned out by **N single-table pipelines over the shared raw table** (each projecting its own columns), not a multi-Writer terminus or a splitting processor (ADR-0009)
- A **Detail Table** holds many lines per **Case**, linked by the deterministic **`case_id`**, and is rolled up to the Case downstream — never independently reviewed
- A **CasePool** returns many **Cases**
- A **Case** records the **Advisor** who conducted it
- A **Reviewer** reviews **Cases**
- A **Case Type** has one or more **Variations**; every **Case** belongs to one Case Type and (where applicable) one Variation
- A **Variation** references the **Question Bank** (`question_bank_id`) the Reviewer uses; that id is stamped onto selected Cases (content owned by the review platform)
- The four **Pipelines** form a loop: **Ingest** → **Selection** (emits a **Deliverable** to the platform) → *[platform reviews]* → **Sync** (ingests the returned **Review Outcomes** Feed) → **Reporting** (joins all, emits **Deliverables**)
- **Ingest** and **Selection** are **per Case Type**; **Sync** and **Reporting** are **platform-wide** (span all Case Types)
- Selection flow: **CasePool** (all Cases) → Selection → **SelectionPool** (chosen Cases)
- **Reference Data** (e.g. Adviser hierarchy, product codes) lives in its own medallion, shared across Case Types; a Case Type's **Selection** reads it (joined in Python) but never writes it

## Pipelines, layers & stores

A **subject** owns a **medallion**: three SQLite databases, one per generic framework **layer** (**raw → silver → gold**), on a network share, isolated from every other subject's files (blast-radius isolation, independent onboarding — ADR-0001). The same `raw → silver → gold` framework is **reused by every Pipeline**; business meanings such as "current CasePool" or "SelectionPool audit" are imposed by the application pipeline, not by the layer names themselves:

| Pipeline | Scope | Load profile & what its gold holds |
|----------|-------|------------------------------------|
| **Ingest** | per Case Type | **History-upstream / current-gold** (ADR-0004): raw + silver *accumulate* the change-over-time record (the source is a destructive current-state system, so the framework is the historian); gold is *current-only*, **one row per Case** (`case_id`), the clean layer the **CasePool** reads. |
| **Selection** | per Case Type | *Accumulate-by-run* gold: the **SelectionPool** (chosen Cases), an audit trail, written into gold and emitted as a **Deliverable** to the platform. |
| **Sync** | platform-wide | *Accumulate-by-run* gold: the review platform's state — **Review Outcomes** + its full picture of each Case (an outcome can change run to run). |
| **Reporting** | platform-wide | *Accumulate-by-run* gold: cross-Pipeline views (Outcomes joined to selected Cases), shaped into **Deliverables**. |

So **CasePool** and **SelectionPool** relate to **Ingest** and **Selection** only; **Review Outcomes** live in the **Sync** store. **Load strategy is per-feed, owned by the Writer** (the Store maps `layer → location` only — ADR-0004); there is no longer a single "gold accumulates everywhere" rule. Where a layer accumulates, its history survives across runs (stamped with a logical run id / `load_date` and, when context-driven, execution id; idempotent re-run via delete-by-logical-run — ADR-0004). Ingest's *current* gold is reduced from accumulated silver (`LatestPerKey` by `case_id`) and its one-row-per-Case grain is enforced at the gold boundary (ADR-0009).

**Store topology (current working assumption).** Where a feed lands is **application infrastructure**, not framework vocabulary (#232): the opaque **`namespace`** (a *logical database*, one file holding many related tables) → file mapping lives in the sibling `tools.store`. `StoreRegistry(root).store(namespace)` mints a namespace **Store** that binds `(namespace, table)` to concrete Readers/Writers; it does not infer load strategy or business meaning. `StoreRegistry` also registers named Readers/Writers (`register(name, reader|writer)` → `reader(name)` / `writer(name)`) so a pipeline refers to a component by name. The raw/silver/gold **medallion is an application-level profile** (`tools.medallion.medallion(registry, subject)` → `.raw`/`.silver`/`.gold` namespace Stores), layered over the same `tools.store`. Physically the medallion still maps to one three-file medallion **per subject** for now (`<subject>/{raw,silver,gold}.db`). A normalised schema can span several namespaces (one database per namespace; cross-database joins stay in Python). Revisit the physical topology when Sync/Reporting are built.

## Example dialogue

> **Dev:** "When Selection runs for case type B variation 47, does it read a different table than variation 12?"
> **Domain expert:** "Same ingested data — variations mostly differ by **Question Bank**. 47 might also override the selection criteria, but it's pulling from the same **CasePool**."
> **Dev:** "And 'available cases' — is that everything in the pool?"
> **Domain expert:** "No. The **CasePool** is *all* cases; 'available' is the eligible candidates — say, activity dated yesterday, or these **Advisers** within the last 20 working days. Selection narrows the pool down into the **SelectionPool**."
> **Dev:** "Where do the reviewers' answers go?"
> **Domain expert:** "That's the separate review platform — we don't host the reviewing. We push the **SelectionPool** out to it as a **Deliverable**; their **Review Outcomes** come *back* as a Feed the **Sync** Pipeline ingests."
> **Dev:** "And how does an outcome end up next to the Case it belongs to?"
> **Domain expert:** "That join happens in **Reporting** — it reads across all the Pipelines and shapes the **Deliverables**. Sync just mirrors the platform; it doesn't correlate."

## Flagged ambiguities

- "advisor" vs "agent" — RESOLVED: synonyms; **Advisor** is canonical, "agent" avoided.
- "activity" vs "sale" vs "other things" — RESOLVED: these are **Case Types** (open-ended, generic A/B/C…), each with its own fields/selection/ingest/destination/processing.
- Medallion layer names "bronze/silver/gold" (a.k.a. raw/silver/gold) are **placeholders** — to be renamed by domain later. Using raw/silver/gold for now.
- **CasePool scope** — RESOLVED: a CasePool is **per Case Type**, typed/validated by that type's Schema. A Case Type is an explicit declarative `CaseType` object (schema + Variations) imported directly; there is no global CaseType config registry. The minimal runner registry is only for dispatching domain Pipelines by `(case_type, pipeline)` and checking upstream freshness (ADR-0011).
- **Reference Data** — RESOLVED: canonical term **Reference Data** (avoid "master data"/"lookup"). Cross-cutting reference (Adviser hierarchy, product codes, mappings) is modelled as ordinary **Feeds**, each given its **own per-subject medallion**, refined by its own pipeline, and **read-only** to Case Types' Selection (joined in Python). The working-day calendar is a config-seeded **`WorkingDayCalendar`** Python utility (not a feed). No separate reference subsystem. See ADR-0001 (per-subject medallions).
- **Medallion scope** — RESOLVED: a medallion is scoped **per subject** (a Case Type or a Reference Data set) — three files each — for blast-radius isolation and independent onboarding; the single-writer rule holds per file. See ADR-0001.
- **Question Bank ownership** — RESOLVED: the framework stores only a **reference** (`question_bank_id`) on the Variation and stamps it onto selected Cases so the review platform knows which bank to present; the bank's **content** is owned by the review platform.
- **"Pipeline" — term vs class** — RESOLVED: the four end-to-end phases (Ingest/Selection/Sync/Reporting) are **Pipelines** (the domain term). The `Pipeline` *class* (`framework/run/builder.py`) is finer-grained — a deferred builder for **one Feed/table** — so a domain Pipeline composes one or more class `Pipeline` runs. The class can be inspected before execution with `.describe()`, which renders the same ordered plan that `.run()` executes: reader, explicit read dependencies, ordered Tasks, governance outputs, writer, and run-log sink without running the feed. A **Task** is a named unit within one class-level run (`Reader -> Dataset -> Task* -> Writer`), such as validation, processing, or an explicit checkpoint write; it is not a domain Pipeline, medallion layer, or second terminus. "Stage" is older/informal wording for this run-step idea, while "Layer" stays reserved for raw/silver/gold.
- **Inbound vs outbound** — RESOLVED: **Feed** is inbound-only; an outbound artifact is a **Deliverable** (file or directly-readable view). The **Sync** Pipeline is one-way inbound (no push, no correlation); the **SelectionPool** reaches the review platform as a Deliverable emitted by **Selection**.
- **`Dataset` vs CasePool** — RESOLVED: `Dataset` is the framework primitive renamed from `DataHandle` — the opaque, **bulk** in-memory carrier (the bulk tier of the two-tier carrier, ADR-0002; pandas behind the seam), returned by `Reader.read()` and flowing through builders/processors/Writers. It is **not** the **CasePool**, which is the domain population of **Cases** read from silver/gold and surfaced as typed `Case` objects. The two tiers meet only *inside* CasePool: it reads a `Dataset`, then materialises typed Cases. So "dataset" stays an `_Avoid_` alias for the *CasePool concept*, while the capitalised type `Dataset` is the carrier. (Renamed from `DataHandle` because "handle" implies a lightweight pointer; the thing actually owns a tableful of rows — the noun was the onboarding tripwire.)
- **Store topology** — PROVISIONAL (working assumption, not yet an ADR): the framework addresses an opaque **`namespace`** (a logical database) → file; a **Store** is namespace-scoped and binds `(namespace, table)` → Readers/Writers (#232). The raw/silver/gold **medallion** is an application profile (`tools.medallion`) over that, no longer framework vocabulary. Physically one SQLite DB per Case Type shared by Ingest + Selection, one DB for Sync (all Case Types), one for Reporting (all Case Types). Separate Python `Store`s/Writers may point at the same file. Revisit when Sync/Reporting are built.
- **Selection's two writes (gold audit + Deliverable)** — RESOLVED: Selection both writes the **SelectionPool** to its gold (audit trail) and emits it as a **Deliverable** to the SharePoint list. These are **two pipelines, not one run with two writes**: the Selection pipeline lands gold, then a **second pipeline reads the gold SelectionPool and writes to the SharePoint list** — consistent with ADR-0009's "single-Writer pipelines over a shared source" (no multi-Writer terminus, no checkpoint required). Mid-run lineage (a `.write()` node placed mid-graph) is a separate, general-purpose feature and is **not** the mechanism here.
- **One feed, many tables** — RESOLVED (ADR-0009): the old "one feed → one silver table → one gold table" assumption is dropped. A Feed yields **one Case table and zero or more Detail Tables**; the wide feed is fanned out by **N single-table pipelines over the shared raw table**, each projecting its columns and sharing one reusable normalisation `Processor`. No new core seam (rejected a multi-Writer terminus and a splitting Processor — both break the single-Writer/single-Dataset shape). Built through `SelectColumns`, `Unpivot`, `DeriveKey`, `LatestPerKey`, `UniqueValidator`, and the case-review gold helpers.
- **Case identity** — RESOLVED (ADR-0009): a Case's identity is a **deterministic** surrogate `case_id = uuid5(case_type_namespace, natural_key)`, derived from the feed's stable natural key — same Case → same id every run/machine, so idempotency holds and the Case ↔ Detail link needs no join. A random `uuid4` is rejected (breaks idempotency); a persistent identity map is the deferred fallback for a feed with no natural key.
- **Load strategy vs layer** — RESOLVED (ADR-0004): load strategy is **per-feed, owned by the Writer**; the Store maps `layer → location` only (no load decision). The global "refresh upstream / accumulate downstream" rule becomes the *default* profile, not a law. Ingest can adopt **history-upstream / current-gold**; Selection/Sync/Reporting keep accumulate-by-run gold. Consequence: where the source is destructive, accumulated raw/silver are a **system of record** (backup matters) and volume grows `records × snapshots`. Built through explicit Writer strategies (`Refresh`, `AccumulateByRun`, `UpsertStrategy`).
- **Atomicity of run artifacts (publish unit)** — RESOLVED (ADR-0005): a run's artifacts — **quarantine** rejects, the **Selection trace**, **checkpoints**, and the final output — are **independently committed evidence**, *not* one all-or-nothing publish unit. Atomicity is **per writer, per layer DB** (a single delete+insert), not across writers; an abort *after* an artifact write leaves that artifact on disk. Chosen deliberately: evidence is most valuable when the run then fails. Each run-log step carries a **`committed`** marker so operators can see what landed before an abort. Hardening the per-writer transaction itself is a separate concern.
