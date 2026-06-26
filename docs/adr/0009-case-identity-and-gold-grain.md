---
status: accepted
---

# Case identity and the gold grain: deterministic keys, one row per Case, Detail Tables for the rest

An **Ingest** feed is refined into a **current-state gold** (ADR-0004) whose grain
is **one row per Case**. A Case's identity is a **deterministic surrogate** —
`case_id = uuid5(case_type_namespace, natural_key)` — derived from the feed's
stable natural key. Data that does not fit the one-row-per-Case grain (repeated
sections such as product 1..10, or child collections) is split off into **Detail
Tables**, keyed back to the Case by the same deterministic `case_id`. A wide feed
is fanned into its Case table and its Detail Tables by **N independent
single-table pipelines over the shared raw table** — each projecting only the
columns it needs — not by a multi-output node or a splitting transform.

## Why

- **Deterministic identity preserves idempotency.** A random `uuid4` would break
  delete-by-logical-run-then-insert (ADR-0004): a re-run would mint *different*
  ids, so a re-driven run is no longer identical and a Case cannot be tracked
  across runs. `uuid5(namespace, natural_key)` is a pure function of the input —
  the same Case yields the same id on every run and machine (pure stdlib,
  identical on Windows/macOS). Because the derivation is deterministic, the Case
  pipeline and each Detail pipeline compute the *same* `case_id` independently from
  the shared natural key, so the parent/child link needs **no** cross-pipeline
  join.
- **One-row-per-Case gold is the clean consumption contract.** Selection, the
  review-platform Deliverable, and Reporting all want an unambiguous *current* Case
  — not a multi-version history to dedup on read. The grain is enforced at the gold
  boundary: a `LatestPerKey(case_id, by=load_date)` reduction collapses accumulated
  silver history to current, and a `UniqueValidator` on `case_id` (ADR-0006) aborts
  the run if the grain is ever breached.
- **Detail Tables keep the Case grain intact.** Repeated or child-collection data
  cannot sit one-row-per-Case without either widening the Case unmanageably or
  duplicating every top-level field across rows. A Detail Table holds those lines
  at their own finer grain and is rolled up to the Case downstream by `case_id`.
- **Fan-out by composition, not a new seam.** N single-table pipelines reuse every
  guarantee a single feed already has — per-table schema, validators, an atomic
  write, one run-log line — and touch no core seam. The thin cross-cutting
  normalisation is one reusable transform attached to each pipeline; column
  projection keeps each pipeline narrow over a 650-column feed. It is the fan-*out*
  mirror of the DAG's fan-*in* join (ADR-0003).

## Considered options

- **Random `uuid4` identity** — simplest, but non-deterministic, so it breaks
  idempotency and makes the Case unjoinable across runs. Rejected.
- **Natural key as the only identity** — works, but leaks source-specific key
  shapes into Deliverables/Reporting and offers no uniform opaque handle across
  heterogeneous feeds. The deterministic surrogate keeps the natural key as its
  *seed* while presenting one uniform id.
- **Persistent identity map (an assigned-id registry)** — needed only if a feed has
  *no* stable natural key; stateful, with its own single-writer/idempotency burden.
  Deferred until a feed needs it.
- **One pipeline, multiple output writers** and **a splitting transform emitting N
  datasets** — both reintroduce a multi-output shape the DAG deliberately avoids,
  and still need N writers at the end. Rejected in favour of N composed
  single-table pipelines.

## Consequences

- `case_id` propagates everywhere downstream — Detail-Table foreign keys, the
  SelectionPool, Deliverables, Reporting joins. Its derivation (the namespace and
  the natural-key columns) is therefore a **stable contract**: changing it re-keys
  all history.
- The identity contract is **owned by the `CaseType`** (`case_review.case_type`):
  the `natural_key` is a declared field and the `namespace` is a property derived
  from the Case Type's `name` (`uuid5(NAMESPACE_DNS, name)`). The Case builder and
  each Detail builder take the *same* `CaseType`, so the "same namespace + key"
  invariant the parent/child link depends on is **structural**, not two call sites
  kept in step by a comment.
- **Known shortfall (accepted):** because the namespace derives from `name`,
  **renaming a Case Type silently re-keys all its history.** This is rare and we
  deliberately do not engineer a pinned-namespace escape hatch — the run-to-run
  determinism idempotency needs is unaffected (the key is a pure function of fixed
  inputs). Treat the `name` as part of the stable contract.
- A Case with no Detail rows, and a Detail line whose parent Case is absent, are
  both possible mid-build; referential expectations between a Case and its Detail
  Tables are **read-side** concerns (Python), not enforced by the store.
- A feed without a stable natural key falls back to the deferred
  persistent-identity-map option.
</content>
