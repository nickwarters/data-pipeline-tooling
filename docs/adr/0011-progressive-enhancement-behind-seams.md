---
status: accepted
---

# Progressive enhancement behind stable seams

The framework ships the **simplest viable implementation now** and defers richer
ones, but always behind a **stable seam** so the later upgrade is contained rather
than a rewrite. This is a deliberate, recurring stance — stubs and stdlib choices
are staging, not gaps.

Seams already in place, each with its simple-now / rich-later pair:

- **In-memory engine:** pandas now → polars (or other) later; the concrete engine
  is confined to Readers/Writers/transforms behind the `Dataset` seam, never in a
  `Protocol`, a script, or the domain layer (ADR-0002).
- **Authoring:** Python DAG-builder scripts now → declarative config later; the
  deferred graph *is* the spec, so a config loader builds the same nodes (ADR-0003).
- **Schema/typing:** dataclasses now → Pydantic later; validation is derived from
  annotations via an adapter, so the swap is the model base + adapter only
  (ADR-0006).
- **Remote execution:** shell `ssh`/`scp` behind a `RemoteRunner` seam now → a
  library (e.g. paramiko) later; the remote SAS exec is stubbed until needed
  (ADR-0012).

## Why

- Delivers value fast on a locked-down estate (venv + pip, stdlib-first) without
  committing to heavy tooling prematurely.
- Keeps the costly choices (engine, store, config language, auth) swappable because
  nothing leaks across the seam.
- Communicates intent: a reviewer judges a component against its **seam contract**,
  not the simplicity of today's implementation behind it.

## The discipline that keeps this honest

Progressive enhancement is easy to invert into *speculative* enhancement —
building the seam **and** the rich implementation ahead of any real consumer. That
is the failure mode the framework's history records (see [`RETROSPECTIVE.md`](../../RETROSPECTIVE.md)).
So this ADR is paired with a hard rule (ADR-0013): you may **name** a future seam,
but you may not **build past it** until a second real consumer exists. The seam is
the deliverable up front; the enhancement waits for demand.

## Consequences

- Every deferral lands behind a real interface up front — the seam is the
  deliverable, even when the rich implementation isn't.
- Some up-front abstraction cost is accepted in exchange for cheap, localised
  upgrades later — but only for a seam a present requirement actually crosses, not
  one anticipated speculatively.
</content>
