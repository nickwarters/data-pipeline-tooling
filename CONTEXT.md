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
The narrowed set of Cases the Selection pipeline produces by pulling from the CasePool and applying filter/score/sort/join — i.e. the Cases actually chosen for review. A **Selection group** spanning several Case Types (below) carries each source's own per-Case Case Details alongside the shared columns, keyed by that source's declared columns — the same keys the frontend's `detailFields[].key` uses (`platform_frontend/docs/case-type-onboarding.md`), landed as one JSON field per Case (`pipelines/complaint_selection`).
_Avoid_: shortlist, batch

**Selection trace**:
The per-Case audit of *why* each Case considered by Selection was or wasn't chosen: which **Filter**/**Join** excluded it (located by name), what it **Score**d, and — for survivors — where it ranked. A sibling table of the **SelectionPool**, stamped with the `logical_run_id` and, when run through a `RunContext`, the `pipeline_run_id` that matches RunLog/RunRegistry, so the selection decision is defensible after the fact ("why wasn't this Adviser picked up last quarter?"). It is the eligibility-stage twin of **quarantine** (validity) — the same "route aside *with a reason*, never silently drop" shape, pointed at selection rather than schema. Produced by `.explain(writer, id_column=…)` on the Selection pipeline.
_Avoid_: log (it is queryable state, not free text); audit log (reserve for the run-level JSONL)

**Selection rule**:
A named, deterministic business rule used by Selection to narrow or rank the CasePool. Predicates back `Filter` gates, scorers back `Score` columns, and joins can also act as named gates when unmatched Cases are excluded. Rules should be pure functions of the Case row plus explicit configuration so they are independently testable and their effects are traceable in the **Selection trace**.
_Avoid_: hidden side-effect rule, ad hoc lambda (for governed business criteria)

**Check**:
One review of one Case, counted toward an **Adviser**'s **Check target**. A check counts from the moment its Case reaches **Reportable**, and falls in the calendar month it became Reportable — so a **voided** Case simply never becomes a check and needs no subtracting anywhere. Distinct from a *selection*: choosing a Case gives the Adviser an **outstanding** check, not a counted one, and the two are separated by however long the review takes. Counting at Reportable rather than at selection is what makes the arithmetic self-consistent — the same milestone drives both the count and the **Check cadence**.
_Avoid_: review (reserved for the act, and for the **Review Outcome** that returns through Sync), case (that is the thing checked), audit

**Check target** / **Check minimum**:
The two numbers a person-targeted Selection plans an **Adviser** against over a rolling 12 months. The **minimum** (8) is the compliance floor — the number that must not be breached. The **target** (10) is what Selection actually aims at, deliberately set above the minimum so that voids, leavers and missed windows do not push an Adviser under it. They are two numbers with two jobs, not a number and a rounding: capacity arithmetic reads the target, compliance reporting reads the minimum. Both **pro-rata by active months** — an Adviser active in 6 of 12 months owes 4 (planned as 5), so a less-active Adviser is not held to a full-year figure.
_Avoid_: quota (reserved for the per-**Variation** counts below), cap, allowance

**Active month**:
A calendar month in the rolling 12-month window in which an **Adviser** made at least one sale. The denominator of every pro-rata figure — the **Check target**, the **Check minimum** and the **Variation quotas** all scale by `active months / 12`. Counted by calendar month, never by exact day.
_Avoid_: working month, live month

**Check cadence**:
How often one **Adviser** can be selected. An Adviser holds **at most one outstanding check** at a time, and the next becomes selectable a declared number of working days after the previous one reached **Reportable** — **20** normally, **5** while the Adviser is **Behind**. One milestone, two durations. *Outstanding* begins at **delivery**, not at allocation: a Case sitting unallocated in the **Hopper** already counts, so the **Hopper** appears here **only** as the earliest observable state of this one rule — it is the destination, never a volume cap. That is the sharpest departure from a volume-planned Selection, where Hopper depth is the gate; here **volume is emergent**, set purely by how many Advisers are due. The durations, like the **Check target** and **Variation quota** numbers, are **declared data** and expected to be tuned, so they never become constants in a rule module. Note what the arithmetic says: against ~252 working days a year, the 20-day cadence yields roughly 8–9 checks and cannot reach a target of 10, so **the 5-day catch-up cadence is the normal operating mode**, not an exception — and the framework's ability to hit target therefore depends on **review turnaround**, which Selection does not control.
_Avoid_: cooldown (implies a penalty; this is pacing), frequency, SLA

**Behind**:
The state of an **Adviser** whose checks in the rolling window fall **2 or more** short of their pro-rata **Check target** — the trigger for the 5-working-day **Check cadence**. Deliberately a *tolerance band*, not simply "below target": every selectable Adviser is below target by construction (an Adviser at target is already excluded by the capacity gate), so a bare shortfall would mean every Adviser is always Behind and the 20-day cadence would be unreachable. The band, the target and the minimum are **one mechanism**: a band of 2 under a target of 10 settles an Adviser at 8–9 checks a year, which is what holds the **Check minimum** of 8.
_Avoid_: overdue, non-compliant (that is a breach of the **Check minimum**, a reported outcome, not this steering state), at risk

**Variation quota**:
The per-**Variation** floors inside an **Adviser**'s **Check target**: at least 2 checks carrying **variation 1**, and at least 2 **combined** checks, both **pro-rata by active months** on the same basis as the target (`2 × active months / 12`, rounded half-up — one rounding rule, shared with the target). A **combined** check carries variation 1 plus exactly one of the others, so it **ticks both boxes at once**: the variation-1 quota is implied whenever the combined quota is met, and only ever binds as a fallback for an Adviser who cannot get combined Cases. Two consequences worth stating: the quotas pro-rata so they can never exceed the target they sit inside, and **combined shortfall dominates** when Selection steers — closing it closes both.
_Avoid_: split (reserved for a **Selection group**'s volume proportions), mix, target (that is the total)

**Sampling**:
A narrowing technique Selection may apply, reducing a population to at most *N* Cases — either **per group** (one or more key columns, e.g. **Adviser**, or Adviser × region) or **ungrouped** (the whole feed as one population). Two forms of cut: **ranked** — the highest-scoring *N*, deterministic by a score (the common case is *N*=1, "the single highest available per Adviser"); and **random** — *N* drawn at random, made **reproducible** by a fixed **seed** (a pure function of input + seed; run-to-run variation comes from the upstream-narrowed population, not the seed). The cut is itself a **selection decision**: the Cases dropped beyond *N* are excluded *with a reason*, captured by the selection trace, never silently absent.
_Avoid_: picking; "sample" as a loose name for the **SelectionPool** as a whole (sampling is one technique that helps produce it, not the result)

**Available Cases**:
An illustrative retrieval on the CasePool: candidate Cases eligible to enter Selection, defined by business availability criteria (e.g. activity dated yesterday; a subset of Advisers within the last 20 working days). Eligibility is computed in Python, not SQL.
_Avoid_: queue, outstanding cases

**Adviser**:
The actor who conducted the work captured in a Case (e.g. gave advice, made a sale) — the person a check is *about*. Spelled as the review platform spells it (the **Adviser** entry in `platform_frontend/CONTEXT.md`; note the group granting it there is now named `Frontline`, so the group name is not the spelling to follow) and as the code already does; the earlier *Advisor* here was a third spelling of one concept, not a second concept. **Known at Selection time, from the Case Type's own ingest feed** — there is no Adviser column anywhere in the **Sync** store, so the Adviser↔Case edge exists only where **Selection** stamps it.
**Not the Responsible Party**, which is the review platform's *per-Case* role — who must carry out remediation — chosen by the **Assigned Reviewer** during the review and only once a failed **Answer** requires remediation at all. In practice the Responsible Party is *usually* the Adviser and sometimes deliberately isn't, and a Case needing no remediation has none recorded; so `responsible_party_name` is a plausible-looking proxy for the Adviser that is wrong on a minority of Cases and absent on the clean ones. Never key per-Adviser arithmetic on it.
_Avoid_: agent, rep, salesperson, Advisor (the old spelling here), Responsible Party (a different, review-time role — see `platform_frontend/CONTEXT.md`)

**Reviewer**:
The actor who reviews a Case. **Identified, across both halves of the system, by their bare account name in lower case** — the claims login `i:0#.w|CONTOSO\a.khan` reduced to `a.khan` (in this environment the account name is a numeric staff id, so the case-folding is a no-op that costs nothing and closes a real hole elsewhere). This is a **key**, not display copy: the Sync feed lands the full claims login in `assigned_reviewer_name`, the review platform strips the prefix and domain at its service boundary (`src/services/account-name.js`) and shows components bare accounts only, and AD is case-insensitive — so the *only* form both halves can derive independently and agree on is the lower-cased bare account. Any table or **Deliverable** keyed by Reviewer is keyed by that. A Reviewer's **display name is not in the Sync store at all** (the feed reads `AssignedReviewer/Name`, never `/Title`), so a per-Reviewer view either already knows the name — the signed-in user's own — or must resolve it against the directory.
_Avoid_: checker, assessor

**Staff Hierarchy**:
The **only** source in this system of the edge "person X is managed by person Y" — **Reference Data**, and the table the Reference Data entry used to call the *Adviser* hierarchy before **Reporting** joined **Selection** as a consumer. An external, current-state table (or view) named `current_hierarchy`, read directly by a `SqliteReader`: one row per person keyed by `login_name`, carrying `first_line_manager_login_name` alongside that person's other current details. It covers **every** user, not only **Reviewers** — hence the role-neutral name; **Selection** reads it for the frontline population and a **Responsible Party Manager** report would read the same table. One table, one term, so two consumers cannot disagree about who manages whom. Its `login_name` is already the canonical **Reviewer** key (lower-cased bare account, numeric staff ids in this environment), so joining it to a Reviewer costs a case-fold and nothing else. **It is complete by construction** — every user appears, including leavers — which makes an unmatched Reviewer a breach of a stated invariant rather than a reporting gap, and so **quarantined and counted** ([ADR-0007](docs/adr/0007-row-level-quarantine.md)) rather than absorbed into an `(unassigned)` bucket: the run still publishes and the total still reconciles, but a broken extract cannot masquerade as a quiet week. ([ADR-0019](docs/adr/0019-team-report-feed-attributed-by-the-staff-hierarchy.md))
_Avoid_: org chart (suggests the whole tree; this gives exactly one edge per person, and will drift from AD), reviewer hierarchy (asserts a scope the table does not have), roster, team list

**Reviewer Manager**:
The actor a **Reviewer** reports to, per the **Staff Hierarchy**. Keyed exactly as a Reviewer is — the lower-cased bare account — because they are drawn from the same population. Relevant to this half of the system only as the **grain of a Report Feed**: `teams/{manager}.txt` is the manager-side twin of the per-Reviewer `my-stats/{account}.txt`. Their reviewing-side capabilities, **Section** access role and live queue pages are the review platform's business and are defined in [`platform_frontend/CONTEXT.md`](platform_frontend/CONTEXT.md); this glossary defines only what a pipeline produces for one.
_Avoid_: team lead, line manager (overloaded — a **Responsible Party Manager** is also a line manager), owning team (there is no team entity; there is a manager and an edge)

**Case Type**:
A first-class classification of Cases that determines its fields, selection criteria, ingest rules, destination, and processing; new case types are added over time without changing the core. Referred to generically (case type A, B, C…) — the specific set is not yet fixed. It also **owns its identity contract**: the **natural key** column(s) that identify a Case, and the per-type **namespace** they are hashed under to mint the deterministic `case_id`. A feed declares those as `NAMESPACE` and `NATURAL_KEY` beside its row schema, so gold builders and every Detail Table receive the same explicit values and derive the *same* `case_id` independently. Changing either value re-keys history. **In the Sync store the contract sits one level up**, because one subject holds every Case Type: the namespace is the subject and the Case Type slug moves *into* the natural key, `NATURAL_KEY = ("case_type", "source_item_id")`. The structural property is unchanged — one declaration supplies every builder — and so is the trade-off, now attached to the subject name and the slug ([ADR-0016](docs/adr/0016-one-sync-subject-for-every-case-type.md)). The `sharepoint_cases` feed declares that key, namespaced under its own subject name.
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
A **gold** table whose rows are *counts*, not the rows they count — one row per combination of the dimensions it declares (its **grain**), plus the measure. Distinct from a current-state gold table, which is one row per Case, or per Detail row. An Aggregate table is rebuilt whole on every run (`Refresh()`) from a published **current-state** gold table — `case_current` *or* a Detail Table (itself current, holding the winning observation's rows per **Observation-snapshot reduction** above) — so it cannot drift from what it reduces and a re-drive converges; and its grain is *declared* (in the builder's docstring and the Data Dictionary) rather than gated, because a uniqueness check sitting immediately below the group-by that produced it is satisfied by construction and could never fire. Today, on the `sharepoint_cases` Feed: `case_counts_current`, `case_age_buckets_current`, `case_age_from_assigned_buckets_current`, and `case_throughput_daily`, reduced from `case_current` and counting Cases — each carrying the base grain below plus its own per-metric dimension (`status`, or an age bucket) — plus `answer_remediation_current` and `appeal_outcomes_current`, reduced from the `answer` and `appeal` Detail Tables respectively and counting *those tables' rows*, not Cases (an `answer_count` or `appeal_count` measure, not `case_count`) — a Case with several answers or Appeals is counted once per row, not once, and these two sit outside the base-grain family since they answer a different question with no stated Case-rollup. Plus `reviewer_activity_daily` on the `reviewer_activity` Reporting subject, which also carries `brand` for the same reason. The requirement-driven reviewer aggregate uses the measure `count`. The reviewer activity domain Pipeline commits that aggregate first, then runs one publication `Pipeline` with one Writer to emit `my-stats/{account}.txt` Report Feeds from the committed gold; it is scheduled on working days with a Sync freshness check; a publish-only retry uses that gold without recomputation. See the reviewer activity data dictionary for the detailed freshness policy.

**A common floor grain, then one Aggregate table per question.** Every Case-counting Aggregate table carries **Brand x Case Type x Assigned Reviewer** as its base grain, plus the table's day column where the table is daily (`case_throughput_daily`'s `terminal_date`) — so any report rolls up from the same floor no matter which of these tables it reads, and a Reviewer holding Cases across Case Types is never silently summed into one row. `*_current` tables carry no day column: they are point-in-time `Refresh()` snapshots stamped `as_of_utc`, the day axis lives in the daily tables, and a per-day history of backlog or age is out of scope today — it would be a new accumulating table, not a widened snapshot. No source reachable from this Feed carries Brand yet, so every builder fills it with the literal `(unknown)`; that is a considered, recorded decision rather than an oversight, and only the fill changes the day a Brand source lands, never the shape. Above that floor, the old rule still holds: a new consumer question earns a **new** Aggregate table with its own per-metric dimensions (`status`, an age bucket), not new dimensions bolted onto an existing one — widening a table's grain beyond its declared floor would still silently change what every existing consumer's rows *mean*, so the floor is exactly as wide as the base grain and no wider by convention. Aggregates are cheap (each is one group-by refreshed whole from a current-state gold table) and consumers are not, so the cost is deliberately pushed onto the producer. Two consequences: expect *many* narrow Aggregate tables layered on the same floor rather than a few wide ones, and an Aggregate table is named for the question it answers, not the dimensions it happens to carry. The original three tables were seeded to prove the shape, not drawn from a stated requirement; a requirement-driven aggregate should not be bent to fit them. Not every candidate earns a table, either — a grain that would count combinations rather than values, an unbounded-cardinality dimension, or a question the source already answers directly is refused rather than built; see the `sharepoint_cases` data dictionary's *What is deliberately not aggregated*.
_Avoid_: summary, rollup, cube, report (that is a **Deliverable**)

**As-of instant**:
The single instant a set of gold tables describes the world *as at*, stamped on every row as `as_of_utc`. For a **Polling Feed** it is the candidate window end the run is about to commit as its watermark — never "now": a re-drive of the same window must produce identical gold, and reading the clock inside the reduce would break that. It is an *instant* (UTC); where a **calendar date** is derived from it, the conversion to the local date is explicit, because instants are UTC and calendar dates are local.
_Avoid_: run date (that is run metadata, and local), snapshot date, load_date (that is a batch-load stamp a Polling Feed does not carry)

<a id="deliverable"></a>
**Deliverable**:
An outbound artifact a Pipeline produces for downstream consumption, in one of three concrete forms: a **file** (CSV/Excel/JSON), a **directly-readable view/table** the consumer reads, or **rows pushed to a platform-owned remote list** (a SharePoint Subscription Edition list — the canonical **Selection** Deliverable, one list per Case Type). The push form is an *active* write to a system the framework does not own, not a passive artifact left for collection; files are reserved for **Reporting** outputs. Emitted by a **Writer**: `CsvWriter`, `ExcelWriter`, and `JsonWriter` emit file Deliverables; SQLite Writers emit directly-readable tables; the stubbed `SharePointWriter` is the outbound dual of the **SharePoint Reader** (same source type, both directions).

**A Pipeline emits a Deliverable *locally*; it does not deliver it.** A Pipeline writes its artifact to a **deliverable outbox** — a directory on a shared drive, one per delivery destination — and its job ends there. Getting the artifact to where it is consumed (a SharePoint document library, a SharePoint list, a SAS environment) is **delivery**, performed by the **Forwarder** — a long-running loop outside this framework that watches the outboxes and does whatever each destination needs. Two reasons: a pipeline that also delivers carries credentials, an external failure mode, and a retry policy for a system it has no other business knowing about; and delivery is **irreducibly per-destination** — a library takes the file as-is, a list needs it parsed into items, SAS needs a copy *and* a script run — so the per-destination handlers exist either way, and one process holding all of them beats every pipeline box holding some. *(Designed, not yet built — see **Forwarder** below; the existing `SharePointWriter` list push predates it and is expected to migrate onto it.)*

A **fourth form** joins the three above: a **file destined for a platform-owned document library** — the review platform reads it back over HTTP as an artifact rather than as list rows. It is how **Reporting** hands pre-computed figures to the review platform's UI, so the browser renders a number rather than deriving one. Three rules hold it in place. It is delivered to a **report-feed library of its own** (`Shared Documents/cora_report_feeds/…`), never the Style Library and never the front end's deployed tree (`Style Library/CODE/CORA`): that tree is code, its deploy **deletes any remote file with no counterpart in the repository**, so an artifact written there would vanish at the next deploy. Its content is **JSON stored in a `.txt` file**, for the same reason the Question Bank artifacts are — SharePoint SE is unreliable serving `.json`. And a **stale Report Feed is kept, never deleted**: it carries the date its figures are complete through, so an old one tells the truth about itself, where an absent one only says "broken". Being outside the deployed tree is also what keeps it clear of the front end's "deployed bytes are source bytes" rule: it is published data, not shipped code.
_Avoid_: report, export, output feed (say **Report Feed** — see below)

<a id="report-feed"></a>
**Report Feed**:
A **Deliverable** whose consumer is a report, or a UI that renders one. Named from the **consumer's** side, which is the whole point of the term: the same artifact is *outbound* to the pipeline that emits it and *inbound* to the SharePoint page that reads it, and both readings are honest. The qualifier carries the direction, so **`Feed` unqualified stays strictly inbound** and nothing in the ingest half of this glossary shifts. Say "the pipeline emits a Deliverable" when the subject is the pipeline, and "the page reads a Report Feed" when the subject is the consumer — they are the same bytes. The library `Shared Documents/cora_report_feeds/` is named on the consumer's side for the same reason.

The `reviewer_activity` Report Feed is refreshed on working days (Monday-Friday
by default) with the Sync freshness check. After Friday, the live tail may use
an artifact complete through Thursday until the next scheduled working-day run
succeeds. The detailed freshness policy belongs in the reviewer activity data
dictionary.

**A different question earns a different Report Feed.** Two exist: `my-stats/{account}.txt`, one per **Reviewer**, answering "how am I doing"; and `teams/{manager}.txt`, one per **Reviewer Manager**, answering "how is my team doing". They are not one artifact with an extra column — a manager's file is grained by `date × case_type × reviewer_account` and carries the roster the per-Reviewer file has no reason to know. Both are reduced from the **same** gold aggregate, which is what stops them disagreeing about a number they share; widening the per-Reviewer artifact instead would have put one Reviewer's colleagues' figures in a file addressed to them. ([ADR-0019](docs/adr/0019-team-report-feed-attributed-by-the-staff-hierarchy.md))
_Avoid_: feed (bare, for anything outbound), output feed, report (that is what a Report Feed *feeds* — the SharePoint page is the report, this is its input)

**Data Dictionary**:
The human-readable description of a table/Feed and what each of its fields *means* — the prose companion to the machine-enforced `schema.py` (columns, dtypes, nullability, value rules). One entry per table per medallion layer (raw column names differ from the canonical silver/gold shape). Stored in **Confluence**; the checked-in [`docs/data-dictionary-template.md`](docs/data-dictionary-template.md) is the source-of-truth template. A new column is not "done" until it has a Data Dictionary row.
_Avoid_: schema (reserved for the enforced dataclass contract), glossary (that is this file, for domain nouns)

**Reference Data**:
Shared, cross-cutting data that many pipelines join against (e.g. the **Staff Hierarchy**, product codes, mappings). Ingested as ordinary **Feeds** and refined through its own per-subject medallion exactly like a Case Type's data, but **read-only** to its consumers — they join it (in Python) and never write it. Written when **Selection** was the only consumer, so it said "many Case Types' Selection joins against" and named the hierarchy an *Adviser* hierarchy; **Reporting** is now a second consumer of the same table and the narrower wording was hiding that. The Staff Hierarchy is the one instance that is **not** ingested through a medallion today — a knowing exception, flagged below.
_Avoid_: master data, lookup, static data

**Brand**:
A Case-level attribute carried by **Reference Data** (`pipelines.ref_lookup`),
used today by Selection's **Void replacement** ladder. No Sync subject —
`sharepoint_cases` included — has a join path to `ref_lookup`, so no
Case-counting **Aggregate table** can join Brand directly yet; each one
carries a `brand` column regardless, reserving the shape, filled with the
literal `(unknown)` until a join path lands (see **Aggregate table** above).
Spelled the same as `case_selection`'s ref-lookup attribute because it *is*
that attribute — this is the one place in this glossary it is defined, not a
second meaning.
_Avoid_: brand id, product line

**Shared Reader**:
A `Reader` over a named business dataset that **crosses a subject boundary** — the supported way for a pipeline to read data it does not produce. Its location and identity are declared once, in `readers/<subject>.py` named for the subject that *owns* the data, and a consumer instantiates it with a `base_dir` and nothing else (`CurrentCasesReader(base_dir=base_dir)`). The rule is **owned by the pipeline → the medallion store; not owned by the pipeline → a Shared Reader**: a consumer that names a layer or a table is asserting the producer's storage shape, which is what made the medallion load-bearing outside the subject that owns it. It is a *location* indirection only — a pass-through with no projection, coercion, join, aggregation or filtering, since anything it shapes is shaped for every consumer at once and invisibly, outside the DAG and the run log. It carries **no freshness requirement** either: how current the data must be is a statement about what a consumer can safely act on, so each consuming pipeline declares its own `UPSTREAMS` and two of them may legitimately differ. A dataset earns an entry when a pipeline that does not produce it reads it, or when it is a Feed's published contract, **and loses it again** if it drops back to one consumer inside its own subject. Not backed by a medallion by definition: the `users` directory feed has no producer pipeline at all, and a consumer cannot tell. Distinct from the **escape-hatch store**, which is knowing debt; this is the supported path. ([ADR-0026](docs/adr/0026-shared-readers-declare-cross-subject-reads.md), [`docs/shared-readers.md`](docs/shared-readers.md))
_Avoid_: shared store, common reader, data access layer (it mints no Writers and holds no logic), lookup

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
The Pipeline that reads the **CasePool** and produces the **SelectionPool** (filter/score/sort/join with other feeds' silver/gold), then emits it as a **Deliverable** to the review platform; governed by a Case Type / Variation's selection criteria. Per **Selection group** — *not* per Case Type, which is what this entry said while Ingest's per-Case-Type shape was assumed to carry through ([ADR-0021](docs/adr/0021-selection-plans-per-group-over-the-whole-eligible-pool.md)).
_Avoid_: picking; **sampling** (now a defined per-group narrowing *technique* within Selection — see **Sampling** — not a synonym for this Pipeline)

**Selection group**:
The set of Case Types that Selection plans as one, sharing a volume target, a composition split and a **Hopper**. _Here_: Case Types A, B and C are one group with a combined rolling-12-month target; every other Case Type is a group of one, so the group — never the Case Type — is the unit of *planning*. The Case Type remains the unit of *delivery*: each selected Case is delivered to its own Case Type's list. One Selection pipeline runs per group, because a per-Case-Type run could not know that Case Type B should absorb Case Type A's voided quota.
_Avoid_: cohort, batch, portfolio

**Hopper**:
The Cases sitting **unallocated** in a Case Type's list, waiting for a Reviewer to claim one — the Cases whose `Status` is **`To-allocate`**, which is the status the platform creates a Case in and the one its allocation claim replaces. Hopper depth is therefore a predicate on one indexed column, not a scan of live Cases with an empty Assigned Reviewer. In **person-targeted Selection mode** it is *only* the destination, and read *only* to see whether one **Adviser** already has something waiting — never a capacity signal. _Here_ (volume-targeted mode): Selection's only capacity signal, with a target depth of `3D` — where **D** is the group's daily *assignment* rate, the rate at which the Hopper actually drains. Not the rate checks are completed at: those diverge whenever work-in-progress changes size, and it is assignment that empties the Hopper. Read **directly**, as a count of unallocated Cases, never derived from outcomes — a Case that is assigned but not yet finished has left the Hopper without reaching any terminal state, so `target − completed − voided` overstates what is there.
_Avoid_: queue, backlog, pool (reserved for **CasePool**)

**Selection gate**:
*(Volume-targeted **Selection mode** only — person-targeted mode gates per **Adviser**, on the **Check cadence**, and has no volume gate.)* One of the only two conditions that stop Selection choosing a Case: the Case has **aged out** (its *related date*, not its ingest date, is older than the declared max age), or the **Hopper** is full. _Here_: everything else — the case-type split, the attribute split, the **Void replacement** ladder — *steers* which Case is chosen and never whether one is. Named as its own term because the volume targets read like constraints and are not: the monthly average **M** sets proportions and never blocks a selection, so as long as one un-aged Case exists and the Hopper has room, a Case is selected.
_Avoid_: filter (reserved for the `Filter` processor), criteria, cap

**Void replacement**:
Preferring a Case that resembles a recently voided one, so a void is made good like-for-like. _Here_: voids **since the last working day** (a **WorkingDayCalendar** question, so a Monday reaches back over the weekend), matched down a declared ladder — `(case type, brand, attribute)`, `(case type, attribute)`, `(brand, attribute)`, `(attribute)`, `(case type)`, `(brand)` — taking the oldest Case at the first rung that matches. The ladder crosses Case Type boundaries, which is only coherent because the **Selection group** is the planning unit. A void neither raises the Hopper target nor carries forward: it is a preference over the slots that happen to exist that day, and lapses if the Hopper had no room. A voided Case is never itself re-selected, and never counts toward progress — it was not a check.
_Avoid_: backfill, substitution, re-selection

**Selection order**:
*(Volume-targeted **Selection mode** only — person-targeted mode ranks **Advisers**, largest shortfall against **Check target** first, then highest risk score.)* The single sort that chooses Cases from the eligible pool: **Void replacement** rung first, then *related date* oldest-first. _Here_: oldest-first is the universal rule and void matching the only thing that ever overrides it — which is why a newer Case can be taken ahead of an older one, and why the **Selection trace** must show the older Cases it jumped. One sort with a preference key, not two algorithms in sequence.
_Avoid_: ranking, prioritisation, priority (reserved for the orchestration tie-breaker)

**Selection mode**:
Which question a Case Type's Selection answers. **Volume-targeted** plans a **Selection group** against a combined volume target and gates on **Hopper** depth — *"how many Cases fill the hopper"* ([ADR-0021](docs/adr/0021-selection-plans-per-group-over-the-whole-eligible-pool.md)). **Person-targeted** plans per **Adviser** against a pro-rata **Check target** and has no volume gate at all — *"who is due a check"* ([ADR-0022](docs/adr/0022-person-targeted-selection-plans-per-adviser.md)). **A Case Type declares exactly one**, because the invariants are incompatible: one fills a list to a declared depth, the other delivers whatever its roster is owed regardless of depth, and pointing both at one list holds neither. They share the Sync-derived data and very little else — different gate, different sort, and **Void replacement** exists only in volume-targeted mode.
_Avoid_: strategy (overloaded — a `Writer`'s load strategy), framework 1 / framework 2 (numbers say nothing about what they do), algorithm

**Check verdict**:
The recorded outcome of considering one **Adviser** on one person-targeted Selection run — `selected`, `at target`, `within cadence`, or **`no eligible case`**. The last is the one that matters: an Adviser who owes a check and has nothing available to select. It is the person-targeted twin of the volume framework's "how many were available within max age", and without it an Adviser starved of eligible Cases is indistinguishable from one who does not exist, so the framework can under-deliver indefinitely while looking healthy. Reported through a per-Adviser current-state table and a daily distribution grained `date × case type × shortfall × verdict` — the **distribution**, not a total, because a population mostly one check **Behind** is healthy (those are tomorrow's selections) while a cluster four-to-six behind is not, and crossing shortfall with verdict is what separates an Adviser catching up from one who is starved.
_Avoid_: reason (that is the located phrase inside a verdict), status, exclusion (only some verdicts exclude)

**Sync**:
The Pipeline that pulls the review platform's own state — **Review Outcomes** and its full picture of each Case — into a platform-wide store; one-way inbound, no correlation. Spans all Case Types. Runs on **two cadences, as two separately addressed pipelines**: the poll (source → raw → silver) hourly, and the publish (silver → gold) daily. Splitting them is what keeps an hourly cadence affordable, because the publish is the whole of the expense — see [ADR-0023](docs/adr/0023-sync-polls-hourly-publishes-gold-daily.md). The split was justified by **Notification** being the sole hourly consumer *and reading silver observations*; it reads **gold current state** ([ADR-0024](docs/adr/0024-notification-recipients-are-the-two-parties-who-did-not-speak-last.md)), so the hourly half now serves nobody — worth knowing when this split is next revisited, but Notification is correct at any cadence and is not waiting on it. *(Decided, not yet built: `pipelines/sharepoint_cases` still does both in one run.)*
_Avoid_: writeback, reconcile, import

**Notification**:
A message telling a Case participant that something on their Case needs their attention. _Here_: produced by the `notifications` pipeline reading **Sync**'s **gold current state** — `case_current` and the gold `conversation_message` Detail Table, so the last Message, the Case's people and its status arrive at one grain, already reduced ([ADR-0024](docs/adr/0024-notification-recipients-are-the-two-parties-who-did-not-speak-last.md)) — and emitted as a **Deliverable** — one JSON file of many notifications, written **per pass** to a path of its own under `deliverables/cora_notifications/`, so a `Refresh` can never overwrite a file nobody has drained yet — which the notification service drains as a per-file work queue with no ordering key. Each object in the array carries exactly three keys, `recipients` / `subject` / `body`, and a pass owing nobody anything writes **no file at all** rather than an empty array (see [`docs/data-dictionary-notifications.md`](docs/data-dictionary-notifications.md)). It emits whatever has been required since the last run, the first run emitting everything, and is correct at **any** cadence because its dedupe is state-based rather than clock-based — daily, hourly or every ten minutes changes only how promptly a Message is reported, never which notifications are owed. Two triggers only: a Case becoming Reportable **and** carrying remediation, and a new **Conversation** **Message** (the review platform's terms — see [`platform_frontend/CONTEXT.md`](platform_frontend/CONTEXT.md)). Both are built, as two independent selections over the same **gold current state**, each anti-joined against its own table in the **Notified ledger** — so one Case qualifying under both triggers in one pass produces **two objects** in the one file, neither suppressing the other. It is **not** a **Report Feed**: a Report Feed is a published dataset, a Notification is an instruction to tell a named person something once. A pass emits a **second** Deliverable beside the notifications, to `deliverables/cora_user_group_privileges/` — see **User group privileges** below.
_Avoid_: alert, email; message (reserved for a Conversation entry)

**Notification rule**:
The predicate deciding *who* is notified. _Here_: one rule per trigger, each derived purely from the **current** state of the latest observation — never from a diff of what changed since the last run. Reportable notifies the **Responsible Party and their Manager**, the Manager resolved from the **directory** off the Responsible Party's own row, when `reportable_at` is stamped, `had_remediation` is true, and `status` is not terminal. It reads `had_remediation`, never `effective_had_remediation`: the trigger is about the milestone, and `had_remediation` is what is frozen there, where `effective_had_remediation` is the later, post-amendment correction. A Conversation Message notifies **the two silent parties** — the two of the three thread parties (Assigned Reviewer, Responsible Party, Responsible Party Manager) **who did not author the last Message**. That second rule *is* the whole of the "don't notify someone who has already replied" requirement: whoever spoke last is by definition the one who does not need telling, so no message identity and no per-message diff is required. Its one accepted cost is that a Manager's courtesy post after the Responsible Party has replied re-notifies the Responsible Party — over-notifying is the safe direction. ([ADR-0024](docs/adr/0024-notification-recipients-are-the-two-parties-who-did-not-speak-last.md))

**The two silent parties**: the recipient set the Conversation Message rule produces, named so the exclusion has a term rather than only a description. Three properties define it. It is derived from the **current** thread — the last Message's author, not a diff. A party who is **absent** (no Responsible Party named) or **unresolvable** (no directory row, or a row with no email address) is **skipped, never substituted**: the notification goes to whoever is left, never to a fallback recipient and never to an `(unassigned)` placeholder, and an unresolvable party is also left out of the **Notified ledger**, so they are told once the directory learns them. And the set is of *people*, not roles — one person holding two roles collapses to one recipient. The Responsible Party Manager in this set is resolved from the **directory** (the `users` reference feed), never from `responsible_party_manager_name`, which nothing writes. The Reportable **Notification rule**'s recipient set shares all three properties — skipped-never-substituted, collapse-by-person, Manager-from-directory — over a different pair of parties.
_Avoid_: recipient logic, routing (informal), silent party (singular — the term names the pair)

**Notification suppression**:
Not sending a Notification the trigger would otherwise produce. _Here_: there is no separate suppression step — it is a *property* of the **Notification rule**, which selects recipients rather than selecting-then-filtering. Stated as its own term only because the requirement arrived phrased as an exclusion ("if the receiver has already replied, do not notify"), and a future reader looking for the filter needs to be told there isn't one.
_Avoid_: mute, snooze, debounce

**Notified ledger**:
The record of which Notifications have already been sent — one table per trigger, because the two do not share a natural key. `notified`, the Conversation Message trigger's table, is keyed `(case_id, recipient, message_at)` — a recipient is notified only when the triggering event is newer than the last one they were told about. **`message_at` is the triggering Message's own `posted_at`**, carried through verbatim, and **the ledger row *is* its key**: it carries those three columns and nothing else, so re-presenting a row a run already wrote is a no-op rather than a conflict, and "which run first told them" is answered by the Writer's own run-provenance column. _Here_: keyed on the **domain event's own timestamp**, never on `source_observation_id` (a Case gets a new observation for unrelated edits, which would re-notify) and never on a **time window** — the Sync poll's deliberate five-minute `OVERLAP` means any window-based dedupe re-emits every pass *by design*. `notified_reportable`, the Reportable trigger's table, is keyed `(case_id, recipient)` alone — **no timestamp column**, because `reportable_at` is frozen at the milestone and never advances, so a third column would do no work distinguishing rows a second time. "The ledger row *is* its key" still holds for both tables. Distinct from the **Run store**: that records what a run did, this records what a person was told.
_Avoid_: dedupe table, sent log

<a id="user-group-privileges"></a>
**User group privileges**:
The **Deliverable** naming the SharePoint groups a **Notification**'s frontline recipients must hold to open the Case they are being told about — `deliverables/cora_user_group_privileges/add_user_group_priviledges_<YYYYmmddHHMMSS>.json`, an array of objects carrying `login_name` (the bare account name) and `groups` (an array of group names). Emitted by the same pass as the notifications and written **before** them, so nobody is told about a Case before the request for their access to it has landed; a pass with no frontline recipient writes **no file at all**, the same rule the outbox follows. Its consumer is whoever provisions group membership, **not** the notification service — hence a destination of its own. Frontline is a property of the **role** a recipient was selected for (**Responsible Party** and their **Manager**), taken while the roles are still distinguishable, because one person holding two roles has already collapsed to one recipient by the time the rows exist; the **Assigned Reviewer** is notified and does not appear. Today's only group family is per-Case-Type, `Frontline - <Case Type display name>`, composed through a **declared** slug → display-name map (`CASE_TYPE_NAMES`) rather than a derivation — nothing guarantees a display name is a title-cased spelling of its slug, and an unmapped Case Type fails the run rather than naming a group nobody was provisioned into. The file states what a login must **end up** holding, not what must be added: current membership is not knowable from here, granting twice is a no-op and withholding once is a locked-out recipient. The spelling `priviledges` is the consumer's own and is deliberate. (See [`docs/data-dictionary-notifications.md`](docs/data-dictionary-notifications.md).)
_Avoid_: permissions file, ACL feed, group sync (nothing here syncs — it is a one-way request)

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

<a id="deliverable-outbox"></a>
**Deliverable outbox**:
The owner of a base directory's local deliverable layout —
`<base_dir>/deliverables/<destination>/…` — is `tools.deliverables`. Its
canonical report-feed destination is `REPORT_FEEDS_DESTINATION`, its
**Notification** destination `NOTIFICATIONS_DESTINATION`, its **User group
privileges** destination `USER_GROUP_PRIVILEGES_DESTINATION` — a destination of
its own precisely because a consumer that drains a directory reads every file in
it as one contract, so a second shape belongs in a second directory — and
`shared.constants` declares the dev/prod roots used by the application, and
`tools.environments` lets `PIPELINE_DATA_DIR_DEV` and `PIPELINE_DATA_DIR_PROD`
override them; an unset production override is reported to stderr when the
committed production root is used.
This names the local outbox only: external delivery remains outside the
framework — it is the **Forwarder**'s.

**Forwarder**:
The long-running loop that empties the **deliverable outboxes** and performs
delivery. Named for a *freight* forwarder, which does not own the transport but
arranges whatever handling each destination needs — the point being that
delivery is **irreducibly per-destination** (a document library takes the file
as-is, a list needs it parsed into items, SAS needs a copy *and* a script run),
so the Forwarder is a small application with one **route** per destination, not
a file-copying script. _Here_: its own top-level project, `forwarder/`, with its
own `CONTEXT.md` and `docs/adr/`; it shares exactly one thing with the pipeline
framework — the outbox layout `tools.deliverables` owns — and imports nothing
from it. Six rules hold it together:

- **Routes are declared, in `routes.yaml`.** One route per destination
  directory: which handler serves it, and that handler's settings. The config is
  the whole world — an unconfigured directory is never opened — so the producer
  side names destinations through the constants in `tools.deliverables` and a
  test asserts every one of them has a route. A misspelled destination then
  fails a commit rather than going quiet for three weeks. Credentials are never
  in the file; it names a credential, the environment supplies it.
- **Readiness is a quiet period**, not an atomic rename: a file whose size and
  mtime have been still for long enough is taken as finished. That is a
  heuristic a slow share can beat, so **the handler validates content before it
  ships** — the Report Feed handler parses the JSON it is about to send, and a
  truncated file simply fails, is left alone, and is retried. Deliberately
  chosen over making every Writer rename its output, which would spread the
  Forwarder's contract across the framework.
- **It drains and archives; it does not mirror.** Delivered files move to an
  archive; the outbox holding a file means that file is pending. The filesystem
  is the state, so there is no ledger that can disagree with reality, retry is
  free (the file is simply still there), and an operator reads pending-versus-
  done by listing two directories.
- **The tick is the retry.** A failure leaves the file where it is and the next
  pass tries again — one retry mechanism, not an inner backoff loop as well.
  After N *consecutive* failures the file moves to the **dead letter**
  directory. Consecutive failures, not the file's age: a file written on Friday
  and found on Monday is three days old and has never been attempted, so age
  measures Forwarder downtime rather than delivery trouble.
- **Its SQLite log is advisory.** It records how each file has been going and is
  what makes "N consecutive failures" answerable; it is never asked *whether a
  file is pending* — the outbox answers that. Losing it therefore degrades
  safely: nothing dead-letters and everything keeps retrying. It is a **fifth**
  category in a base directory, beside the rows the `StoreRegistry` lays out,
  the runs the **Run store** records, the source checkpoints, and the
  deliverables root, and it keeps its **own** declaration of its own contract —
  a delivery has no pipeline, step address or logical run id, so it is not a
  **Run record** and does not go in one. Same call the orchestration decision
  store already made.
- **Nothing watches the Forwarder itself.** The oldest pending file's age is the
  health signal, but the Forwarder is what reads it, so a dead Forwarder reports
  nothing. Accepted deliberately, and stated rather than left missing: someone
  checks it is running.
_Avoid_: delivery agent (**agent** is the Advisor's), delivery job (**job** is
banned for **Pipeline**, and this is emphatically not one), courier, mover

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
A repeated-run shape for independent items that all follow the same pipeline shape.
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
- A **Variation** references the **Question Bank** (`question_bank_id`) the Reviewer uses; the review platform derives which bank to present from its own Case Type configuration, so selected Cases carry no bank reference (content owned by the review platform)
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
| **Sync** | platform-wide: **one** subject for every Case Type, `sharepoint_cases`, one set of tables, discriminated by `case_type` | **History-upstream / current-gold**, like Ingest: raw + silver accumulate every **Version observation**; gold is `Refresh()`-rebuilt and current-only — one row per Case, plus **Detail Tables** reduced by **observation-snapshot reduction**. ([ADR-0016](docs/adr/0016-one-sync-subject-for-every-case-type.md)) |
| **Reporting** | platform-wide, **per report** | **Chosen per report, not prescribed.** A point-in-time view that must survive as evidence accumulates by run; an **Aggregate table** that is a pure function of its upstream is `Refresh()`-rebuilt so a re-drive converges; a large one may earn an incremental load that only processes dates not yet seen. Each emits a **Report Feed** or a report. The earlier blanket "*accumulate-by-run* gold" was written before any Reporting pipeline existed and prescribed a load strategy for work nobody had done yet — load strategy is per-feed, owned by the Writer, and that rule applies here like anywhere else. |

So **CasePool** and **SelectionPool** relate to **Ingest** and **Selection** only; **Review Outcomes** live in the **Sync** store. **Load strategy is per-feed, owned by the Writer** (the Store maps `layer → location` only; each strategy realises its own Writer, so the Store branches on nothing); there is no longer a single "gold accumulates everywhere" rule. Where a layer accumulates, its history survives across runs (stamped with a logical run id / `load_date` and, when context-driven, execution id; idempotent re-run via delete-by-logical-run). Ingest's *current* gold is reduced from accumulated silver and its one-row-per-Case grain is enforced at the gold boundary. There are **two reduction shapes**, chosen by what the silver rows carry: a batch-loaded silver reduces with `LatestPerKey` by `case_id` over `load_date`; a **Polling Feed**'s silver has no `load_date` (an `AppendOnly` target compares every non-key column, so a per-read stamp would make each overlapping re-read look like a change) and reduces instead by the *source's own version* — `source_modified_at`, then the parsed source version, then the deterministic observation id. Both shapes reduce the **Case** table; a **Detail Table** whose parent arrives whole does not reduce on its own key at all, but follows the winner by **observation-snapshot reduction**. Alongside the current-state table an Ingest gold may publish **Aggregate tables**, all refreshed whole and all stamped with the same **as-of instant**.

**Store topology (current working assumption).** Where a feed lands is **application infrastructure**, not framework vocabulary: the opaque **`namespace`** (a *logical database*, one file holding many related tables) → file mapping lives in the sibling `tools.store`. `StoreRegistry(root).store(namespace)` mints a namespace **Store** that binds `(namespace, table)` to concrete Readers/Writers; it does not infer load strategy or business meaning. `StoreRegistry` also registers named Readers/Writers (`register(name, reader|writer)` → `reader(name)` / `writer(name)`) so a pipeline refers to a component by name. The raw/silver/gold **medallion is an application-level profile** (`tools.medallion.medallion(registry, subject)` → `.raw`/`.silver`/`.gold` namespace Stores), layered over the same `tools.store`. Physically the medallion still maps to one three-file medallion **per subject** for now (`<subject>/{raw,silver,gold}.db`). A normalised schema can span several namespaces (one database per namespace; cross-database joins stay in Python). **Sync's topology is settled**: *one* subject, `sharepoint_cases`, holding every Case Type's Cases and **Detail Tables** in shared tables discriminated by a `case_type` column — the Case lists are provisioned from one template so they cannot diverge in shape, per-Case-Type variation is already key/value rows inside the blobs, and one database per subject means splitting by Case Type would make every cross-Case-Type query an `ATTACH` forever ([ADR-0016](docs/adr/0016-one-sync-subject-for-every-case-type.md)). The `sharepoint_cases` feed polls every declared Case list into those shared tables. Reporting's topology is still open.

**A table's physical shape is owned by SQL, not by Python.** A database carrying
a `schema_migrations` ledger has its tables, keys and indexes declared by the
numbered files under `migrations/<subject>/<database>/` and applied by
`python -m cli migrate`; the declared **row schema** dataclass continues to own
*intent* — what a row means, what its values must satisfy — and nothing about
[graduated schema enforcement](docs/adr/0006-graduated-schema-enforcement.md)
changes. Strictness is **per database and self-declaring**: the ledger's presence
is the whole opt-in, so a database without one behaves exactly as it always has
and subjects convert one at a time. Three subjects are under migration control
today — `sharepoint_cases`, `reviewer_activity` and the `notifications` ledger
subject; everything else under `pipelines/` is a demonstration that writes only
into a `tmp_path`. **Changing a deployed table is a new numbered migration**,
never an edit to an applied one (its checksum is recorded) and never an edit to
a dataclass alone ([ADR-0025](docs/adr/0025-sql-migrations-own-the-physical-table-shape.md),
[migrations.md](docs/migrations.md)).

**New data on the Case Review Platform is assumed to need a pipeline change.**
The two projects share a system and not a glossary, and a column added to a
`Cases-{slug}` list breaks nothing downstream — the feed keeps polling what it
always polled — so the omission is invisible unless someone looks for it. The
default is therefore that new frontend data flows through to the pipelines;
deciding it does not is the rare case and is **recorded with a reason**. Every
such change is considered from **both** sides of the model: the frontend's
`Cases-{slug}` column schema (the provisioning authority) and this project's
declared row schemas, since neither is authoritative for the other. The rule is
held by a test, not by memory — see `CLAUDE.md` for the three that enforce it.

**Each feed wires its own medallion steps.** There is no shared definition of the standard source → raw and raw → silver steps: every `to_raw` / `to_silver` / `to_gold` is six or so readable lines a junior developer can follow top to bottom and edit in place — and, since the steps are eager, step through in a debugger, one line at a time, watching the rows change ([ADR-0027](docs/adr/0027-eager-steps-are-the-default-authoring-model.md)). The trade is deliberate — a policy change to "the standard raw → silver step" now has to be made in each feed — and it was taken because one shared definition every feed composed was harder to read than the six lines it saved. This holds for **silver → gold too**: the shared `ingest_silver_to_gold` / `detail_ingest_silver_to_gold` builders every Case Type called were removed, because with this few pipelines there is not yet enough evidence of what a shared reduction should generalise over — each feed writes its own, and what makes a Case and its Detail rows agree is that both are handed the *same* namespace and natural key. A feed that drives the same shape many times over — one per source list, per Detail Table — **names its steps** for what they build (`name=f"silver:{case_type}:read"`), which is what keeps its run log saying *which* list a step belonged to; there is no grouping scope, and a record's `pipeline` field is always the run's own label.

**Per-subject files are the current stage, not the end state.** One subject → one medallion → three files is what isolates a new pipeline cheaply *while the schemas are still being discovered*, and the single-writer-per-file rule is why a new pipeline takes its own subject rather than adding a table to someone else's. Neither is a prohibition. The expected destination is the opposite shape: once enough pipelines exist for the recurring schemas to have **fallen out of them**, a small number of strongly-schema'd databases — plausibly one per layer, `raw` / `silver` / `gold`, with each table prefixed by its subject — and the pipelines repointed at those. So "this pipeline writes its own subject" is a statement about today's uncertainty, and a design that assumes per-subject files are permanent is arguing against a direction already chosen.

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
- **Question Bank ownership** — RESOLVED (revised): the review platform owns the Question Bank outright — its **content**, and **which bank a Case gets**, derived from the platform's own Case Type configuration. Selection stamps nothing: an earlier resolution had the pipeline stamp `question_bank_id` onto selected Cases, but nothing Selection knows feeds that choice, so the deployed complaint group's stamped column was dropped (`migrations/selection_output/complaint_selection/0003`). A `Variation` may still declare a `question_bank_id` as domain configuration where a Case Type's variations differ by bank; it is not a delivered column.
- **"Pipeline" — term vs class** — RESOLVED: the four end-to-end phases (Ingest/Selection/Sync/Reporting) are **Pipelines** (the domain term). The `Pipeline` *class* (`framework/run/builder.py`) is finer-grained — a deferred builder for **one Feed/table** — so a domain Pipeline composes one or more class `Pipeline` runs. The class can be inspected before execution with `.describe()`, which renders the same ordered plan that `.run()` executes: reader, explicit read dependencies, ordered Tasks, governance outputs, writer, and run-log sink without running the feed. A **Task** is a named unit within one class-level run (`Reader -> Dataset -> Task* -> Writer`), such as validation, processing, or an explicit checkpoint write; it is not a domain Pipeline, medallion layer, or second terminus. "Stage" is older/informal wording for this run-step idea, while "Layer" stays reserved for raw/silver/gold.
- **Inbound vs outbound** — RESOLVED, then refined: **Feed** unqualified is inbound-only; an outbound artifact is a **Deliverable**. The **Sync** Pipeline is one-way inbound (no push, no correlation); the **SelectionPool** reaches the review platform as a Deliverable emitted by **Selection**. The refinement: a Deliverable read by a report or a UI is a **Report Feed** — the artifact is outbound to its producer and inbound to its consumer, and the qualifier is what names the direction. So "output feed" stays banned and bare "feed" still means inbound; only the two-word term points outward.
- **`Dataset` vs CasePool** — RESOLVED: `Dataset` is the framework primitive renamed from `DataHandle` — the opaque, **bulk** in-memory carrier (the bulk tier of the two-tier carrier; pandas behind the seam), returned by `Reader.read()` and flowing through builders/processors/Writers. It is **not** the **CasePool**, which is the domain population of **Cases** read from silver/gold and surfaced as typed `Case` objects. The two tiers meet only *inside* CasePool: it reads a `Dataset`, then materialises typed Cases. So "dataset" stays an `_Avoid_` alias for the *CasePool concept*, while the capitalised type `Dataset` is the carrier. (Renamed from `DataHandle` because "handle" implies a lightweight pointer; the thing actually owns a tableful of rows — the noun was the onboarding tripwire.)
- **Store topology** — PROVISIONAL (working assumption, not yet an ADR): the framework addresses an opaque **`namespace`** (a logical database) → file; a **Store** is namespace-scoped and binds `(namespace, table)` → Readers/Writers. The raw/silver/gold **medallion** is an application profile (`tools.medallion`) over that, no longer framework vocabulary. Physically one SQLite DB per Case Type shared by Ingest + Selection, one DB for Sync (all Case Types), one for Reporting (all Case Types). Separate Python `Store`s/Writers may point at the same file. Revisit when Sync/Reporting are built.
- **Who delivers a Deliverable** — RESOLVED (designed, not yet built): the **Forwarder**. A Pipeline writes its artifact to a local **deliverable outbox** and stops; `tools.deliverables` owns the `<base_dir>/deliverables/<destination>/…` path and `shared.constants` declares the environment roots, while `tools.environments` applies the per-environment OS overrides. A Pipeline's side of it is unchanged and small: **write into `<base_dir>/deliverables/<destination>/…` and stop** — overwriting or replacing what is there, never appending, and never reading back what a previous run left. The Forwarder is a long-running loop in its own top-level `forwarder/` project in this repository (co-located so a change to the outbox layout breaks its tests in the same commit; it imports nothing from the framework). Everything the ticket left open is settled in the **Forwarder** entry above: it **drains and archives** rather than mirroring; readiness is a **quiet period** plus content validation in the handler, so there is no batch manifest and no completion marker — a Report Feed carries its own `complete_through`, so a partly-delivered set still tells the truth about itself; retry is **the next tick**, with **N consecutive failures** sending a file to the dead letter directory; and delivery events go to the Forwarder's **own** SQLite log, *not* the run record. Draining the *local* directory does not conflict with keeping a stale **Report Feed**: that rule is about the artifact at its destination, which is only ever overwritten. Two things remain open and are ticketed separately: whether the existing `SharePointWriter` list push — Selection's Deliverable — migrates onto the Forwarder (agreed in principle, while it is still stubbed and migration is free), and who notices when the Forwarder itself has stopped. Until the Forwarder exists, a Report Feed reaches SharePoint by an interim manual copy — accepted as not-ideal rather than blocking.
- **Staff Hierarchy read directly, not ingested** — KNOWN EXCEPTION, WITH AN INTENDED DESTINATION: the **Staff Hierarchy** is **Reference Data**, and the Reference Data rule is that such a source is ingested as an ordinary **Feed** through its own per-subject medallion. It is not. It is read directly by a `SqliteReader` over the external `current_hierarchy` table, joined in Python, because the table lives outside this framework today and is stubbed here until the real one is wired up. Two consequences are accepted rather than solved. **Attribution is by the manager of the moment**: a **Report Feed** is rewritten whole every run over a 13-month window, so a reorg on Tuesday re-attributes a year of already-completed team history on Tuesday night — the shape ADR-0012's freeze-at-Reportable rationale exists to prevent, reached through a side door. And **the org chart's history is not retained by us**: nothing accumulates the edge, so there is no record of who managed whom last March to attribute against, and switching to as-at-date attribution later cannot recover the period before the change. Landing it through its own medallion is the intended destination precisely because accumulated silver *is* that history; until then the numbers on a team page are "as this team stands today", not "as it stood then", and that is what the page must say.
- **Selection's two writes (gold audit + Deliverable)** — RESOLVED, then superseded in its second half: Selection both writes the **SelectionPool** to its gold (audit trail) and emits it as a **Deliverable**. These are **two pipelines, not one run with two writes** — consistent with the case-identity and gold-grain decision's "single-Writer pipelines over a shared source" (no multi-Writer terminus, no checkpoint required). Mid-run lineage (a `.write()` node placed mid-graph) is a separate, general-purpose feature and is **not** the mechanism here. What has changed is the *second* pipeline's job: it no longer "writes to the SharePoint list". It writes a JSON **Deliverable** into the **Deliverable outbox** and stops; reaching SharePoint is **delivery**, performed by the **Forwarder** outside this framework. The original wording predates the Forwarder decision recorded above and described a push this project no longer owns.
- **One feed, many tables** — RESOLVED: the old "one feed → one silver table → one gold table" assumption is dropped. A Feed yields **one Case table and zero or more Detail Tables**; the wide feed is fanned out by **N single-table pipelines over the shared raw table**, each projecting its columns and sharing one reusable normalisation `Processor`. No new core seam (rejected a multi-Writer terminus and a splitting Processor — both break the single-Writer/single-Dataset shape). Built through `SelectColumns`, `Unpivot`, `DeriveKey`, `LatestPerKey`, `UniqueValidator`, and the case-review gold helpers.
- **Case identity** — RESOLVED: a Case's identity is a **deterministic** surrogate `case_id`, a `sha256` hex digest over a canonical JSON encoding of the Case Type's name (the namespace) and the feed's stable natural-key columns — same Case → same id every run/machine, so idempotency holds and the Case ↔ Detail link needs no join. A random `uuid4` is rejected (breaks idempotency); a persistent identity map is the deferred fallback for a feed with no natural key. The encoding hashes the key columns **by name** rather than joining their values, because a joined key is forgeable — a value containing the separator can reproduce another Case's key exactly. It was `uuid5` over a `"|"`-joined key until that flaw was closed.
- **Streaming vs the small-volume premise** — RESOLVED (opaque-carrier ADR amendment): that ADR's Consequences said volumes were small (≤ ~1M rows/feed/run) so "no chunking/streaming machinery is needed up front. Revisit only if a feed grows large." A feed *did* grow large (~100M rows, ~500MB landed per run, ~1.5GB after three) and the revisit happened in code, but the ADR was never amended and so contradicted both the code and `docs/streaming-large-sources.md` while carrying `status: accepted`. Now amended. The **opaque-carrier decision stands unchanged**: the in-memory contract holds per chunk, there is no lazy `Dataset` variant, and `ChunkReader` is deliberately *not* unified with `Reader` by a materialising `read()`. Only the volume premise is corrected.
- **Load strategy vs layer** — RESOLVED: load strategy is **per-feed, owned by the Writer**; the Store maps `layer → location` only (no load decision). The global "refresh upstream / accumulate downstream" rule becomes the *default* profile, not a law. Ingest can adopt **history-upstream / current-gold**; Selection/Sync/Reporting keep accumulate-by-run gold. Consequence: where the source is destructive, accumulated raw/silver are a **system of record** (backup matters) and volume grows `records × snapshots`. Built through explicit Writer strategies (`Refresh`, `AccumulateByRun`, `UpsertStrategy`, `InsertOrIgnore`, `InsertIfAbsent`, `AppendOnly`), each of which mints the Writer that implements it.
- **Atomicity of run artifacts (publish unit)** — RESOLVED: a run's artifacts — **quarantine** rejects, the **Selection trace**, **checkpoints**, and the final output — are **independently committed evidence**, *not* one all-or-nothing publish unit. Atomicity is **per writer, per layer DB** (a single delete+insert), not across writers; an abort *after* an artifact write leaves that artifact on disk. Chosen deliberately: evidence is most valuable when the run then fails. Each run-log step carries a **`committed`** marker so operators can see what landed before an abort — and each step carries exactly one such record. Hardening the per-writer transaction itself is a separate concern.
