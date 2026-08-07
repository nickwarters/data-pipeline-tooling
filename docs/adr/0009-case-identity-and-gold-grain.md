---
status: accepted
---

# Case identity and the gold grain: deterministic keys, one row per Case, Detail Tables for the rest

An **Ingest** feed is refined into a **current-state gold** whose grain
is **one row per Case**. A Case's identity is a **deterministic surrogate** — a `sha256`
hex digest over a canonical encoding of the Case Type's name (the namespace) and
the feed's stable natural-key columns. Data that does not fit the one-row-per-Case grain (repeated
sections such as product 1..10, or child collections) is split off into **Detail
Tables**, keyed back to the Case by the same deterministic `case_id`. A wide feed
is fanned into its Case table and its Detail Tables by **N independent
single-table pipelines over the shared raw table** — each projecting only the
columns it needs — not by a multi-output node or a splitting transform.

## Why

- **Deterministic identity preserves idempotency.** A random `uuid4` would break
  delete-by-logical-run-then-insert: a re-run would mint *different*
  ids, so a re-driven run is no longer identical and a Case cannot be tracked
  across runs. The digest is a pure function of the input — the same Case yields
  the same id on every run and machine (pure stdlib, identical on
  Windows/macOS). Because the derivation is deterministic, the Case
  pipeline and each Detail pipeline compute the *same* `case_id` independently from
  the shared natural key, so the parent/child link needs **no** cross-pipeline
  join.
- **One-row-per-Case gold is the clean consumption contract.** Selection, the
  review-platform Deliverable, and Reporting all want an unambiguous *current* Case
  — not a multi-version history to dedup on read. The grain is enforced at the gold
  boundary: a `LatestPerKey(case_id, by=load_date)` reduction collapses accumulated
  silver history to current, and a `UniqueValidator` on `case_id` aborts
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
  mirror of the DAG's fan-*in* join.

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
  the `natural_key` is a declared field and the Case Type's `name` is the
  namespace. The Case builder and each Detail builder take the *same* `CaseType`,
  so the "same namespace + key" invariant the parent/child link depends on is
  **structural**, not two call sites kept in step by a comment.
- The key columns are hashed **by name**, in a canonical JSON payload, not
  joined into one string. A joined key is forgeable: `("SMITH",
  "2024-01-15|EXTRA")` and `("SMITH|2024-01-15", "EXTRA")` produce the same
  `"|"`-joined string, so two distinct Cases would share one `case_id`. A
  consequence worth stating: the *order* `natural_key` is declared in no longer
  changes the key, only *which* columns are in it — which removes a way for a
  Case builder and a Detail builder to drift apart.
- **A row with a null natural-key value is refused**, not keyed. There is no
  honest identity for a row that does not carry the values it is identified by,
  and the alternative is worse than a failure: `None`, `<NA>` and `nan`
  stringify differently, so a missing value would mint a plausible key that
  changes with the column's dtype.
- Each key column is rendered **from the column**, not by reading values out of
  a row, and a whole number renders the same however pandas is carrying it
  (`123` and `123.0` agree). Both matter because a derived key must not depend
  on a dtype: reading a row upcasts the key in an all-numeric frame, and an
  integer column becomes `float64` the moment any value in it is null — either
  would re-key a Case for a reason that has nothing to do with its identity.
- The derivation was `uuid5(uuid5(NAMESPACE_DNS, name), "|".join(values))` until
  the forgeable join was closed. `uuid5` is itself a namespaced SHA-1 hash, so
  the change is a stronger digest and an unforgeable encoding, not the
  introduction of hashing. The encoding is now a **live on-disk format**:
  changing the separators, the payload shape or the digest re-keys history.
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
