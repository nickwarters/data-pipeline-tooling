---
status: accepted
---

# Graduated schema enforcement: raw light, silver & gold validated

A Case Type's **schema** is a declared statement of its expected columns, types,
and field-level content rules — a dataclass whose annotations *are* the contract
(dataclass → Pydantic later is a seam, ADR-0011). Enforcement is **graduated** by
layer:

- **Raw — schema-light.** Land what the (snapshot) source gives. Raw carries two
  column checks with opposite severities: a **hard presence check**
  (`ColumnValidator`, error) that the named columns downstream depends on are
  present, and a **soft drift check** (`SchemaDriftValidator`, warn) that diffs
  the incoming column set against the prior run's landed columns and surfaces
  added/dropped columns without stopping the run.
- **Silver & gold — validated.** A fail-fast `SchemaValidator`, derived from the
  Case Type's annotations, checks columns and dtypes before downstream logic
  touches the data.

The schema is a **validation contract first**; materializing typed objects
(`Iterator[CaseA]`) is an opt-in convenience, not required by declaring it.

## The content contract — value rules and row checks

Beyond columns and dtypes, a schema declares two axes of content rule, both
feeding the same two consumers (abort, collected into one `SchemaValidator`
message; or quarantine, as a `failed_rule` reason — ADR-0007):

- A **value rule** is *vertical* — one column across many rows (format/`Pattern`,
  `Length`, `Range`, membership/`OneOf`, `Unique`, `NonNull`/`Nullable`) —
  declared on the field via `Annotated`.
- A **row check** is *horizontal* — one row across many fields, validating the
  relationship *between* fields (`opened <= closed`). A plain function over a row
  returning a breach phrase or `None`, paired with the **footprint** of columns it
  spans (so a column already failing its dtype check suppresses the check rather
  than crashing it); declared via the `@row_checks(...)` class decorator. A row
  check runs over **every** row including nulls — presence may be the very thing
  it tests — so the author handles nulls explicitly.

## Why

Without a declared schema, expectations scatter as "assume field X exists, do Y,"
producing two bad failure modes: instant errors by luck of access order, and
(worse) silent propagation that explodes mid-processing far from the cause. A
declared schema validated at the boundary collapses the scattered checks into one
statement and moves failure to a **predictable place with a precise message**
(which column/type/rule), before processing runs on bad data.

**Why drift warns and a breach aborts.** Raw must stay a faithful mirror of an
owner-controlled source (a SharePoint list, a SAS export); turning every
column add/drop into an abort would make raw refuse to land faithful data. Drift
is a *change* signal caught at the door, one layer before it would otherwise
surface as a silver **Schema Breach** far from its cause — so it warns. The hard
*contract* lives at silver/gold, where a missing column or wrong dtype is a
fail-fast abort. Drift is names-only and run-over-run, so a persistent drift
warns once, not every run.

## Consequences

- Each Case Type declares its silver/gold shape once; `SchemaValidator` is derived
  from it, and that dataclass → validator adapter is the dataclass → Pydantic seam.
- Combined with ADR-0005, a schema breach aborts the run atomically with a located
  error — no silent wrong output. Raw remains a faithful mirror of the snapshot;
  shape hardening is silver's job.
- **The schema/value validators are engine-confined.** Structural validators
  (`ColumnValidator` / `RowCountValidator`) read only the engine-agnostic shape
  (`columns` / `len`). A schema check inspects dtypes, and value rules need the
  engine's vectorised operations over actual values, so `SchemaValidator` reaches
  the backing frame via `to_pandas()` exactly like a Reader/Writer/transform does
  (ADR-0002) — keeping `Dataset`'s public surface tiny. The Python-type ↔
  pandas-dtype mapping lives in one place so the rest of the system names only
  Python types, and an unmappable declared type fails where the validator is
  built, not mid-run.
- **Coercion is a separate, earlier step.** Types that do not survive a SQLite
  round-trip (dates, booleans) need a `SchemaCoercion` transform ahead of the
  silver validator; it slots in as a node before the validator without reshaping
  it.
- A truncated source export — every row valid, yet thousands missing — is invisible
  per-row; the `VolumeAnomalyValidator` catches it run-over-run by comparing a
  run's row count against a baseline derived from the feed's recent run history.
</content>
