# Migration assessment: current multi-stage pipeline → data-pipeline-tooling framework

This report assesses how the existing **Stage 1 → Stage 2 → Stage 3** pipeline
(8 scripts across ingest and selection) would port onto this framework. It is
grounded in the framework as it actually exists today (`framework/`, the ADRs,
and `CONTEXT.md`), not the framework as aspirationally documented — where the
docs and the code disagree, the code wins and I say so.

## TL;DR

Porting is **feasible and a good fit**, but it is **not a script-by-script
lift**. The current 8 scripts collapse into roughly **4 domain Pipelines**
(Ingest, Reference Data ingest, Selection, Deliverable/upload) plus a handful of
fan-out runs. The framework's core shape — per-subject medallions, the deferred
builder, plain-Python processors, schema-at-silver, run history — directly
targets almost every pain point you listed.

The real work is in **four genuine gaps** (custom CSV reader, directory/file
discovery, outbound writers, and a way to organise ~150 ordered flags as named
rules rather than a chain of lambdas) and in the **business-rule archaeology** of
a 2K-line script. Difficulty: **medium-high**, and the high part is your domain
logic, not the framework.

The single most important decision: **do not carry the legacy `pool.db` "old
feed shape" into the new core.** It is the source of most of your listed pain
(type drift, coercion to a dead format, scripts each re-aligning new→old). The
framework's `Case` schema is meant to *be* the canonical shape; the old format,
if needed at all, becomes a temporary compatibility Deliverable.

---

## How the current stages map onto the framework

| Current script | What it really does | New home |
|---|---|---|
| **S1.1** ingest CSV → append SQLite → export XLSX of all-cases-latest | Land daily modified-case snapshots; reduce to current state | **Ingest Pipeline** for the Case Type. Custom reader → raw (accumulate) → silver → gold (`LatestPerKey` by `case_id`). The XLSX export is no longer an internal hand-off — gold *is* the current state. |
| **S1.2** XLSX → column map + filter + join user-ID CSV → CSV | Re-shape + join reference mapping | Folds into the **same Ingest Pipeline**: `Rename`/`SelectColumns` processors + a `JoinWith` against the **user-ID-mapping Reference Data** subject. No intermediate file. |
| **S2.1** read dir of files → remap to `pool.db` legacy shape → split/join/filter → risk rules (accumulate points) → insert where status=5 → export selection-pool XLSX | Normalisation + risk scoring + availability query | **Split in two.** Normalisation + risk scoring belong in **Ingest** (processors + a `RiskRuleSet`, scoring into gold). "status == 5" and "available in XYZ period" become **CasePool retrievals** (`fetch_available_cases`). The legacy remap is *deleted*. |
| **S3.1** selection-pool + synced platform DB + hierarchy → compute checks-needed (12-mo active ⇒ 8, else pro-rata), checks-had, exclude satisfied + in-progress → XLSX | Adviser eligibility / requirements | **Selection Pipeline**, step 1: CasePool + Reference Data (`hierarchy`, `platform_sync`) joined in Python; requirement maths as a named domain component; `WorkingDayCalendar`/month-activity helper for "active month". |
| **S3.2** S3.1 + S2.1 output + separate feed → flag "extra part of case" | Extra-case-type tagging | A processor/`JoinWith` step *within* the same Selection Pipeline (or a sibling pipeline feeding it), not a separate script with a file hand-off. |
| **S3.3** S3.1 + S2.1 → pick 1 case per adviser | Per-adviser sampling | `TopNPerGroup(key="adviser", by=<score>, n=1)` — this is exactly what it exists for. |
| **S3.4** merge S3.2 + S3.3, overwrite S3.3 output | Merge | Disappears. S3.2/S3.3 become processors in one Selection run; "merge then overwrite a file" is an artefact of the file-passing architecture, not real logic. |
| **S3.5** apply ~150 ordered combinatory flags → upload | Flag derivation + delivery | **Deliverable Pipeline**: an ordered flag-rule processor over the SelectionPool, then a platform-upload `Writer`. (Per ADR/CONTEXT this is a *second* pipeline reading the SelectionPool gold, not a second write in the same run.) |

**Net effect:** 8 scripts and ~4 intermediate CSV/XLSX hand-off files → ~4
Pipelines with no internal file passing. Every "read the previous script's
output file" arrow becomes either a processor step in the same run or a
`SqliteReader`/`CasePool` read of a medallion layer.

---

## What the framework already gives you (directly addresses your pain list)

These are **built today** (verified in `framework/`), not roadmap:

- **Type drift across scripts** (`str` here, `int` there, `float` elsewhere) →
  `Schema` (a dataclass), `SchemaValidator`, and `SchemaCoercion` give *one*
  declared column+dtype contract enforced at the silver boundary, with one
  controlled place for date/bool repair. This is the headline fix for your
  number-one issue.
- **No validation anywhere** → `ColumnValidator`, `RowCountValidator`,
  `UniqueValidator`, the `VolumeAnomalyValidator` (catches the *truncated-file*
  case where every row is valid but thousands are missing — relevant since your
  source is a daily partial export), and value-level rules `Pattern` / `Length` /
  `Unique` / `OneOf` via `Annotated` on the schema.
- **Unhandled exceptions / partial writes** → `.run()` is **fail-fast and
  atomic**: an error-severity validator aborts *before* the Writer is called, so
  nothing partial lands. `warn` severity is the explicit escape hatch for
  known-tolerable conditions.
- **Fragile deep nesting** → business rules are **plain-Python row callables**
  (`Filter`, `Score`) composed as a flat, named, individually testable list of
  processors, instead of nested loops/conditions.
- **"Unnecessary processing" / too many scripts** → the deferred builder + the
  collapse above remove the intermediate files and the re-reads.
- **Scripts share logic but apply differently** → shared processors/`RiskRuleSet`
  defined once, parameterised per Case Type/Variation.
- **Risk rules accumulating points** → `Score` (a row callable returning points)
  composed once per rule; multiple `Score` steps accumulate naturally.
- **Per-adviser "1 case"** → `TopNPerGroup(..., n=1)`.
- **"Why was this adviser/case (not) selected?"** → the **selection trace** via
  `.explain(writer, id_column=…)` — a per-Case audit that is a near-perfect match
  for management-facing selection questions.
- **Cross-system joins (user-ID map, hierarchy, platform sync)** → `JoinWith`
  (lazy cross-feed join, resolved in Python) against **Reference Data** subjects,
  each with its own medallion.
- **"Latest state of all cases" from partial daily files** → deterministic
  `case_id` via `DeriveKey` (`uuid5` over a natural key) + `LatestPerKey` reduces
  accumulated history to current-only gold. Both are **built** (`processors.py`).
  This is exactly the history-upstream / current-gold Ingest profile your S1.1
  needs, and it is the right model for "Monday brings Fri/Sat/Sun files."
- **Run traceability + downstream freshness** → `RunLog` → `RunRegistry`, and
  `FreshnessRequirement` so Selection refuses to run on stale Ingest.

> Note vs the prior `codex` report: it lists `LatestPerKey`, deterministic
> `case_id`, and value-level rules as "decided, not yet built." They **are**
> built now (`framework/processors.py`, `framework/schema.py`). What remains
> not-built is the *per-feed load-strategy plumbing wiring* and reader column
> projection on the wide feed — see gaps below.

---

## The genuine gaps (what you'd have to add)

### 1. A custom CSV reader for the 661-column, malformed source — **MUST BUILD**
The shipped `CsvReader` is `pandas.read_csv` behind the seam. You explicitly say
pandas and stdlib CSV both *misread* this file and you parse character-by-character.
The fix is clean: a new adapter (e.g. `ExternalCasesCsvReader`) implementing the
same `Reader` port (`read() -> Dataset`), wrapping your existing char-by-char
parser and returning a `Dataset.from_pandas(...)`. **Low framework risk, isolated
to one class.** Pair it with reader-side **column projection** (read only the ~few
columns you need out of 661) — the docs flag `columns=[...]` on readers as
*decided-not-yet-built*, so for a custom reader you'd implement the projection
yourself (cheap: just don't emit the columns you don't want).

### 2. File discovery / multi-file daily batches — **MUST BUILD**
A `Reader` reads *one* source. Your S1.1/S2.1 "scan a network directory for newly
arrived files (1–3 of them on a Monday), in date order, skipping already-landed
ones." Nothing in the framework does file discovery. Options:
- A small **ingest handler** (a `PipelineRunner` handler) that globs the
  directory by date pattern, checks landed state against the run registry / a
  landed-files table, and drives **one builder run per file** in order; or
- A `DirectoryReader` that concatenates matching files into one `Dataset`,
  stamping a `source_file` / `source_date` column.

Given the append-only, idempotent, per-day-snapshot nature, the **handler driving
one run per file** is the cleaner fit — it keeps each run's blast radius to one
file and makes re-runs idempotent per logical day. Stamp source-file/date metadata
either way so the `LatestPerKey` reduction and any backfill stay deterministic.

### 3. Outbound Writers — **MUST BUILD**
Today's writers are **SQLite-only** (`SqliteTruncateReloadWriter`,
`AccumulateByRunWriter`, `QuarantineWriter`). Verified in `framework/writers.py`.
There is **no Excel writer, no CSV writer, and no platform-upload writer**, even
though `ExcelReader` exists and `CONTEXT.md` describes a SharePoint-list push as
*the* canonical Selection Deliverable. You will need, behind `Writer.write(dataset)`:
- an `ExcelWriter` / `CsvWriter` for any file Deliverables you keep;
- a **platform-upload Writer** for S3.5's upload (the SharePoint-list / platform
  push). This is the outbound dual of the **stubbed** `SharePointReader` — expect
  to build the real client behind a `framework.remote` seam, not just the writer.

Caveat: the upload is an *active write to a system you don't own*. Treat
idempotency/retry/partial-failure explicitly — `.run()`'s atomicity guarantee is
about the local SQLite transaction, **not** about a remote upload.

### 4. Rule organisation for ~150 ordered combinatory flags — **DESIGN, then build**
Each flag is trivial (`X == Y`), but they must run **in order** because later
flags depend on earlier results (`if A and B and C then …`). Do **not** render
this as 150 inline lambdas — that recreates the fragility you're escaping. Build a
named, ordered, testable rule abstraction, e.g. a `FlagRuleSet` processor:
each rule is `(name, predicate_over_row_including_prior_flags)`; the processor
applies them in declared order, writing each flag column, so later rules can read
earlier ones. Make the order explicit and the set introspectable. The same shape
serves the **risk rules** in S2.1 (a `RiskRuleSet` of named scorers accumulating
points). This is the second-biggest piece of work after the CSV reader, and it's
mostly *yours* — the framework gives you the `Processor` seam to hang it on, but
not the rule registry itself.

### 5. Required / nullability rules — **SMALL GAP**
`schema.py` ships `Pattern`/`Length`/`Unique`/`OneOf` but **no `Required` /
non-null rule**. For this pipeline (partial daily files, joins on keys) "this
column must be present and non-null" will matter. A `Required`/`NotNull` value
rule of the same `Annotated` shape is a small, clean addition.

### 6. Quarantine-vs-abort policy — **DECISION, partly built**
A `QuarantineWriter` exists, so routing bad rows aside (keep the good ones) is
supported. You must *decide per check* which failures are fatal (`severity=error`,
abort the run) vs row-level rejects (quarantine + continue). Your current scripts
fail by unhandled exception; the migration's value is making this an explicit,
per-validator choice.

---

## Design corrections worth making during the port (not just lift-and-shift)

1. **Kill the legacy `pool.db` shape as the core model.** It's a dead system's
   format that two upstream scripts already bend over backwards to emulate. The
   canonical model is the `Case` schema. If a consumer still needs the old shape,
   emit it as a *temporary compatibility Deliverable* off gold — don't let it be
   the spine.
2. **Stop passing files between stages.** Eliminate the Excel→Excel→Excel /
   Excel→CSV hand-offs entirely — they are an artifact of the script-boundary
   architecture, not a requirement. Full treatment in *Eliminating the
   intermediate hand-offs* below.
3. **Make each daily file's landing idempotent** keyed on `case_id` + source
   date, so a re-run or a re-sent file is safe — replacing today's append-only-DB
   fragility.
4. **Separate the four reference inputs into their own Reference Data subjects**
   (user-ID map, adviser hierarchy, platform sync, the S3.2 "separate feed"),
   each its own medallion, read-only to Case Types, joined in Python. This is the
   framework's prescribed pattern and it isolates blast radius.
5. **Put "available for selection" in the CasePool, not in SQL.** Your S2.1 ends
   with a SQL availability query into an XLSX; the framework computes eligibility
   in Python via `fetch_available_cases(...)` + `WorkingDayCalendar`. The
   "12-month active / month-with-a-sale / pro-rata" maths is a domain helper, not
   buried in a query string.

---

## Eliminating the intermediate hand-offs (the Excel→Excel→Excel chain)

**Goal: remove every intermediate Excel/CSV file entirely.** These hand-offs
exist only because each script is a standalone process communicating with the
next through the filesystem. Nothing about the *work* needs a file to sit between
the steps. The framework replaces them two ways, both strictly better than a
loose workbook:

- **Within a Pipeline → no file at all.** A `Dataset` flows in memory from one
  processor to the next; `DatasetReader` feeds it straight into the builder with
  no SQL or file round-trip.
- **Across Pipelines → a gold table read.** A genuine boundary reads the upstream
  **gold** layer via `SqliteReader` / `CasePool` — typed, validated, queryable,
  idempotent, and traceable, none of which a loose XLSX is.

### Where each current file goes

| Current file | Fate |
|---|---|
| S1.1 "latest state of ALL cases" XLSX | **Deleted.** Ingest gold *is* the current state (`LatestPerKey` by `case_id`), read through the **CasePool**. |
| S1.2 remapped CSV | **Deleted.** Becomes `Rename`/`SelectColumns` + a `JoinWith` against the user-ID-map Reference Data, in-memory inside the Ingest run. |
| S2.1 dated **"selection pool" XLSX** | **Deleted — replaced by the Ingest (CasePool) gold layer.** Despite the name this file is the pool of *available candidate* cases, i.e. the framework **CasePool** read from Ingest gold — **not** the framework's `SelectionPool` (the chosen subset). It is consumed only downstream within this pipeline, so it becomes a gold read, not a Deliverable. (See the terminology note below.) |
| S3.1 adviser-requirements XLSX | **Deleted.** In-memory step of the Selection run (the requirements maths). |
| S3.2 extra-case-type XLSX | **Deleted.** In-memory `JoinWith`/processor step of the Selection run. |
| S3.3 one-per-adviser XLSX | **Deleted.** `TopNPerGroup(n=1)` step of the Selection run. |
| S3.4 "merge S3.2+S3.3, overwrite S3.3" XLSX | **Deleted entirely.** "Merge two files then overwrite a third" is pure file-passing ceremony — it's just two processor steps in one run. |
| S3.5 input XLSX → upload | The **input** file is deleted (reads the SelectionPool gold); the **upload** stays as a genuine outbound **Deliverable** (needs the platform-upload Writer from gap #3). |

Net: every intermediate workbook disappears. The only outputs that survive are
**genuine outbound Deliverables** — the platform upload, plus any file an
*external* consumer truly depends on.

### Terminology trap worth flagging

Your "selection pool" XLSX ≠ the framework's **SelectionPool**. Yours is the
*candidate* pool (available cases) = the framework **CasePool**, now the Ingest
**gold** layer. The framework's **SelectionPool** is the *chosen* subset that the
Selection Pipeline produces into its own gold + selection trace. Keeping these
two straight avoids mapping the wrong file to the wrong layer.

### Before deleting any file, confirm it isn't doing a second job

Three jobs hide inside "pass data to the next script." Two are safe to drop; one
must be *replaced*, not removed:

1. **Audit / debug artifact** (someone opens it to see what happened) — safe to
   drop. `RunLog`/`RunRegistry` + the selection trace + queryable gold cover this
   better.
2. **External consumer** (a team or system outside these 8 scripts reads it) —
   keep as a real **Deliverable**, emitted once from gold at the edge, not as a
   chain link. *Resolved for the selection-pool XLSX (→ gold); confirm it for any
   other file.*
3. **Human-in-the-loop edit gate** (someone manually edits a file before the next
   stage consumes it) — the one that bites, because it's invisible in a code
   read. **Confirmed not happening anywhere in the chain (2026-06-08)**, so no
   intervention point needs modelling — every intermediate file is safe to delete
   outright.

**Settled:** with the human-edit-gate ruled out and the selection-pool XLSX going
to gold, the file chain is eliminated **end-to-end**. The only surviving output
is the **platform upload** (genuine outbound Deliverable, needs the upload Writer
from gap #3) — unless a file is later found to feed an external consumer.

---

## Open questions to resolve before building

- **Natural key for `case_id`.** What stable field(s) in the 661-column source
  uniquely identify a case across daily files? `DeriveKey` needs this; without a
  stable natural key the whole current-state reduction is shaky. (A persistent
  identity map is the documented fallback, but confirm the key first.)
- **"status == 5" semantics.** Is this an ingest-time filter (only status-5 cases
  become Cases) or a selection-availability criterion? It changes whether it's a
  silver `Filter` or a CasePool retrieval predicate.
- **Risk-score determinism & history.** Should accumulated points be recomputed
  each run from current data, or frozen at selection time for audit? This decides
  whether scoring lives in Ingest gold or is stamped at Selection.
- **Platform upload contract.** Is the target a SharePoint SE list (matches
  CONTEXT) or something else? Idempotency on re-upload? Partial-batch failure
  behaviour? This sizes gap #3's hardest part.
- **Flag ordering source of truth.** Where does the canonical order of the ~150
  flags live today, and how often does it change? That decides how
  declarative/data-driven the `FlagRuleSet` must be.

---

## Suggested migration path (vertical slices, output-first)

Cut by domain output, **not** by existing script, and tracer-bullet each slice
end-to-end:

1. **Custom CSV reader + directory discovery**, landing daily modified-case files
   append-only to raw with source metadata. (Proves the hardest I/O early.)
2. **Canonical `Case` schema + `case_id`**; raw → silver (coerce + validate) →
   current gold via `LatestPerKey`. Now gold replaces S1.1's all-cases XLSX.
3. **Reference Data subjects**: user-ID map, hierarchy, platform sync, extra feed.
4. **Risk rules** as a named, tested `RiskRuleSet` scoring into gold (replaces the
   risk part of S2.1; drop the legacy remap).
5. **CasePool availability** (`fetch_available_cases`) — replaces S2.1's SQL
   availability export.
6. **Selection Pipeline**: requirement maths (S3.1) + extra-case-type tag (S3.2) +
   `TopNPerGroup` one-per-adviser (S3.3) + merge (S3.4) as *one* run, writing the
   SelectionPool gold **and** a selection trace.
7. **Deliverable Pipeline**: `FlagRuleSet` over the SelectionPool gold → outbound
   Writer (file and/or platform upload). (S3.5.)
8. **Retire** intermediate XLSX/CSV hand-offs and the legacy `pool.db` shape once
   each new output is verified equal to the old (run old + new in parallel,
   diff the Deliverables, then cut over).

Build the new outputs alongside the old and diff before retiring anything —
that's how you remove the fragility without betting the cutover on it.

---

## Bottom line

The framework is **directionally well-aligned** with this pipeline — most of your
listed pain (type drift, no validation, unhandled exceptions, nested fragility,
too many scripts, dead-format coercion) is something it was designed to remove.
The build effort concentrates in four places: the **custom CSV reader**, **file
discovery**, **outbound/upload writers**, and a **named ordered rule abstraction**
for risk points and platform flags. The biggest *risk* isn't the framework — it's
faithfully re-deriving the business rules buried in the 2K-line script, and the
discipline to refuse a script-by-script lift that would carry the legacy shape
(and its fragility) into the new core.
