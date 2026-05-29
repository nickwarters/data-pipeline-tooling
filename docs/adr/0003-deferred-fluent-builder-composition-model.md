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

## Amendment (2026-05-29): the terminus is a Writer port, not a layer string

`.to(layer)` — a stringly-typed medallion layer name threaded through the generic builder — is replaced by **`.write_to(writer)`**, where `writer` is a **Writer**: the component-role dual of `Reader` (`Reader.read() -> DataHandle` on the way in; `Writer.write(handle)` on the way out). This removes the medallion vocabulary (and the placeholder layer names — see CONTEXT) from the core composition machinery, and is in fact *more* faithful to this ADR's own component model, which already lists Writers as a parameter-constructed role. The string form was shorthand in tension with that model.

- **The Writer owns its persistence** — both the target location (a subject's layer database + table) *and* the load strategy (truncate+reload vs accumulate-by-run — ADR-0006). The builder/terminus hands the `DataHandle` to the Writer and makes **no** write decisions itself: no layer logic, no refresh-vs-accumulate branching.
- **Swapping the Writer is how you target a different database** — e.g. pointing a subject's pipeline at its own per-subject medallion file (see ADR-0001 amendment). The core never learns about the medallion; the Writer carries that knowledge.
- **The two-tier carrier holds** (ADR-0002): a bulk Writer takes a `DataHandle`; a domain-typed write-side (typed `Case`s) would be a different Writer implementation of the same port, so opaque frames are never silently handed to a typed destination.
- **Layer-typed termini become writer-typed.** `.to(layer)` → `.write_to(writer)`; a future `.checkpoint(layer)` likewise carries a Writer rather than a layer string.
- **Pipelines per subject — prefer one, allow per-layer.** A subject (Case Type or Reference Data set) is normally served by a **single** pipeline spanning its layer transitions. Where circumstances warrant — e.g. a reference subject's raw load runs on a different cadence than its silver/gold processing — it **may** be split into separate per-layer pipelines (a raw pipeline, a silver pipeline, a gold pipeline), still scoped to the one subject. This is an authoring choice, not a safety rule: the single-writer-per-file invariant (ADR-0001) is unaffected because per-layer pipelines write distinct layer files.
