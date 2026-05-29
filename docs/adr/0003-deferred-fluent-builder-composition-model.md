---
status: accepted
---

# Deferred fluent-builder composition model, one builder per layer transition

Pipelines are described with a **deferred (lazy) fluent builder**: callers chain typed component-adders (`.with_validator()`, `.with_processor()`, `.with_post_validator()`, …) and nothing executes until `.run()` (or `.to(layer)` / `.checkpoint(layer)`). Components (Readers, Processors, Validators, Writers) are reusable, role-typed, parameter-constructed objects. A builder spans **one medallion layer transition** (source→raw ingest, raw→silver, silver→gold selection); each layer's output is persisted and reusable as another builder's lazy input. **Cross-feed joins are processors that carry a lazy reference to another builder** (`JoinWith(feed_b, on=...)`), so `.run()` resolves a DAG without a separate DAG engine.

## Why

- **Config later, for free.** A deferred builder *is* a spec; a future YAML/declarative loader makes the same `.with_*()` calls or builds the same object. Builder and config become two front-ends to one representation — no rewrite.
- **Type safety preserved.** Role-specific adder methods keep static typing while composition stays uniform.
- **Cross-cutting concerns centralised.** Because `.run()` owns execution, timing, logging, lineage, and error handling wrap every stage uniformly.
- **Joins fit naturally.** Lazy references let multi-input selection form a DAG behind a linear-looking fluent surface — matching the join-heavy Selection workload without a flat-step side-channel.

## Considered options

- **Uniform flat Step list:** trivial config-later but fights multi-input joins and loses static typing in the bulk tier.
- **Role-specific Protocols, hand-wired in plain Python:** typed and join-friendly but composition is bespoke per script and cross-cutting concerns aren't centralised.
- **Uniform Step + DAG engine up front:** powerful and fully declarative but the most machinery to build now; contradicts "start in scripts, add config later."
- **One builder spanning all layers (raw→silver→gold):** deferred — reachable later by turning `.to(layer)` into `.checkpoint(layer)` and combining builders; migration is cheap, so we start with the simpler per-transition builders.

## Consequences

- `.run()` returns the opaque tabular handle in the bulk tier; the domain edge (CasePool) returns typed `Case` objects (see ADR-0002).
- The builder/run layer is the natural home for lineage, run metadata, and uniform error handling.
- Keeping every component parameter-constructed is a standing discipline — it's what makes the config-later path real.
