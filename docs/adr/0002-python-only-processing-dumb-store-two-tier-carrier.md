---
status: accepted
---

# Python-only processing, dumb SQLite store, two-tier data carrier

All business logic and data processing — filtering, scoring, sorting, joining, and Selection — happens **in Python**. SQLite is treated as a **dumb store**: it persists and returns data but never encodes business rules (no business-rule WHERE clauses, no joins-as-logic). Data moves through Python on a **two-tier carrier**: an *opaque tabular dataset* for bulk medallion/selection work (backed by pandas today, swappable to e.g. polars later), and *typed domain objects* (`Case`, `ReviewOutcome`) at the domain edge such as `CasePool.fetch_available_cases()`. The concrete in-memory engine (pandas/polars) is confined to the low-level reader/writer/engine implementations and must never appear in a Protocol signature, pipeline script, or the domain layer.

## Considered options

- **Push set-ops (filter/join/sort) down to SQLite SQL:** efficient given one DB per layer, but puts business logic in the store — explicitly rejected by the team.
- **All processing in the in-memory engine (chosen):** uniform Python programming model, fully testable, store stays swappable; cost is data volume moved into memory.
- **`pd.DataFrame` as the public carrier:** rejected — leaks pandas into the main system and breaks the swappability requirement.

## Consequences

- The in-memory engine sits on the **critical path for all processing**; the quality and stability of its abstraction is load-bearing, and swapping it must not touch the main system.
- **Memory/volume is the primary performance risk** in principle, but volumes are small (≤ ~1M rows per feed/run), so plain in-memory joins/scoring are fine and no chunking/streaming machinery is needed up front. Revisit only if a feed grows large.
- Type safety is strongest at the domain edge (typed objects); bulk tier trades static typing for columnar performance behind an opaque dataset.
- Keeping logic in Python (not SQL) preserves the option to swap the *store* later, not just the engine.
