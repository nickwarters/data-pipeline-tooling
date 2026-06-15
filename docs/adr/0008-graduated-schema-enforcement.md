---
status: accepted
---

# Graduated schema enforcement: raw light, silver & gold validated

A Case Type's **schema** is a declared statement of its expected columns + types — initially a dataclass whose annotations *are* the contract (dataclass→Pydantic later, ADR-0005). Enforcement is **graduated**:

- **Raw — schema-light.** Land what the (snapshot) source gives; at most a single column check so an unexpected source change fails loudly.
- **Silver & gold — validated.** A fail-fast `SchemaValidator`, derived from the Case Type's dataclass annotations, runs at these boundaries (post-validator), checking columns and dtypes before downstream logic touches the data.

The schema is a **validation contract first**; materializing typed objects (`Iterator[CaseA]`) is an opt-in convenience, not required by declaring the schema.

## Why

Today the schema is *implicit* — expectations are scattered as "assume field X exists, do Y," with only occasional existence checks. That produces two bad failure modes: instant errors by luck of access order, and (worse) silent propagation that explodes mid-processing far from the cause. A declared schema validated at the boundary collapses the scattered checks into one statement and moves failure to a **predictable place with a precise message** (which column/type), before processing runs on bad data. Enforcing at silver/gold (not raw) catches problems one layer before Selection while leaving the landing zone faithful to the source.

## Consequences

- Each Case Type declares its silver/gold shape once; `SchemaValidator` is derived from it (the dataclass→validator adapter is the dataclass→Pydantic seam).
- Combined with ADR-0007, a schema breach aborts the run atomically with a located error — no silent wrong output.
- Raw remains a faithful mirror of the source snapshot; shape hardening is a silver-stage responsibility.
- **The schema/value validators are engine-confined.** The structural validators (ADR-0002, `ColumnValidator` / `RowCountValidator`) read only the dataset's engine-agnostic shape (`columns` / `len`). A schema check, by contrast, inspects column *dtypes*, and the value-level checks this schema will grow into (format/pattern, length, uniqueness, encoding) need the engine's vectorised operations over actual values. Exposing all of that engine-agnostically through `Dataset` would re-implement a dataframe API on the seam. So `SchemaValidator` reaches the backing frame via `to_pandas()` exactly like a Reader/Writer/processor does — it *is* engine-confined code — keeping `Dataset`'s public surface tiny. The Python-type ↔ pandas-dtype mapping lives in one place (`framework.transform.schema`), so the rest of the system still names only Python types.
- **The declared types are Python types resolved through the schema's module.** Because the framework uses `from __future__ import annotations`, a dataclass field's `.type` is a *string*; the adapter resolves it with `typing.get_type_hints` and rejects an unmappable type when the validator is built, so a mis-declared schema fails where it is composed, not mid-run.
- **Coercion is a separate, later responsibility.** With no processor between raw and silver, silver dtypes are whatever the raw→silver read yields; types that do not survive a SQLite round-trip (dates, booleans) need a coercion processor before the silver post-validator can assert them. That processor slots in ahead of the validator without reshaping it.

## Amendment 01 — raw has two column checks: a hard presence check and a soft drift check (#51)

The body above frames raw as having "at most a single column check so an unexpected source change fails loudly." That is now only half the story. Raw carries **two distinct** column checks with **opposite severities**:

- A **hard presence check** (`ColumnValidator`, error severity): the named columns downstream depends on must be present, or the run aborts. This is the "fails loudly" check above.
- A **soft drift check** (`SchemaDriftValidator`, warn severity — #51): the incoming column set is diffed against the **prior run's landed columns** (read from the live raw table via `PRAGMA`, since raw is truncate+reload — ADR-0006), and added/dropped columns are surfaced as a **warning that does not stop the run**.

**Why warn, not error, for drift.** Raw must stay a faithful mirror of whatever the owner-controlled source (SharePoint list, SAS export) gives — turning every column add/drop into an abort would make raw refuse to land faithful data, contradicting this ADR's thesis that shape *hardening* is silver's job. Drift is a *change* signal, not a *contract* violation: it catches upstream change **at the door**, one layer before it would otherwise surface as a silver **Schema Breach** far from its cause. The hard contract still lives at silver/gold.

Drift is **names-only** (a dtype change on a surviving column stays a silver concern) and **run-over-run against the last landing**, so a persistent drift warns **once**, not every run. Because severity and RunLog recording are owned by the builder (ADR-0007), the warning rides the existing `warn_hits` path onto the run summary, where the run registry's `runs_that_warned()` already surfaces it — no new observability plumbing.
