# Case Review Platform — Data Pipeline Framework

The data pipeline framework ingests data about reviewable work from many heterogeneous sources, processes it through medallion layers, and exposes it to review workflows through clean domain abstractions (e.g. `CasePool`) instead of raw `pandas.read_*` calls.

## Language

**Case**:
A normalized, source-agnostic record representing one thing to be reviewed; every feed maps its raw rows into this common shape.
_Avoid_: record, row, item

**CasePool**:
The full population of Cases, read from the ingested silver/gold data. It exposes intention-revealing, domain-named retrievals (a representative example being `fetch_available_cases(...)`) that pipelines call instead of raw `pandas.read_sql`/`read_csv`. Method names/shapes vary by case type — `fetch_available_cases` is illustrative, not a mandated universal API.
_Avoid_: repository, dataset, queue

**SelectionPool**:
The narrowed set of Cases the Selection pipeline produces by pulling from the CasePool and applying filter/score/sort/join — i.e. the Cases actually chosen for review.
_Avoid_: shortlist, batch

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
An outbound artifact a Pipeline produces for downstream consumption — a file (CSV/Excel/JSON) or a directly-readable view/table.
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
_Avoid_: sampling (until disambiguated), picking

**Sync**:
The Pipeline that pulls the review platform's own state — **Review Outcomes** and its full picture of each Case — into a platform-wide store; one-way inbound, no correlation. Spans all Case Types.
_Avoid_: writeback, reconcile, import

**Reporting**:
The final Pipeline: it reads across all upstream Pipelines, builds the cross-Pipeline views (joining **Review Outcomes** to selected **Cases**) in its own platform-wide medallion, and emits **Deliverables**. Spans all Case Types.
_Avoid_: analytics, BI, warehouse

**Schema** (of a Case Type):
The declared expected columns + types for a Case Type — the single, named replacement for today's scattered, implicit "assume field X exists" checks. A validation contract first (enforced at silver & gold), and the optional basis for typed objects. Currently a dataclass; Pydantic later.
_Avoid_: model, shape, structure (informal)

## Relationships

- A **Case** is produced by exactly one **feed** but conforms to a single common shape regardless of origin
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

A **subject** owns a **medallion**: three SQLite databases, one per **layer** (**raw → silver → gold**), on a network share, isolated from every other subject's files (blast-radius isolation, independent onboarding — ADR-0001). The same `raw → silver → gold` framework is **reused by every Pipeline**:

| Pipeline | Scope | What its gold accumulates |
|----------|-------|---------------------------|
| **Ingest** | per Case Type | A Case Type's Feeds refined to gold; the **CasePool** reads this ingested silver/gold. |
| **Selection** | per Case Type | The **SelectionPool** (chosen Cases), written into gold and emitted as a **Deliverable** to the platform. |
| **Sync** | platform-wide | The review platform's state — **Review Outcomes** + its full picture of each Case (an outcome can change run to run). |
| **Reporting** | platform-wide | Cross-Pipeline views (Outcomes joined to selected Cases), shaped into **Deliverables**. |

So **CasePool** and **SelectionPool** relate to **Ingest** and **Selection** only; **Review Outcomes** live in the **Sync** store. Gold is, in every Pipeline, the accumulating layer whose history survives across runs (stamped `run_id` / `load_date`, idempotent re-run — ADR-0006).

**Store topology (current working assumption).** Logically each Pipeline has its own **Store**. Physically that maps to: one SQLite database **per Case Type** shared by Ingest + Selection; **one** database for **Sync** (all Case Types); **one** for **Reporting** (all Case Types). Separate Python `Store`s/Writers may point at the same underlying database file — the `Store` abstraction is decoupled from the physical file. (Layer names are placeholders — see Flagged ambiguities.)

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
- **CasePool scope** — RESOLVED: a CasePool is **per Case Type**, typed/validated by that type's Schema. A Case Type is an explicit declarative `CaseType` object (schema + Variations) imported directly; a global registry is deferred to runner-era (ADR-0005).
- **Reference Data** — RESOLVED: canonical term **Reference Data** (avoid "master data"/"lookup"). Cross-cutting reference (Adviser hierarchy, product codes, mappings) is modelled as ordinary **Feeds**, each given its **own per-subject medallion**, refined by its own pipeline, and **read-only** to Case Types' Selection (joined in Python). The working-day calendar is a config-seeded **`WorkingDayCalendar`** Python utility (not a feed). No separate reference subsystem. See ADR-0001 (per-subject medallions).
- **Medallion scope** — RESOLVED: a medallion is scoped **per subject** (a Case Type or a Reference Data set) — three files each — for blast-radius isolation and independent onboarding; the single-writer rule holds per file. See ADR-0001.
- **Question Bank ownership** — RESOLVED: the framework stores only a **reference** (`question_bank_id`) on the Variation and stamps it onto selected Cases so the review platform knows which bank to present; the bank's **content** is owned by the review platform.
- **"Pipeline" — term vs class** — RESOLVED: the four end-to-end phases (Ingest/Selection/Sync/Reporting) are **Pipelines** (the domain term). The `Pipeline` *class* (`framework/builder.py`) is finer-grained — a deferred builder for **one Feed/table** — so a domain Pipeline composes one or more class `Pipeline` runs. "Stage" stays reserved for the steps within a single run (read→validate→process→write); "layer" for raw/silver/gold.
- **Inbound vs outbound** — RESOLVED: **Feed** is inbound-only; an outbound artifact is a **Deliverable** (file or directly-readable view). The **Sync** Pipeline is one-way inbound (no push, no correlation); the **SelectionPool** reaches the review platform as a Deliverable emitted by **Selection**.
- **Store topology** — PROVISIONAL (working assumption, not yet an ADR): logically one **Store** per Pipeline; physically one SQLite DB per Case Type shared by Ingest + Selection, one DB for Sync (all Case Types), one for Reporting (all Case Types). Separate Python `Store`s/Writers may point at the same file. Revisit when Sync/Reporting are built.
