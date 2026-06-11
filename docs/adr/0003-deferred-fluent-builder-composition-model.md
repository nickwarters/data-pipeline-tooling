---
status: accepted
---

# Deferred fluent-builder composition model, one builder per layer transition

Pipelines are described with a **deferred (lazy) fluent builder**: callers chain typed component-adders (`.with_validator()`, `.with_processor()`, `.with_post_validator()`, …) and nothing executes until `.run()` (or `.to(layer)` / `.checkpoint(layer)`). Components (Readers, Processors, Validators, Writers) are reusable, role-typed, parameter-constructed objects. A builder spans **one medallion layer transition** (source→raw ingest, raw→silver, silver→gold selection); each layer's output is persisted and reusable as another builder's input through an explicit read-only dependency. **Cross-feed joins are processors that consume a `JoinDependency`, `Reader`, or materialized `Dataset`** (`JoinWith(reference, on=...)`), so upstream execution is controlled outside the processor.

## Why

- **Config later, for free.** A deferred builder *is* a spec; a future YAML/declarative loader makes the same `.with_*()` calls or builds the same object. Builder and config become two front-ends to one representation — no rewrite.
- **Type safety preserved.** Role-specific adder methods keep static typing while composition stays uniform.
- **Cross-cutting concerns centralised.** Because `.run()` owns execution, timing, logging, lineage, and error handling wrap every stage uniformly.
- **Joins fit naturally.** Explicit read dependencies let multi-input selection keep a linear-looking fluent surface while runner/catalog code owns upstream execution, caching, and freshness.

## Considered options

- **Uniform flat Step list:** trivial config-later but fights multi-input joins and loses static typing in the bulk tier.
- **Role-specific Protocols, hand-wired in plain Python:** typed and join-friendly but composition is bespoke per script and cross-cutting concerns aren't centralised.
- **Uniform Step + DAG engine up front:** powerful and fully declarative but the most machinery to build now; contradicts "start in scripts, add config later."
- **One builder spanning all layers (raw→silver→gold):** deferred — reachable later by turning `.to(layer)` into `.checkpoint(layer)` and combining builders; migration is cheap, so we start with the simpler per-transition builders.

## Consequences

- `.run()` returns the opaque tabular dataset in the bulk tier; the domain edge (CasePool) returns typed `Case` objects (see ADR-0002).
- The builder/run layer is the natural home for lineage, run metadata, and uniform error handling.
- Keeping every component parameter-constructed is a standing discipline — it's what makes the config-later path real.

## Amendment (2026-06-09): builder runs execute an internal step plan

The author-facing builder remains the same fluent API, but `.run()` now executes
one ordered internal plan of `PipelineStep` objects rather than carrying the
whole read/validate/process/checkpoint/explain/write procedure inline. Each step
has a stable name/kind/order, a wrapped component where applicable, and
read-only/side-effect metadata for future plan validation and dry-run work.

This is not an orchestration engine and not a DAG model. Pipeline scripts still
compose Readers, ordered single-dataset stages, optional governance outputs, and
one final Writer through the builder. A stage is scoped to one class-level
`Pipeline` run — current `Dataset` in, next `Dataset` out, with explicit side
effects only for checkpoint-style stages — and `.describe()` renders from the
same planned representation that `.run()` executes, so the inspected plan and
executed plan cannot drift. (The `Stage`→`Step` execution detail is refined by
the 2026-06-11 amendment below.)

## Amendment (2026-06-09): joins consume explicit read dependencies

`JoinWith` no longer accepts a pipeline-shaped `Runnable` and no longer calls
another builder's `.run()` from inside `process()`. Cross-feed joins now depend
on a `JoinDependency`, `Reader`, or already materialized `Dataset`. The
runner/catalog layer is responsible for deciding whether an upstream pipeline
must execute first; the downstream builder only reads the declared dependency
and joins it in Python.

During a builder run, each `JoinDependency` is materialized once before the
processor step and logged as `dependency:<name>`. Reusing the same dependency in
multiple joins reuses the cached `Dataset`, which keeps run logs and failure
attribution explicit instead of hiding upstream work inside a downstream
processor.

## Amendment (2026-05-29): the terminus is a Writer port, not a layer string

`.to(layer)` — a stringly-typed medallion layer name threaded through the generic builder — is replaced by **`.write_to(writer)`**, where `writer` is a **Writer**: the component-role dual of `Reader` (`Reader.read() -> Dataset` on the way in; `Writer.write(dataset)` on the way out). This removes the medallion vocabulary (and the placeholder layer names — see CONTEXT) from the core composition machinery, and is in fact *more* faithful to this ADR's own component model, which already lists Writers as a parameter-constructed role. The string form was shorthand in tension with that model.

- **The Writer owns its persistence** — both the target location (a subject's layer database + table) *and* the load strategy (truncate+reload vs accumulate-by-run — ADR-0006). The builder/terminus hands the `Dataset` to the Writer and makes **no** write decisions itself: no layer logic, no refresh-vs-accumulate branching.
- **Swapping the Writer is how you target a different database** — e.g. pointing a subject's pipeline at its own per-subject medallion file (see ADR-0001 amendment). The core never learns about the medallion; the Writer carries that knowledge.
- **The two-tier carrier holds** (ADR-0002): a bulk Writer takes a `Dataset`; a domain-typed write-side (typed `Case`s) would be a different Writer implementation of the same port, so opaque frames are never silently handed to a typed destination.
- **Layer-typed termini become writer-typed.** `.to(layer)` → `.write_to(writer)`; a future `.checkpoint(layer)` likewise carries a Writer rather than a layer string.
- **Pipelines per subject — prefer one, allow per-layer.** A subject (Case Type or Reference Data set) is normally served by a **single** pipeline spanning its layer transitions. Where circumstances warrant — e.g. a reference subject's raw load runs on a different cadence than its silver/gold processing — it **may** be split into separate per-layer pipelines (a raw pipeline, a silver pipeline, a gold pipeline), still scoped to the one subject. This is an authoring choice, not a safety rule: the single-writer-per-file invariant (ADR-0001) is unaffected because per-layer pipelines write distinct layer files.

## Amendment (2026-06-11): stages are specs, not a second execution path

The 2026-06-09 amendment introduced the internal `PipelineStep` plan *and* left a
public `Stage.apply(Dataset) -> Dataset` contract beside it. In practice every
built-in stage compiled to its `PipelineStep` and executed there (so the per-step
metadata and per-processor row-trace held), and `apply()` was never called — a
second, divergent execution path that nothing used. Custom apply-only stages were
never an adapter anyone wrote, and such a stage could not carry the per-processor
trace the built-ins rely on.

So the `Stage` model is consolidated onto the one step plan:

- A **stage is a spec**: its only contract is `to_pipeline_step() -> PipelineStep`.
  The vestigial `apply()` on the built-in stages, the unused generic stage executor,
  and the never-constructed single-processor step are removed.
- The three built-in stages (`ValidationStage`, `ProcessingStage`, `CheckpointStage`)
  remain the **public authoring vocabulary**, composed via `.add_stage(...)`. The
  `Stage` *protocol* is no longer part of the public facade (`framework.run`) — it is
  an internal shape — because there is no longer a custom-stage extension point.
- The **dataset→dataset transform extension point is the `Processor`** (the tested,
  trace-aware one), not a custom stage. This supersedes the "public `Stage`
  contract: current `Dataset` in, next `Dataset` out" note in the 2026-06-09
  amendment.
