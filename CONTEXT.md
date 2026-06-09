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
The per-Case audit of *why* each Case considered by Selection was or wasn't chosen: which **Filter**/**Join** excluded it (located by name), what it **Score**d, and — for survivors — where it ranked. A sibling table of the **SelectionPool**, stamped with the logical run id (`run_id` / `logical_run_id`) and, when run through a `RunContext`, the execution id that matches RunLog/RunRegistry, so the selection decision is defensible after the fact ("why wasn't this Adviser picked up last quarter?"). It is the eligibility-stage twin of **quarantine** (validity) — the same "route aside *with a reason*, never silently drop" shape, pointed at selection rather than schema (issue #53, ADR-0007 amendment 02). Produced by `.explain(writer, id_column=…)` on the Selection pipeline.
_Avoid_: log (it is queryable state, not free text); audit log (reserve for the run-level JSONL)

**Sampling**:
A per-group narrowing technique Selection may apply, reducing each group (one or more key columns, e.g. **Adviser**, or Adviser × region) to at most *N* Cases. Two forms: **ranked** — the highest-scoring *N* per group, deterministic by a score (the common case is *N*=1, "the single highest available per Adviser"); and **random** — *N* drawn at random per group, made **reproducible** by a fixed **seed** (a pure function of input + seed; run-to-run variation comes from the upstream-narrowed population, not the seed — ADR-0010). The cut is itself a **selection decision**: the Cases dropped beyond *N* are excluded *with a reason*, captured by the selection trace (issue #53), never silently absent.
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
A first-class classification of Cases that determines its fields, selection criteria, ingest rules, destination, and processing; new case types are added over time without changing the core. Referred to generically (case type A, B, C…) — the specific set is not yet fixed.
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
An outbound artifact a Pipeline produces for downstream consumption, in one of three concrete forms: a **file** (CSV/Excel/JSON), a **directly-readable view/table** the consumer reads, or **rows pushed to a platform-owned remote list** (a SharePoint Subscription Edition list — the canonical **Selection** Deliverable, one list per Case Type). The push form is an *active* write to a system the framework does not own, not a passive artifact left for collection; files are reserved for **Reporting** outputs. Emitted by a **Writer** — for the SharePoint list, the outbound dual of the **SharePoint Reader** (same source type, both directions).
_Avoid_: report, export, output feed

**Reference Data**:
Shared, cross-cutting data that many Case Types' Selection joins against (e.g. the **Adviser hierarchy**, product codes, mappings). Ingested as ordinary **Feeds** and refined through its own per-subject medallion exactly like a Case Type's data, but **read-only** to Case Types — a Case Type joins it (in Python) and never writes it.
_Avoid_: master data, lookup, static data

### Pipelines

**Pipeline**:
One of the four end-to-end phases of the platform — **Ingest**, **Selection**, **Sync**, **Reporting** — each processing data through its own medallion store(s). (Distinct from the `Pipeline` builder *class*, which composes one Feed/table — see Flagged ambiguities.)
_Avoid_: stage (reserved for the steps within a run), layer (reserved for raw/silver/gold), job

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
The declared expected columns + types for a Case Type — the single, named replacement for today's scattered, implicit "assume field X exists" checks. A validation contract first (enforced at silver & gold), and the optional basis for typed objects. Currently a dataclass; Pydantic later.
_Avoid_: model, shape, structure (informal)

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
(ADR-0002); `.with_processor` is the processing seam; the
**dataclass→validator adapter** is the seam to Pydantic-later (ADR-0005/0008).

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
columns + dtypes validated *before* data lands — ADR-0008); gold is the **grain
boundary** (one-row-per-Case enforced — ADR-0009).

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
validated early. _Here_: the CSV → raw path through the core primitives (issue
#2).

**Vertical slice / tracer bullet**:
A unit of work cut **top-to-bottom through every layer** (rather than building one
layer at a time), delivering a thin but complete capability that proves the path
end-to-end and can be built on. _Here_: features land as numbered slices
(e.g. the `Processor` slice #23, the schema-enforcement slice #7); our
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
caught only run-over-run: the **volume-anomaly guardrail** (`VolumeAnomalyValidator`,
#54) trips when a run's row count deviates wildly from a baseline derived from the
feed's **recent run history** (the run registry), not a hand-set threshold.

**For-each orchestration**:
A repeated-run shape for independent items that all use the same pipeline recipe.
_Here_: `ForEach(items, pipeline_builder, ...).run(context)` calls
`pipeline_builder(item, context)` for each item, using a fresh `Pipeline`
builder and per-item `RunContext` every time. Use it when each file/source item
is its own logical run (including its own logical run id for idempotent
`AccumulateByRun` writes). Do **not** use it for many files that together form
one Feed snapshot; that is a multi-file Reader returning one `Dataset`.

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
| **Ingest** | per Case Type | **History-upstream / current-gold** (ADR-0006 amendment): raw + silver *accumulate* the change-over-time record (the source is a destructive current-state system, so the framework is the historian); gold is *current-only*, **one row per Case** (`case_id`), the clean layer the **CasePool** reads. |
| **Selection** | per Case Type | *Accumulate-by-run* gold: the **SelectionPool** (chosen Cases), an audit trail, written into gold and emitted as a **Deliverable** to the platform. |
| **Sync** | platform-wide | *Accumulate-by-run* gold: the review platform's state — **Review Outcomes** + its full picture of each Case (an outcome can change run to run). |
| **Reporting** | platform-wide | *Accumulate-by-run* gold: cross-Pipeline views (Outcomes joined to selected Cases), shaped into **Deliverables**. |

So **CasePool** and **SelectionPool** relate to **Ingest** and **Selection** only; **Review Outcomes** live in the **Sync** store. **Load strategy is per-feed, owned by the Writer** (the Store maps `layer → location` only — ADR-0006 amendment); there is no longer a single "gold accumulates everywhere" rule. Where a layer accumulates, its history survives across runs (stamped with a logical run id / `load_date` and, when context-driven, execution id; idempotent re-run via delete-by-logical-run — ADR-0006). Ingest's *current* gold is reduced from accumulated silver (`LatestPerKey` by `case_id`) and its one-row-per-Case grain is enforced at the gold boundary (ADR-0009).

**Store topology (current working assumption).** `StoreCatalog(root).store(subject)` mints the subject's **Store** from shared root/configuration. A `Store` binds `(subject, layer, table)` to concrete Readers/Writers over that subject's files; it does not infer load strategy or business meaning from the layer. Physically this maps to one three-file medallion **per subject** for now. Revisit the physical topology when Sync/Reporting are built.

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
- **CasePool scope** — RESOLVED: a CasePool is **per Case Type**, typed/validated by that type's Schema. A Case Type is an explicit declarative `CaseType` object (schema + Variations) imported directly; there is no global CaseType config registry. The minimal runner registry is only for dispatching domain Pipelines by `(case_type, pipeline)` and checking upstream freshness (ADR-0005).
- **Reference Data** — RESOLVED: canonical term **Reference Data** (avoid "master data"/"lookup"). Cross-cutting reference (Adviser hierarchy, product codes, mappings) is modelled as ordinary **Feeds**, each given its **own per-subject medallion**, refined by its own pipeline, and **read-only** to Case Types' Selection (joined in Python). The working-day calendar is a config-seeded **`WorkingDayCalendar`** Python utility (not a feed). No separate reference subsystem. See ADR-0001 (per-subject medallions).
- **Medallion scope** — RESOLVED: a medallion is scoped **per subject** (a Case Type or a Reference Data set) — three files each — for blast-radius isolation and independent onboarding; the single-writer rule holds per file. See ADR-0001.
- **Question Bank ownership** — RESOLVED: the framework stores only a **reference** (`question_bank_id`) on the Variation and stamps it onto selected Cases so the review platform knows which bank to present; the bank's **content** is owned by the review platform.
- **"Pipeline" — term vs class** — RESOLVED: the four end-to-end phases (Ingest/Selection/Sync/Reporting) are **Pipelines** (the domain term). The `Pipeline` *class* (`framework/builder.py`) is finer-grained — a deferred builder for **one Feed/table** — so a domain Pipeline composes one or more class `Pipeline` runs. "Stage" stays reserved for the steps within a single run (read→validate→process→write); "layer" for raw/silver/gold.
- **Inbound vs outbound** — RESOLVED: **Feed** is inbound-only; an outbound artifact is a **Deliverable** (file or directly-readable view). The **Sync** Pipeline is one-way inbound (no push, no correlation); the **SelectionPool** reaches the review platform as a Deliverable emitted by **Selection**.
- **`Dataset` vs CasePool** — RESOLVED (#26): `Dataset` is the framework primitive renamed from `DataHandle` — the opaque, **bulk** in-memory carrier (the bulk tier of the two-tier carrier, ADR-0002; pandas behind the seam), returned by `Reader.read()` and flowing through builders/processors/Writers. It is **not** the **CasePool**, which is the domain population of **Cases** read from silver/gold and surfaced as typed `Case` objects. The two tiers meet only *inside* CasePool: it reads a `Dataset`, then materialises typed Cases. So "dataset" stays an `_Avoid_` alias for the *CasePool concept*, while the capitalised type `Dataset` is the carrier. (Renamed from `DataHandle` because "handle" implies a lightweight pointer; the thing actually owns a tableful of rows — the noun was the onboarding tripwire.)
- **Store topology** — PROVISIONAL (working assumption, not yet an ADR): logically one **Store** per Pipeline; physically one SQLite DB per Case Type shared by Ingest + Selection, one DB for Sync (all Case Types), one for Reporting (all Case Types). Separate Python `Store`s/Writers may point at the same file. Revisit when Sync/Reporting are built.
- **Selection's two writes (gold audit + Deliverable)** — RESOLVED: Selection both writes the **SelectionPool** to its gold (audit trail) and emits it as a **Deliverable** to the SharePoint list. These are **two pipelines, not one run with two writes**: the Selection pipeline lands gold, then a **second pipeline reads the gold SelectionPool and writes to the SharePoint list** — consistent with ADR-0009's "single-Writer pipelines over a shared source" (no multi-Writer terminus, no checkpoint required). Mid-run lineage `.checkpoint(writer)` (#49) is a separate, general-purpose feature and is **not** the mechanism here. See #48.
- **One feed, many tables** — RESOLVED (ADR-0009): the old "one feed → one silver table → one gold table" assumption is dropped. A Feed yields **one Case table and zero or more Detail Tables**; the wide feed is fanned out by **N single-table pipelines over the shared raw table**, each projecting its columns and sharing one reusable normalisation `Processor`. No new core seam (rejected a multi-Writer terminus and a splitting Processor — both break `.write_to`/`.run()`'s single-Writer/single-Dataset shape). Decided; not yet built.
- **Case identity** — RESOLVED (ADR-0009): a Case's identity is a **deterministic** surrogate `case_id = uuid5(case_type_namespace, natural_key)`, derived from the feed's stable natural key — same Case → same id every run/machine, so idempotency holds and the Case ↔ Detail link needs no join. A random `uuid4` is rejected (breaks idempotency); a persistent identity map is the deferred fallback for a feed with no natural key.
- **Load strategy vs layer** — RESOLVED (ADR-0006 amendment): load strategy is **per-feed, owned by the Writer**; the Store maps `layer → location` only (no load decision). The global "refresh upstream / accumulate downstream" rule becomes the *default* profile, not a law. Ingest adopts **history-upstream / current-gold**; Selection/Sync/Reporting keep accumulate-by-run gold. Consequence: where the source is destructive, accumulated raw/silver are a **system of record** (backup matters) and volume grows `records × snapshots`. Decided; not yet built.
