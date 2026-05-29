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
