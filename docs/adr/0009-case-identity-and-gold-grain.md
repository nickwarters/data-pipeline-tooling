---
status: accepted
---

# Case identity and the gold grain: deterministic keys, one row per Case, Detail Tables for the rest

An **Ingest** feed is refined into a **current-state gold** (ADR-0006 amendment)
whose grain is **one row per Case**. A Case's identity is a **deterministic
surrogate** — `case_id = uuid5(case_type_namespace, natural_key)` — derived from
the feed's stable natural key. Data that does not fit the one-row-per-Case grain
(repeated sections such as product 1..10, or child collections) is split off
into **Detail Tables** (see CONTEXT.md), keyed back to the Case by the same
deterministic `case_id`. A wide feed is fanned into its Case table and its
Detail Tables by **N independent single-table pipelines over the shared raw
table** (each projecting only the columns it needs) — not by a multi-Writer
terminus and not by a splitting Processor.

## Why

- **Deterministic identity preserves idempotency.** A random `uuid4` would break
  ADR-0006's delete-by-run-then-insert: a re-run would mint *different* ids, so a
  re-driven run is no longer identical and a Case cannot be tracked across runs.
  `uuid5(namespace, natural_key)` is a pure function of the input — the same Case
  yields the same id on every run and every machine (pure stdlib, identical on
  Windows/macOS). Because the derivation is deterministic, the Case pipeline and
  each Detail pipeline compute the *same* `case_id` independently from the shared
  natural key, so the parent/child link needs **no** cross-pipeline join.
- **One-row-per-Case gold is the clean consumption contract.** Selection, the
  review-platform Deliverable, and Reporting all want an unambiguous *current*
  Case — not a multi-version history they must dedup on read. The grain is
  enforced at the gold boundary: a `LatestPerKey(case_id, by=load_date)`
  reduction collapses accumulated silver history to current, and a uniqueness
  validator on `case_id` (extending ADR-0008 schema enforcement — the #24
  uniqueness rule) aborts the run if the grain is ever breached.
- **Detail Tables keep the Case grain intact.** Repeated or child-collection data
  (products, fees, parties) cannot sit one-row-per-Case without either widening
  the Case unmanageably or duplicating every top-level field across rows. A
  Detail Table holds those lines at their own finer grain and is rolled up to the
  Case downstream by `case_id`.
- **Fan-out by composition, not a new seam.** N single-table pipelines reuse every
  guarantee a single feed already has — per-table schema, validators, an atomic
  write, one RunLog line — and touch **no** core seam. The thin cross-cutting
  normalisation is one reusable `Processor` instance attached to each pipeline;
  column projection keeps each pipeline narrow over a 650-column feed.

## Considered options

- **Random `uuid4` identity** — simplest, but non-deterministic, so it breaks
  idempotency and makes the Case unjoinable across runs. Rejected.
- **Natural key as the only identity** — works, but leaks source-specific key
  shapes into Deliverables/Reporting and offers no uniform opaque handle across
  heterogeneous feeds. The deterministic surrogate keeps the natural key as its
  *seed* while presenting one uniform id.
- **Persistent identity map (an assigned-id registry)** — required only if a feed
  has *no* stable natural key; stateful, with its own single-writer / idempotency
  burden. Deferred until a feed needs it.
- **One pipeline, multiple Writers (fan-out terminus)** and **a splitting
  Processor emitting N datasets** — both break the load-bearing seams
  (`.write_to` takes one Writer; `process()` / `.run()` return one Dataset) and
  still need N Writers at the end. Rejected in favour of N composed single-table
  pipelines — the fan-**out** mirror of the lazy-builder DAG ADR-0003 already uses
  for `JoinWith` fan-**in**.
- **A materialised conform boundary for the shared prefix** — considered for the
  case where the shared processing is heavy; unnecessary while that seam is thin
  (a reusable normalisation `Processor` suffices). Held in reserve if it fattens.

## Consequences

- `case_id` propagates everywhere downstream — Detail-Table foreign keys, the
  SelectionPool, Deliverables, Reporting joins. Its derivation (the namespace and
  the chosen natural-key columns) is therefore a **stable contract**: changing it
  re-keys all history.
- The identity contract is **owned by the `CaseType`** (`case_review.case_type`):
  the `natural_key` is a declared field and the `namespace` is a property *derived
  from the Case Type's `name`* — `uuid5(NAMESPACE_DNS, name)`. The Case builder
  (`ingest_silver_to_gold`) and each Detail builder (`detail_ingest_silver_to_gold`)
  take the *same* `CaseType`, so the "same namespace + key" invariant the
  parent/child link depends on is **structural**, not two call sites kept in step
  by a comment.
- **Known shortfall (accepted):** because the namespace derives from `name`,
  **renaming a Case Type silently re-keys all its history.** This is rare
  (observed once or twice in six years) and we deliberately do *not* engineer a
  pinned-namespace escape hatch for it — the run-to-run determinism that idempotency
  actually needs is unaffected (the key is a pure function of fixed inputs). A
  rename is a conscious "re-key everything" act; treat the `name` as part of the
  stable contract.
- The current-gold reduction (`LatestPerKey`) and the uniqueness grain validator
  are **new components to build**, both plain Python over the `Dataset` seam
  (ADR-0002). The per-table reshape for a Detail Table (e.g. the wide→long unpivot
  of product 1..10) is an engine-confined `Processor`.
- A Case with no Detail rows, and a Detail line whose parent Case is absent, are
  both possible mid-build; referential expectations between a Case and its Detail
  Tables are **read-side** concerns (Python), not enforced by the store.
- Each feed must declare its natural key; a feed without one falls back to the
  deferred persistent-identity-map option.

## Amendment (2026-06-23): fan-out is a multi-write DAG, not N single-table pipelines

The fan-out decision above — "a wide feed is fanned into its Case table and its
Detail Tables by **N independent single-table pipelines over the shared raw
table**" — and its rejection of "one pipeline, multiple Writers (fan-out
terminus)" are **reversed**. The builder is a general DAG that already executes
**any number of writes** in one run (ADR-0003 2026-06-23 amendment), so a wide
feed is fanned out **within one DAG**: read the shared source once, normalise
once, and branch into the Case write plus each Detail-Table write. This avoids
re-reading and re-normalising the source once per output (the in-memory form of
the "materialised conform boundary" this ADR held in reserve).

What carries over unchanged:

- **Deterministic `case_id`** (`uuid5(namespace, natural_key)`) and the
  **one-row-per-Case grain** with its uniqueness validator. Determinism is what
  lets the Case branch and each Detail branch derive the *same* `case_id`
  independently — now they do so as branches of one DAG rather than as separate
  pipelines, but the structural "same namespace + key" invariant is identical.
- **Per-output schema and validators** — each write branch carries its own
  `SchemaValidator` / value rules as before; the guarantees move from "one per
  pipeline" to "one per node".

What changes:

- **The node, not the pipeline, is the unit of observability and recovery**
  (ADR-0007 2026-06-23 amendment). You author and run *few large* DAGs; each write
  branch still fails, is logged, and (via explicit `retry`) recovers
  independently — so the operational independence the N-pipelines model was bought
  for is preserved at node granularity instead of pipeline granularity.
- **Reads use named dependencies, not equal reader arguments** — a branch that
  needs another source joins it as a read-only dependency (ADR-0003), keeping a
  multi-read DAG legible.

The **persistent-identity-map / assigned-id registry** option (above, deferred)
is also the home for **Reference Data normalisation**: a reference/dimension table
loaded **insert-if-absent** with a **compact assigned integer surrogate key** is a
legitimate, append-stable identity scheme distinct from `case_id`'s `uuid5`. It is
*stateful* (the table remembers the assignment, so it is a backed-up system of
record — ADR-0006), which is acceptable precisely because reference loads are
insert-if-absent rather than accumulate-by-run, so ids are stable by construction
across re-runs. The id is **minted in Python over the dumb store** (ADR-0002),
not by a SQLite `AUTOINCREMENT`, to keep identity logic above the store seam.
Case identity stays `uuid5`; the two schemes coexist by load profile and must not
be "harmonised". Status: decided; not yet built.
