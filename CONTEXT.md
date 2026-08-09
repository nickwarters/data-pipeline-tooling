# Case Review Platform — Data Pipeline Framework

The data pipeline framework ingests data about reviewable work from many heterogeneous sources, processes it through medallion layers, and exposes it to review workflows through clean domain abstractions (e.g. `CasePool`) instead of raw `pandas.read_*` calls.

> **This glossary covers the data pipeline half of the system only.** The Case Review Platform frontend shares this repository under `platform_frontend/` and keeps its own glossary at [`platform_frontend/CONTEXT.md`](platform_frontend/CONTEXT.md). Some nouns appear in both — **Case** and **Case Type** most of all — and they are *not* automatically the same term: this file defines what a pipeline produces, that one defines what a Reviewer works on. When a change spans both halves, read both entries and say which one you mean.

## Language

**Case**:
A normalized, source-agnostic record representing one thing to be reviewed; every feed maps its raw rows into this common shape. Its grain is **one row per Case**, identified by a deterministic **`case_id`** (a `sha256` over the Case Type's name and the natural-key columns — stable across runs).
_Avoid_: record, row, item

**Detail Table**:
A supporting table produced by the *same* Feed as a Case but holding data that does not fit the one-row-per-Case grain — repeated sections (e.g. product 1..10) or child collections — at its own finer grain (many lines per Case). Keyed back to its Case by the deterministic `case_id`, **not independently reviewable**, and rolled up to the Case downstream. A Feed yields exactly **one Case table and zero or more Detail Tables**. Where a **Polling Feed**'s observation carries the whole Case, a Detail Table is reduced to gold by the **parent's winning observation**, never by its own grain — see **Observation-snapshot reduction** below.
_Avoid_: child table, sub-table, line item (until disambiguated), Deliverable (that is outbound)

**CasePool**:
The full population of Cases, read from the ingested silver/gold data. It exposes intention-revealing, domain-named retrievals (a representative example being `fetch_available_cases(...)`) that pipelines call instead of raw `pandas.read_sql`/`read_csv`. Method names/shapes vary by case type — `fetch_available_cases` is illustrative, not a mandated universal API.
_Avoid_: repository, dataset (as a name for the CasePool — the capitalised framework primitive `Dataset` is the bulk in-memory carrier, a distinct concept; see Flagged ambiguities), queue

**SelectionPool**:
The narrowed set of Cases the Selection pipeline produces by pulling from the CasePool and applying filter/score/sort/join — i.e. the Cases actually chosen for review.
_Avoid_: shortlist, batch

**Selection trace**:
The per-Case audit of *why* each Case considered by Selection was or wasn't chosen: which **Filter**/**Join** excluded it (located by name), what it **Score**d, and — for survivors — where it ranked. A sibling table of the **SelectionPool**, stamped with the `logical_run_id` and, when run through a `RunContext`, the `pipeline_run_id` that matches RunLog/RunRegistry, so the selection decision is defensible after the fact ("why wasn't this Adviser picked up last quarter?"). It is the eligibility-stage twin of **quarantine** (validity) — the same "route aside *with a reason*, never silently drop" shape, pointed at selection rather than schema. Produced by `.explain(writer, id_column=…)` on the Selection pipeline.
_Avoid_: log (it is queryable state, not free text); audit log (reserve for the run-level JSONL)

**Selection rule**:
A named, deterministic business rule used by Selection to narrow or rank the CasePool. Predicates back `Filter` gates, scorers back `Score` columns, and joins can also act as named gates when unmatched Cases are excluded. Rules should be pure functions of the Case row plus explicit configuration so they are independently testable and their effects are traceable in the **Selection trace**.
_Avoid_: hidden side-effect rule, ad hoc lambda (for governed business criteria)

**Sampling**:
A narrowing technique Selection may apply, reducing a population to at most *N* Cases — either **per group** (one or more key columns, e.g. **Adviser**, or Adviser × region) or **ungrouped** (the whole feed as one population). Two forms of cut: **ranked** — the highest-scoring *N*, deterministic by a score (the common case is *N*=1, "the single highest available per Adviser"); and **random** — *N* drawn at random, made **reproducible** by a fixed **seed** (a pure function of input + seed; run-to-run variation comes from the upstream-narrowed population, not the seed). The cut is itself a **selection decision**: the Cases dropped beyond *N* are excluded *with a reason*, captured by the selection trace, never silently absent.
_Avoid_: picking; "sample" as a loose name for the **SelectionPool** as a whole (sampling is one technique that helps produce it, not the result)

**Available Cases**:
An illustrative retrieval on the CasePool: candidate Cases eligible to enter Selection, defined by business availability criteria (e.g. activity dated yesterday; a subset of Advisers within the last 20 working days). Eligibility is computed in Python, not SQL.
_Avoid_: queue, outstanding cases

**Advisor**:
The actor who conducted the work captured in a Case (e.g. gave advice, made a sale).
_Avoid_: agent, rep, salesperson

**Reviewer**:
The actor who reviews a Case. **Identified, across both halves of the system, by their bare account name in lower case** — the claims login `i:0#.w|CONTOSO\a.khan` reduced to `a.khan` (in this environment the account name is a numeric staff id, so the case-folding is a no-op that costs nothing and closes a real hole elsewhere). This is a **key**, not display copy: the Sync feed lands the full claims login in `assigned_reviewer_name`, the review platform strips the prefix and domain at its service boundary (`src/services/account-name.js`) and shows components bare accounts only, and AD is case-insensitive — so the *only* form both halves can derive independently and agree on is the lower-cased bare account. Any table or **Deliverable** keyed by Reviewer is keyed by that. A Reviewer's **display name is not in the Sync store at all** (the feed reads `AssignedReviewer/Name`, never `/Title`), so a per-Reviewer view either already knows the name — the signed-in user's own — or must resolve it against the directory.
_Avoid_: checker, assessor

**Case Type**:
A first-class classification of Cases that determines its fields, selection criteria, ingest rules, destination, and processing; new case types are added over time without changing the core. Referred to generically (case type A, B, C…) — the specific set is not yet fixed. It also **owns its identity contract**: the **natural key** column(s) that identify a Case, and the per-type **namespace** they are hashed under to mint the deterministic `case_id`. A feed declares those as `NAMESPACE` and `NATURAL_KEY` beside its row schema, so gold builders and every Detail Table receive the same explicit values and derive the *same* `case_id` independently. Changing either value re-keys history. **In the Sync store the contract sits one level up**, because one subject holds every Case Type: the namespace is the subject `cora_cases` and the Case Type slug moves *into* the natural key, `("case_type", "source_item_id")`. The structural property is unchanged — one declaration supplies every builder — and so is the trade-off, now attached to the subject name and the slug ([ADR-0016](docs/adr/0016-one-sync-subject-for-every-case-type.md)).
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

**Polling Feed**:
A **Feed** whose source is not handed over as a file but *asked for*, repeatedly, over an API — today the SharePoint REST list read by a `Modified` window. It differs from a file Feed in one way that matters to the language: there is no snapshot boundary, so "the feed" is a sequence of overlapping windows rather than a delivery, and where the polling got to is durable **source control state** (the watermark), not run metadata. Consecutive windows deliberately overlap, so the same row arrives many times and the load must be idempotent.
_Avoid_: stream (reserved for a **Streamed Feed**, which is about size not arrival), sync (reserved for the **Sync** Pipeline)

**Version observation**:
One row of a **Polling Feed**: what the source said about one item, at one source version, on one read. The unit of an append-only history — a later source version of the same item is a **new** observation, never an update — identified by the list, the item id and the version (`source_observation_id`). *When we saw it* is not part of the observation: an observation is what the source said, so read time lives in the run log and the ingestion batch id rather than in the row.
_Avoid_: snapshot (that is the whole source at a moment), record, event

**Observation-snapshot reduction**:
How a **Detail Table** is reduced to gold when its parent arrives as a whole **Version observation** (the SharePoint item carrying its children in JSON blobs): keep the child rows belonging to the **one observation that won for that Case**, by semi-joining the Detail Table to the winning `(case_id, source_observation_id)` pairs. Never `LatestPerKey` over the Detail Table's own grain — the review application *removes* children between observations (a withdrawn Remediation decision, stripped Issue Capture values), and an absence writes no row, so a child-keyed reduce can never see the deletion and resurrects the child forever. Two properties follow: deletions are honoured for free, and every gold Case is internally consistent (all its children from one snapshot). Sound only because the observation carries the *whole* parent; a Feed whose children arrive independently cannot read absence as deletion. ([ADR-0015](docs/adr/0015-detail-tables-reduce-to-the-parents-latest-observation.md))
_Avoid_: dedup, latest-per-row, merge

**Aggregate table**:
A **gold** table whose rows are *counts of Cases*, not Cases — one row per combination of the dimensions it declares (its **grain**), plus the measure. Distinct from a current-state gold table, which is one row per Case. An Aggregate table is rebuilt whole from the current-state table on every run (`Refresh()`), so it cannot drift from it and a re-drive converges; and its grain is *declared* (in the builder's docstring and the Data Dictionary) rather than gated, because a uniqueness check sitting immediately below the group-by that produced it is satisfied by construction and could never fire. Today: `case_counts_current`, `case_age_buckets_current`, `case_throughput_daily` on the `sharepoint_cases` Feed.

**One Aggregate table per question, not one wide table.** A new consumer question earns a **new** Aggregate table; it does not earn new dimensions on an existing one. Widening a table's grain silently changes what every existing consumer's rows *mean* — the same `case_count` now splits across more rows — so every downstream reader must be revisited to keep reporting the number it used to report. Aggregates are cheap (each is one group-by refreshed whole from the current-state table) and consumers are not, so the cost is deliberately pushed onto the producer. Two consequences: expect *many* narrow Aggregate tables rather than a few wide ones, and an Aggregate table is named for the question it answers, not the dimensions it happens to carry. The three tables listed above were seeded to prove the shape, not drawn from a stated requirement; a requirement-driven aggregate should not be bent to fit them.
_Avoid_: summary, rollup, cube, report (that is a **Deliverable**)

**As-of instant**:
The single instant a set of gold tables describes the world *as at*, stamped on every row as `as_of_utc`. For a **Polling Feed** it is the candidate window end the run is about to commit as its watermark — never "now": a re-drive of the same window must produce identical gold, and reading the clock inside the reduce would break that. It is an *instant* (UTC); where a **calendar date** is derived from it, the conversion to the local date is explicit, because instants are UTC and calendar dates are local.
_Avoid_: run date (that is run metadata, and local), snapshot date, load_date (that is a batch-load stamp a Polling Feed does not carry)

**Deliverable**:
An outbound artifact a Pipeline produces for downstream consumption, in one of three concrete forms: a **file** (CSV/Excel/JSON), a **directly-readable view/table** the consumer reads, or **rows pushed to a platform-owned remote list** (a SharePoint Subscription Edition list — the canonical **Selection** Deliverable, one list per Case Type). The push form is an *active* write to a system the framework does not own, not a passive artifact left for collection; files are reserved for **Reporting** outputs. Emitted by a **Writer**: `CsvWriter`, `ExcelWriter`, and `JsonWriter` emit file Deliverables; SQLite Writers emit directly-readable tables; the stubbed `SharePointWriter` is the outbound dual of the **SharePoint Reader** (same source type, both directions).

**A Pipeline emits a Deliverable *locally*; it does not deliver it.** A Pipeline writes its artifact to a **deliverable outbox** — a directory on a shared drive, one per delivery destination — and its job ends there. Getting the artifact to where it is consumed (a SharePoint document library, a SharePoint list, a SAS environment) is **delivery**, performed by a configurable batch job outside this framework that watches the outboxes and moves what it finds. Two reasons: a pipeline that also delivers carries credentials, an external failure mode, and a retry policy for a system it has no other business knowing about; and every destination would otherwise grow its own Writer, when "move these files there" is one mechanism serving all of them. *(Direction agreed, not yet built — the existing `SharePointWriter` list push predates it. See the flagged ambiguity below.)*

A **fourth form** joins the three above: a **file destined for a platform-owned document library** — the review platform reads it back over HTTP as an artifact rather than as list rows. It is how **Reporting** hands pre-computed figures to the review platform's UI, so the browser renders a number rather than deriving one. Three rules hold it in place. It is delivered to a **report-feed library of its own** (`Shared Documents/cora_report_feeds/…`), never the Style Library and never the front end's deployed tree (`Style Library/CODE/CORA`): that tree is code, its deploy **deletes any remote file with no counterpart in the repository**, so an artifact written there would vanish at the next deploy. Its content is **JSON stored in a `.txt` file**, for the same reason the Question Bank artifacts are — SharePoint SE is unreliable serving `.json`. And a **stale Report Feed is kept, never deleted**: it carries the date its figures are complete through, so an old one tells the truth about itself, where an absent one only says "broken". Being outside the deployed tree is also what keeps it clear of the front end's "deployed bytes are source bytes" rule: it is published data, not shipped code.
_Avoid_: report, export, output feed (say **Report Feed** — see below)

**Report Feed**:
A **Deliverable** whose consumer is a report, or a UI that renders one. Named from the **consumer's** side, which is the whole point of the term: the same artifact is *outbound* to the pipeline that emits it and *inbound* to the SharePoint page that reads it, and both readings are honest. The qualifier carries the direction, so **`Feed` unqualified stays strictly inbound** and nothing in the ingest half of this glossary shifts. Say "the pipeline emits a Deliverable" when the subject is the pipeline, and "the page reads a Report Feed" when the subject is the consumer — they are the same bytes. The library `Shared Documents/cora_report_feeds/` is named on the consumer's side for the same reason.
_Avoid_: feed (bare, for anything outbound), output feed, report (that is what a Report Feed *feeds* — the SharePoint page is the report, this is its input)

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
A stable, named unit of work inside a `Pipeline` builder run. A Task may read, process, validate, write, explain, quarantine, or perform an action; it records its supplied name in `Pipeline.describe()` and the RunLog so later dependency work can address it consistently. Executing a Task produces **exactly one** run-log record, written in one place by the node wrapper: a Task *returns* what it measured (its dataset, counts only it could know such as `rows_quarantined` or `rows_excluded`, and whether it durably committed an artifact) rather than logging it, so its own counts and the wrapper's timing, warn hits and `step_address` land together. Public authoring prefers `.task(name, callable, *inputs)` for dataset→dataset work; existing builder vocabulary such as `.read`, `.transform`, `.validate`, and `.write` remains compatible.
_Avoid_: stage (older/informal for a run step), job, layer

**Run Address**:
A stable dependency-target label for either a whole Pipeline or one named run step inside it. The four label forms are `pipeline`, `subject/pipeline`, `pipeline.step`, and `subject/pipeline.step`; `framework.run.RunAddress` owns parsing and formatting so logs, dependency declarations, and registry queries use the same vocabulary. This follows the DAG design's `pipeline_2.step_4` address shape while the builder can still expose `.task(...)` as the authoring method. Invalid labels are configuration failures, not data or runtime failures. A Run Address is a **value**, not an identity: a frozen dataclass whose equality and hashing come from its three parts, constructed by `RunAddress.for_pipeline(...)` / `RunAddress.for_step(...)` (renamed so the constructors no longer share names with the `pipeline` / `step` attributes). Its rendered label is a live on-disk format — it is stored as `step_address` — so the names may change but the rendering may not.
_Avoid_: ad hoc pipeline key, path (unless referring to a filesystem path)

**Data Location**:
The file or table a read or write step **actually touched**, identified as a namespace plus a name (`{"namespace": "file", "name": "/data/orders.csv"}`, `{"namespace": "sqlite:/data/raw.db", "name": "orders"}` — OpenLineage's dataset-identity shape). A component reports its own locations during the call and the node drains them into the step's run-log `data_locations`, so a run record answers "which file produced this?" rather than only "which step ran?". Distinct from **Run Address**: the address is the *wiring* label (which step, in which pipeline), a Data Location is the *data* the step reached. A step that touched nothing — a transform, a dry-run write, a console sink — has none.
_Avoid_: path (unless referring to a filesystem path), dataset (the carrier), source (the feed)

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
The final **stage** — a *growing family of independent pipelines*, not one Pipeline and not necessarily one `PipelineSet`. Each reads whatever upstream it needs (often a single upstream gold table, sometimes several, joining **Review Outcomes** to selected **Cases**), and each produces exactly one thing: a **Report Feed**, or a report directly. They are **individually schedulable** and separately addressed by path, because they answer unrelated questions on unrelated cadences and one failing must not hold the others up. Spans all Case Types. Read this entry as the correction it is: Reporting was defined here as a single final Pipeline, by symmetry with the other three, before any of it existed.
_Avoid_: analytics, BI, warehouse; "the Reporting pipeline" (singular — there is no such run)

**Schema** (of a Case Type):
The declared expected columns, types, and field-level nullability/**value rules** for a Case Type — the single, named replacement for today's scattered, implicit "assume field X exists" checks. A validation contract first (enforced at silver & gold), and the optional basis for typed objects. Currently a dataclass; Pydantic later.
_Avoid_: model, shape, structure (informal)

**Value rule** / **Row check**:
The two axes of a **Schema**'s content contract. A **value rule** is *vertical* — one column across many rows (format, length, range, membership, uniqueness), declared on the field via `Annotated`. A **row check** is *horizontal* — one row across many fields, validating the relationship *between* a row's fields (`opened <= closed`; "if status is closed then closed_date is present"). A row check is a plain function over a row returning a breach phrase or `None`, paired with the **footprint** of columns it spans (so a column already failing its dtype check suppresses the check rather than crashing it); declared as `RowCheck`s via the `@row_checks(...)` class decorator above the schema. Both feed the same two consumers — abort (collected into one `SchemaValidator` message) or quarantine (a `failed_rule` reason) — off **one shared traversal** of the declared rules, so a rule is consulted once per frame and its author satisfies one contract rather than two. The two consumers differ only in *presentation*: an abort message describes a **column**, so it samples up to five of that column's offending values; a quarantine reason describes **one row**, so it names the rule's expectation and samples nothing — the rejected row's own values sit beside the reason in the reject table, and that pairing is what makes the reason *located*. Unlike value rules, a row check runs over **every** row including nulls — presence may be the very thing it tests — so the author handles nulls explicitly. Both are **structural contracts**, not base classes: anything with the two methods is a value rule, though the built-in five share one `ValueRuleBase` that owns the single null guard and the breach mask. Both are also **engine-confined** to author — a rule is handed the column (or the row) as a pandas `Series` — which is why the opaque-carrier decision lists them alongside readers, writers and transforms; *declaring* a rule on a schema stays engine-agnostic.
_Avoid_: cross-field rule (informal), constraint

**Schema Drift**:
A **Feed**'s landed column set changing run-over-run — an owner-controlled source (SharePoint list, SAS export) silently adding or dropping a column between snapshots. Detected at the **raw** boundary by diffing the incoming columns against the prior run's landed columns, and surfaced as a **warning** that does not stop the run (raw stays a faithful mirror of the source). Names-only and run-over-run; a type change on a surviving column is a **Schema Breach**'s concern, not drift.
_Avoid_: schema change, schema mismatch (use the precise term)

**Schema Breach**:
Data violating a Case Type's declared **Schema** (a missing column or wrong dtype) at the **silver** or **gold** boundary — a hard, fail-fast abort, not a warning. A dtype is a claim about *values*, so a **zero-row** frame cannot breach one: only the missing-column half of the definition applies to it. Contrast **Schema Drift**: drift is a soft, run-over-run *change* signal at raw; a breach is a hard *contract* violation downstream.
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
`Dataset` seam** (`from_pandas`/`to_pandas`) so the engine is swappable;
`.transform` / `.task` is the processing seam; the
**dataclass→validator adapter** is the seam to Pydantic-later.

**Edge**:
Where the system meets something outside itself — external I/O, or the
hand-off to a different layer/representation. _Here_: **Readers/Writers** sit at
the *I/O edge* (files, SQLite, SharePoint); the **CasePool returning typed
`Case` objects** is the *domain edge*, the "typed-on-demand" edge
reserved for a later slice. A seam is a *substitution* point; an edge is a
*crossing* point — they often coincide but are not the same idea.

**Boundary**:
A line across which a guarantee changes, and therefore the natural place to
**enforce** that guarantee. _Here_: silver is the **schema boundary** (declared
columns + dtypes validated *before* data lands); gold is the **grain
boundary** (one-row-per-Case enforced).

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
signature, pipeline script, or the domain layer.

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
file is contained to one subject rather than poisoning the whole store.

**Run record**:
One observation of one step (or of a whole run): the JSON object a `RunLog`
appends to the `.log` file, the row the `RunRegistry` stores, and the console
line an operator reads — three surfaces of **one** shape. _Here_: the field set
is **declared once, as data**, in `tools/observability/record_schema.py`
(`RUN_RECORD_FIELDS`), and the DDL, the additive column migration, the `INSERT`,
the row decode and the console line are all derived from it. Adding a
field is one entry in that list, not six hand-edits that can half-land. The
declaration order is a live on-disk contract (JSONL key order, column order):
append, never reorder. The orchestration decision store keeps its **own**
declaration of a different contract, sharing only the machinery.

**Run store**:
The owner of a base directory's **run-metadata layout** — `_runs/<subject>.log`,
`_registry/runs.db`, `_orchestration/runs.db` — and the pieces it opens over
them (`RunStore` in `tools/observability/run_store.py`). _Here_: it is the
**counterpart** of the `StoreRegistry`, not an extension of it — that one owns
where the *rows* land, this one owns where the *runs* are recorded, and neither
constructs the other. `catch_up()` is the "sweep every run log into the
registry" step a run or a plan takes before consulting history. Before it, the
same three path fragments were spelled out in the runner, the orchestrator and
the operator CLI; a layout with no owner drifts.

**Source checkpoint (watermark)**:
Durable **control state** recording how far a source has been polled, so the next
run resumes rather than re-reads everything. _Here_: `SharePointCheckpointStore`
(`tools/integrations/sharepoint_checkpoint.py`) keeps one `Modified` watermark per
SharePoint list under `<base_dir>/_checkpoints/sharepoint.db`, and computes the
next window from it — `end = server_now - safety_lag`, `start = watermark -
overlap` (`None` on a first load, meaning the full current list). The commit is
the **last act of a successful run**; nothing else advances it. **Do not confuse
the two senses of "checkpoint"**: elsewhere in this glossary and in
`framework/run`, a *checkpoint* is a mid-graph `.write()` node landing an
intermediate dataset for lineage — a thing inside one run's graph. A *source
checkpoint* is state **between** runs, about an external source. Say "source
checkpoint" or "watermark" when that is what you mean. It is also a **third**
category of thing in a base directory, alongside the rows the `StoreRegistry`
lays out and the runs the **Run store** does — kept separate because the
lifecycles differ: pruning run logs must not lose a feed's place in its source.

**Run time semantics**:
Two clocks meet in the run metadata, and the rule for reconciling them lives in
one module (`tools/observability/timestamps.py`). _Here_: an **instant** —
when a record was emitted — is **UTC**, timezone-aware, stored as ISO-8601 text
with an explicit `+00:00` offset (the on-disk format). A **calendar date** — a
run date, "did last night's run succeed?" — is **local**, because an operator's
today is the box's today and `run_date` defaults to the local `date.today()`.
So every comparison between the two converts the stored instant to the *local*
date first: on a UK box at UTC+1 an upstream that succeeded at 00:10 local is
stamped 23:10 UTC the previous day, and taking the UTC date there blocked a
downstream as stale twenty minutes after its upstream had run.

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
builder and per-item `RunContext` every time. That context is *derived* from the
parent — it overrides only the logical run id, so the items share the attempt's
`pipeline_run_id` and inherit the run's parameters and its dry-run preview. Use
it when each file/source item is its own logical run (including its own logical
run id for idempotent `AccumulateByRun` writes). It is fail-fast by default, or can explicitly run
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
definitions own the canonical sets, dependencies, and default schedules — and
those definitions are **application-owned**, here `case_review/schedules.py`,
which the operator CLI's `--app` names. YAML
may override enablement, timing, and freshness windows. Schedules are
expressed with the friendly `Schedule.*` constructors (`Schedule.daily()`,
`Schedule.on_weekdays("monday", …)`, `Schedule.day_of_month(n)`,
`Schedule.nth_working_day_of_month(n)`, `Schedule.last_working_day_of_month()`,
`Schedule.manual_only()`) over the concrete schedule classes, keeping `is_due`
the core protocol. A schedule is **declared once, in its own class**:
alongside `is_due` it carries its label, how it explains a date it was *not* due
(so a monthly schedule answers in dates rather than weekday names), and the
`type:` key an overrides file names it by — defining the class registers it, and
a key claimed twice fails at import. Decisions are
recorded in `_orchestration/runs.db`; actual executions remain in
`RunLog` / `RunRegistry`. A decision's `reason` is **prose for an operator that
no control flow reads**; whether the item counted as due work for the run date is
the separate `was_due` flag, and that flag — not the message text — is what the
polling loop uses to decide the day has settled. Failures are isolated: a
failed scheduled item blocks
its downstream dependants for that orchestrator run, but independent items and
other PipelineSets continue. Within a set, the **Run order** is derived per pass
from the Deadlines, Earliest run windows and Priorities declared on the items —
one derivation both the pass and `plan()` read.

**Run order**:
The sequence in which a pass attempts the runnable items of one `PipelineSet`.
_Here_: **derived on every pass** — a pure function of the candidates, the
wall-clock time of day, and which items already succeeded today — never declared,
stored, or turned into a wake-up schedule. Dependency order dominates every time
input; within that it is deadline pressure, then Priority, then declared order.
`PipelineSet`s stay the outer boundary in declared order; there is no cross-set
ordering. Ordering never decides whether something may run — that is the
Freshness rule's question alone. See
[run order is derived per pass](docs/adr/0017-run-order-is-derived-per-pass-not-declared.md).

**Deadline** (`due_time`):
The time of day a scheduled item should be finished by. _Here_: an optional
`"HH:MM"` on `ScheduledPipeline`, always a time on the **run date** — there is
no next-day deadline.

**Inherited deadline**:
The Deadline an item answers to on a dependent's behalf. _Here_: an item with no
Deadline of its own takes the tightest Deadline of whatever depends on it,
transitively, so an upstream is run in time for the dependent that has the
Deadline. Only items due today contribute one.

**Overdue**:
A due item whose effective Deadline has passed and which has not yet succeeded
today. _Here_: overdue items are attempted first, most overdue first. An item
that already succeeded today exerts no Deadline pressure at all — whether an item
has run today is read for that question **only**, and never to decide whether it
may run.

**Earliest run** (`earliest_run`):
An optional `"HH:MM"` before which an item is not attempted. _Here_: a per-pass
**eligibility gate, never a sleep** — a gated item is recorded `skipped` naming
the window, and a `--loop` may settle for the day before the window opens.

**Priority**:
An integer tie-breaker between items with equal deadline pressure, higher first.
_Here_: no time semantics of its own, and it never reorders items that are not
going to run.

**Freshness rule**:
The single predicate deciding whether a declared upstream is current enough for a
run date (`evaluate_requirement` in `framework/run/freshness.py`). _Here_:
it is a **pure verdict** — it reads run history and returns a `FreshnessVerdict`
(satisfied, the sentence explaining it, whether there was no history at all) and
does nothing else. The runner's `FreshnessGuard` is the **side-effecting
wrapper** that records the verdict to the run log and raises `FreshnessError`;
`Orchestrator.plan()` is the **read-only caller** that renders it as a `blocked`
plan item. One rule, two presentations: a plan preview whose promise is *this is
what will happen* cannot describe a block in different words than the run that
enforces it.

### Streamed Feed
A **Feed** whose source is too large to hold whole (a 100M-row SAS extract), read
as a *sequence of bounded `Dataset`s* rather than one. Wired into the deferred
`Pipeline` with **`.read_chunks(...)`**, which drives the sub-graph below it once
per chunk, so a Streamed Feed keeps the validators, quarantine, dry run,
profiling, run addresses and per-step run records an ordinary Feed gets — the
per-chunk records folded into **one summed record per step**. The in-memory
`Dataset` contract holds **per chunk**, never for the source; there is
no lazy carrier. Pairings that cannot be made chunk-safe are refused **at wiring
time**, before a byte is read: a Writer that replaces its target, a Validator
that needs the whole population, and the row-level `explain` trace. See
`docs/streaming-large-sources.md` and the opaque-carrier ADR amendment.

## Relationships

- A **Case** is produced by exactly one **feed** but conforms to a single common shape regardless of origin
- A **Feed** yields exactly **one Case table and zero or more Detail Tables**; a wide feed is fanned out by **N single-table pipelines over the shared raw table** (each projecting its own columns), not a multi-Writer terminus or a splitting processor
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

A **subject** owns a **medallion**: three SQLite databases, one per generic framework **layer** (**raw → silver → gold**), on a network share, isolated from every other subject's files (blast-radius isolation, independent onboarding). The same `raw → silver → gold` framework is **reused by every Pipeline**; business meanings such as "current CasePool" or "SelectionPool audit" are imposed by the application pipeline, not by the layer names themselves:

| Pipeline | Scope | Load profile & what its gold holds |
|----------|-------|------------------------------------|
| **Ingest** | per Case Type | **History-upstream / current-gold**: raw + silver *accumulate* the change-over-time record (the source is a destructive current-state system, so the framework is the historian); gold is *current-only*, **one row per Case** (`case_id`), the clean layer the **CasePool** reads. |
| **Selection** | per Case Type | *Accumulate-by-run* gold: the **SelectionPool** (chosen Cases), an audit trail, written into gold and emitted as a **Deliverable** to the platform. |
| **Sync** | platform-wide (**one** subject, `cora_cases`, every Case Type) | **History-upstream / current-gold**, like Ingest: raw + silver accumulate every **Version observation**; gold is `Refresh()`-rebuilt and current-only — one row per Case, plus **Detail Tables** reduced by **observation-snapshot reduction**. ([ADR-0016](docs/adr/0016-one-sync-subject-for-every-case-type.md)) |
| **Reporting** | platform-wide, **per report** | **Chosen per report, not prescribed.** A point-in-time view that must survive as evidence accumulates by run; an **Aggregate table** that is a pure function of its upstream is `Refresh()`-rebuilt so a re-drive converges; a large one may earn an incremental load that only processes dates not yet seen. Each emits a **Report Feed** or a report. The earlier blanket "*accumulate-by-run* gold" was written before any Reporting pipeline existed and prescribed a load strategy for work nobody had done yet — load strategy is per-feed, owned by the Writer, and that rule applies here like anywhere else. |

So **CasePool** and **SelectionPool** relate to **Ingest** and **Selection** only; **Review Outcomes** live in the **Sync** store. **Load strategy is per-feed, owned by the Writer** (the Store maps `layer → location` only; each strategy realises its own Writer, so the Store branches on nothing); there is no longer a single "gold accumulates everywhere" rule. Where a layer accumulates, its history survives across runs (stamped with a logical run id / `load_date` and, when context-driven, execution id; idempotent re-run via delete-by-logical-run). Ingest's *current* gold is reduced from accumulated silver and its one-row-per-Case grain is enforced at the gold boundary. There are **two reduction shapes**, chosen by what the silver rows carry: a batch-loaded silver reduces with `LatestPerKey` by `case_id` over `load_date`; a **Polling Feed**'s silver has no `load_date` (an `AppendOnly` target compares every non-key column, so a per-read stamp would make each overlapping re-read look like a change) and reduces instead by the *source's own version* — `source_modified_at`, then the parsed source version, then the deterministic observation id. Both shapes reduce the **Case** table; a **Detail Table** whose parent arrives whole does not reduce on its own key at all, but follows the winner by **observation-snapshot reduction**. Alongside the current-state table an Ingest gold may publish **Aggregate tables**, all refreshed whole and all stamped with the same **as-of instant**.

**Store topology (current working assumption).** Where a feed lands is **application infrastructure**, not framework vocabulary: the opaque **`namespace`** (a *logical database*, one file holding many related tables) → file mapping lives in the sibling `tools.store`. `StoreRegistry(root).store(namespace)` mints a namespace **Store** that binds `(namespace, table)` to concrete Readers/Writers; it does not infer load strategy or business meaning. `StoreRegistry` also registers named Readers/Writers (`register(name, reader|writer)` → `reader(name)` / `writer(name)`) so a pipeline refers to a component by name. The raw/silver/gold **medallion is an application-level profile** (`tools.medallion.medallion(registry, subject)` → `.raw`/`.silver`/`.gold` namespace Stores), layered over the same `tools.store`. Physically the medallion still maps to one three-file medallion **per subject** for now (`<subject>/{raw,silver,gold}.db`). A normalised schema can span several namespaces (one database per namespace; cross-database joins stay in Python). **Sync's topology is now settled**: *one* subject, `cora_cases`, holding every Case Type's Cases and **Detail Tables** in shared tables discriminated by a `case_type` column — the Case lists are provisioned from one template so they cannot diverge in shape, per-Case-Type variation is already key/value rows inside the blobs, and one database per subject means splitting by Case Type would make every cross-Case-Type query an `ATTACH` forever ([ADR-0016](docs/adr/0016-one-sync-subject-for-every-case-type.md)). Reporting's topology is still open.

**Per-subject files are the current stage, not the end state.** One subject → one medallion → three files is what isolates a new pipeline cheaply *while the schemas are still being discovered*, and the single-writer-per-file rule is why a new pipeline takes its own subject rather than adding a table to someone else's. Neither is a prohibition. The expected destination is the opposite shape: once enough pipelines exist for the recurring schemas to have **fallen out of them**, a small number of strongly-schema'd databases — plausibly one per layer, `raw` / `silver` / `gold`, with each table prefixed by its subject — and the pipelines repointed at those. So "this pipeline writes its own subject" is a statement about today's uncertainty, and a design that assumes per-subject files are permanent is arguing against a direction already chosen.

**Hop recipe.** The named, reusable composition of a **standard medallion hop**, returning a wired (not-yet-run) `Pipeline` the caller owns. Two ship (`tools.recipes`): **source → raw** (gate the promised columns, land the source faithfully) and **raw → silver** (rename to the schema's vocabulary, coerce, quarantine value-rule breaches, validate) — the two hops *every* feed shares, previously re-emitted as a copy by each feed and by the scaffold's code generator. `case_review.gold.ingest_silver_to_gold` is the domain-side equivalent for the silver → gold hop. A recipe is **composition, not inheritance**: there is no framework hook and nothing to subclass, so a feed that must diverge inlines the recipe's body into its own builder and edits it. That keeps a scaffolded feed independently editable while giving the standard hop one place to evolve.

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
- **CasePool scope** — RESOLVED: a CasePool is **per Case Type**, typed/validated by that type's Schema. A feed declares its schema, namespace, natural key, and Variations as ordinary module data; there is no global CaseType config registry. The minimal runner registry is only for dispatching domain Pipelines by `(case_type, pipeline)` and checking upstream freshness.
- **Reference Data** — RESOLVED: canonical term **Reference Data** (avoid "master data"/"lookup"). Cross-cutting reference (Adviser hierarchy, product codes, mappings) is modelled as ordinary **Feeds**, each given its **own per-subject medallion**, refined by its own pipeline, and **read-only** to Case Types' Selection (joined in Python). The working-day calendar is a config-seeded **`WorkingDayCalendar`** Python utility (not a feed), the config being a YAML calendar file of `holidays` and `weekend` loaded by `WorkingDayCalendar.from_yaml` (and by `python -m cli orchestrate --calendar`). No separate reference subsystem. See the per-subject medallion store decision.
- **Medallion scope** — RESOLVED: a medallion is scoped **per subject** (a Case Type or a Reference Data set) — three files each — for blast-radius isolation and independent onboarding; the single-writer rule holds per file. See the per-subject medallion store decision.
- **Question Bank ownership** — RESOLVED: the framework stores only a **reference** (`question_bank_id`) on the Variation and stamps it onto selected Cases so the review platform knows which bank to present; the bank's **content** is owned by the review platform.
- **"Pipeline" — term vs class** — RESOLVED: the four end-to-end phases (Ingest/Selection/Sync/Reporting) are **Pipelines** (the domain term). The `Pipeline` *class* (`framework/run/builder.py`) is finer-grained — a deferred builder for **one Feed/table** — so a domain Pipeline composes one or more class `Pipeline` runs. The class can be inspected before execution with `.describe()`, which renders the same ordered plan that `.run()` executes: reader, explicit read dependencies, ordered Tasks, governance outputs, writer, and run-log sink without running the feed. A **Task** is a named unit within one class-level run (`Reader -> Dataset -> Task* -> Writer`), such as validation, processing, or an explicit checkpoint write; it is not a domain Pipeline, medallion layer, or second terminus. "Stage" is older/informal wording for this run-step idea, while "Layer" stays reserved for raw/silver/gold.
- **Inbound vs outbound** — RESOLVED, then refined: **Feed** unqualified is inbound-only; an outbound artifact is a **Deliverable**. The **Sync** Pipeline is one-way inbound (no push, no correlation); the **SelectionPool** reaches the review platform as a Deliverable emitted by **Selection**. The refinement: a Deliverable read by a report or a UI is a **Report Feed** — the artifact is outbound to its producer and inbound to its consumer, and the qualifier is what names the direction. So "output feed" stays banned and bare "feed" still means inbound; only the two-word term points outward.
- **`Dataset` vs CasePool** — RESOLVED: `Dataset` is the framework primitive renamed from `DataHandle` — the opaque, **bulk** in-memory carrier (the bulk tier of the two-tier carrier; pandas behind the seam), returned by `Reader.read()` and flowing through builders/processors/Writers. It is **not** the **CasePool**, which is the domain population of **Cases** read from silver/gold and surfaced as typed `Case` objects. The two tiers meet only *inside* CasePool: it reads a `Dataset`, then materialises typed Cases. So "dataset" stays an `_Avoid_` alias for the *CasePool concept*, while the capitalised type `Dataset` is the carrier. (Renamed from `DataHandle` because "handle" implies a lightweight pointer; the thing actually owns a tableful of rows — the noun was the onboarding tripwire.)
- **Store topology** — PROVISIONAL (working assumption, not yet an ADR): the framework addresses an opaque **`namespace`** (a logical database) → file; a **Store** is namespace-scoped and binds `(namespace, table)` → Readers/Writers. The raw/silver/gold **medallion** is an application profile (`tools.medallion`) over that, no longer framework vocabulary. Physically one SQLite DB per Case Type shared by Ingest + Selection, one DB for Sync (all Case Types), one for Reporting (all Case Types). Separate Python `Store`s/Writers may point at the same file. Revisit when Sync/Reporting are built.
- **Who delivers a Deliverable** — DIRECTION AGREED, NOT BUILT: a Pipeline writes its artifact to a local **deliverable outbox** and stops; a configurable batch job *outside* this framework watches the outboxes and performs the delivery (SharePoint document library, SharePoint list, SAS writeback), plausibly on a short poll. It need not use the framework at all. A Pipeline's side of it is settled and small: **write into `<base_dir>/deliverables/<destination>/…` and stop** — overwriting or replacing what is there, never appending, and never reading back what a previous run left. Open, and the delivery job's to decide: whether it **mirrors** the directory or **drains and archives** what it has delivered (both work for a producer that rewrites its files whole; they differ in retry and in what an operator sees mid-flight); whether the existing `SharePointWriter` list push — Selection's Deliverable — migrates onto it or is left alone; what marks a batch complete; how a failed delivery is retried and surfaced; and whether delivery events belong in the run record. Note that draining the *local* directory does not conflict with keeping a stale **Report Feed**: that rule is about the artifact at its destination, which is only ever overwritten. Until the job exists, a Report Feed reaches SharePoint by an interim manual copy — accepted as not-ideal rather than blocking.
- **Selection's two writes (gold audit + Deliverable)** — RESOLVED: Selection both writes the **SelectionPool** to its gold (audit trail) and emits it as a **Deliverable** to the SharePoint list. These are **two pipelines, not one run with two writes**: the Selection pipeline lands gold, then a **second pipeline reads the gold SelectionPool and writes to the SharePoint list** — consistent with the case-identity and gold-grain decision's "single-Writer pipelines over a shared source" (no multi-Writer terminus, no checkpoint required). Mid-run lineage (a `.write()` node placed mid-graph) is a separate, general-purpose feature and is **not** the mechanism here.
- **One feed, many tables** — RESOLVED: the old "one feed → one silver table → one gold table" assumption is dropped. A Feed yields **one Case table and zero or more Detail Tables**; the wide feed is fanned out by **N single-table pipelines over the shared raw table**, each projecting its columns and sharing one reusable normalisation `Processor`. No new core seam (rejected a multi-Writer terminus and a splitting Processor — both break the single-Writer/single-Dataset shape). Built through `SelectColumns`, `Unpivot`, `DeriveKey`, `LatestPerKey`, `UniqueValidator`, and the case-review gold helpers.
- **Case identity** — RESOLVED: a Case's identity is a **deterministic** surrogate `case_id`, a `sha256` hex digest over a canonical JSON encoding of the Case Type's name (the namespace) and the feed's stable natural-key columns — same Case → same id every run/machine, so idempotency holds and the Case ↔ Detail link needs no join. A random `uuid4` is rejected (breaks idempotency); a persistent identity map is the deferred fallback for a feed with no natural key. The encoding hashes the key columns **by name** rather than joining their values, because a joined key is forgeable — a value containing the separator can reproduce another Case's key exactly. It was `uuid5` over a `"|"`-joined key until that flaw was closed.
- **Streaming vs the small-volume premise** — RESOLVED (opaque-carrier ADR amendment): that ADR's Consequences said volumes were small (≤ ~1M rows/feed/run) so "no chunking/streaming machinery is needed up front. Revisit only if a feed grows large." A feed *did* grow large (~100M rows, ~500MB landed per run, ~1.5GB after three) and the revisit happened in code, but the ADR was never amended and so contradicted both the code and `docs/streaming-large-sources.md` while carrying `status: accepted`. Now amended. The **opaque-carrier decision stands unchanged**: the in-memory contract holds per chunk, there is no lazy `Dataset` variant, and `ChunkReader` is deliberately *not* unified with `Reader` by a materialising `read()`. Only the volume premise is corrected.
- **Load strategy vs layer** — RESOLVED: load strategy is **per-feed, owned by the Writer**; the Store maps `layer → location` only (no load decision). The global "refresh upstream / accumulate downstream" rule becomes the *default* profile, not a law. Ingest can adopt **history-upstream / current-gold**; Selection/Sync/Reporting keep accumulate-by-run gold. Consequence: where the source is destructive, accumulated raw/silver are a **system of record** (backup matters) and volume grows `records × snapshots`. Built through explicit Writer strategies (`Refresh`, `AccumulateByRun`, `UpsertStrategy`, `InsertOrIgnore`, `InsertIfAbsent`, `AppendOnly`), each of which mints the Writer that implements it.
- **Atomicity of run artifacts (publish unit)** — RESOLVED: a run's artifacts — **quarantine** rejects, the **Selection trace**, **checkpoints**, and the final output — are **independently committed evidence**, *not* one all-or-nothing publish unit. Atomicity is **per writer, per layer DB** (a single delete+insert), not across writers; an abort *after* an artifact write leaves that artifact on disk. Chosen deliberately: evidence is most valuable when the run then fails. Each run-log step carries a **`committed`** marker so operators can see what landed before an abort — and each step carries exactly one such record. Hardening the per-writer transaction itself is a separate concern.
