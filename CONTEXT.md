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
The completed result of a Reviewer reviewing a Case, captured in the (separate) review platform and ingested back into the framework as its own feed for reporting.
_Avoid_: result, verdict, assessment

**Feed**:
A single configured inbound data stream the framework ingests (e.g. one Excel workbook, one SharePoint list, one SAS extract). Source data going out as Cases and Review Outcomes coming back are both feeds.
_Avoid_: source (reserved for source *type*: Excel/CSV/SAS/SQLite/SharePoint), import

**Selection**:
The process that turns candidate records into the Cases made available for review — typically filter to specific Advisers, score, sort, join with other feeds' silver/gold data, then filter again. Governed by a Case Type / Variation's selection criteria.
_Avoid_: sampling (until disambiguated), picking

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
- The pipeline is bidirectional: **Feeds** → Cases (outbound), and **Review Outcomes** → reporting (inbound)
- Selection flow: **CasePool** (all Cases) → Selection → **SelectionPool** (chosen Cases)

## Medallion layers

Three SQLite databases, one per layer, on a network share: **raw → silver → gold**. The ingest stage of each Case Type refines its data up to gold; the Selection pipeline reads from the ingested **silver/gold** (via the CasePool) and writes the **SelectionPool** back into gold. So gold holds both refined ingest outputs and accumulating selection results. (Layer names are placeholders — see flagged ambiguities.)

## Example dialogue

> **Dev:** "When Selection runs for case type B variation 47, does it read a different table than variation 12?"
> **Domain expert:** "Same ingested data — variations mostly differ by **Question Bank**. 47 might also override the selection criteria, but it's pulling from the same **CasePool**."
> **Dev:** "And 'available cases' — is that everything in the pool?"
> **Domain expert:** "No. The **CasePool** is *all* cases; 'available' is the eligible candidates — say, activity dated yesterday, or these **Advisers** within the last 20 working days. Selection narrows the pool down into the **SelectionPool**."
> **Dev:** "Where do the reviewers' answers go?"
> **Domain expert:** "That's the separate review platform. Their **Review Outcomes** come *back* to us as a feed for reporting — we don't host the reviewing."

## Flagged ambiguities

- "advisor" vs "agent" — RESOLVED: synonyms; **Advisor** is canonical, "agent" avoided.
- "activity" vs "sale" vs "other things" — RESOLVED: these are **Case Types** (open-ended, generic A/B/C…), each with its own fields/selection/ingest/destination/processing.
- Medallion layer names "bronze/silver/gold" (a.k.a. raw/silver/gold) are **placeholders** — to be renamed by domain later. Using raw/silver/gold for now.
- **CasePool scope** — RESOLVED: a CasePool is **per Case Type**, typed/validated by that type's Schema. A Case Type is an explicit declarative `CaseType` object (schema + Variations) imported directly; a global registry is deferred to runner-era (ADR-0005).
- **Reference data** — RESOLVED: external reference (Adviser directory, mappings) is modelled as ordinary **Feeds**, ingested into the medallion and joined during Selection; the working-day calendar is a config-seeded **`WorkingDayCalendar`** Python utility (not a feed). No separate reference subsystem.
- **Question Bank ownership** — RESOLVED: the framework stores only a **reference** (`question_bank_id`) on the Variation and stamps it onto selected Cases so the review platform knows which bank to present; the bank's **content** is owned by the review platform.
