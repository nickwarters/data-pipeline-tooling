---
status: accepted
---

# Progressive enhancement behind stable seams

The framework deliberately ships the **simplest viable implementation now** and defers richer ones, but always behind a **stable interface (seam)** so the upgrade later is contained rather than a rewrite. This is a recurring, intentional stance — not unfinished work.

Instances already chosen:

- **In-memory engine:** pandas now → polars (or other) later; concrete engine confined to readers/writers/processors, never in Protocol signatures, scripts, or the domain layer. (ADR-0002)
- **Authoring:** Python builder scripts now → declarative config later; the deferred builder *is* the spec, so a config loader reuses it. (ADR-0003)
- **Schema/typing:** dataclasses now → Pydantic later; validation derived from annotations via an adapter, so the swap is the model base + adapter only.
- **SAS/remote transfer:** shell `ssh`/`scp` now → library (e.g. paramiko) later; remote execution stubbed until implemented. (ADR-0004)
- **Orchestration:** standalone scheduled scripts now → thin runner + run registry later; each pipeline exposes a standard entrypoint and logs through a framework logging interface so a runner can wrap it without rewrites.

## Why

- Delivers value fast on a locked-down estate (venv + pip, stdlib-first) without committing to heavy tooling prematurely.
- Keeps options open: the costly choices (engine, store, config language, auth) are swappable because nothing leaks across the seam.
- Communicates intent: stubs and stdlib choices are deliberate staging, not gaps.

## Consequences

- Every deferral must land behind a real interface up front — the seam is the deliverable, even when the rich implementation isn't.
- Reviewers should judge components against their seam contract, not assume the simple implementation is the final word.
- Some up-front abstraction cost is accepted in exchange for cheap, localised upgrades later.
