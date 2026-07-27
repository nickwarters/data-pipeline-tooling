---
status: accepted
---

# Python-only processing, dumb store, opaque Dataset carrier

All business logic and data processing — filtering, scoring, sorting, joining,
selection — happens **in Python**. SQLite is a **dumb store**: it persists and
returns data but never encodes business rules (no business-rule `WHERE` clauses,
no joins-as-logic). Data moves through Python on a **two-tier carrier**:

- An **opaque tabular `Dataset`** for bulk medallion and selection work — pandas
  behind the seam today, swappable to e.g. polars later. The concrete engine is
  confined to the low-level Reader/Writer/transform implementations and the
  **value rules** (see the scope note below), and must **never** appear in a
  pipeline script or the domain layer. Code reaches the backing frame only
  through `Dataset.to_pandas()` / `Dataset.from_pandas()`.
- **Typed domain objects** (`Case`, `ReviewOutcome`) at the domain edge — e.g.
  `CasePool.fetch_available_cases()`. The two tiers meet only *inside* the domain
  layer, which reads a `Dataset` and materialises typed objects from it.

## Why

- **Uniform, fully testable programming model.** One language for all logic; the
  store stays swappable because no business rule lives in SQL.
- **The store and the engine are both replaceable.** Keeping logic in Python (not
  SQL) preserves the option to swap the *store* later; keeping pandas behind the
  `Dataset` seam preserves the option to swap the *engine*. Neither leaks across
  the seam, so either swap is contained rather than a rewrite.
- **Type safety where it pays.** It is strongest at the domain edge (typed
  objects); the bulk tier trades static typing for columnar performance behind an
  opaque carrier.

## Considered options

- **Push set-ops down to SQLite SQL** — efficient given one DB per layer, but puts
  business logic in the store. Rejected: the store must stay dumb and swappable.
- **`pandas.DataFrame` as the public carrier** — rejected: leaks pandas into every
  script and the domain layer and breaks the swappability requirement.
- **All processing in the in-memory engine behind an opaque carrier** — chosen.

## Consequences

- The in-memory engine sits on the **critical path for all processing**; the
  quality of the `Dataset` abstraction is load-bearing, and swapping the engine
  must not touch application code.
- **Memory is the primary performance risk in principle**, but volumes are small
  (≤ ~1M rows per feed/run), so plain in-memory joins/scoring are fine and no
  chunking/streaming machinery is needed up front. Revisit only if a feed grows
  large.
- Engine-confined components (Readers, Writers, transforms, the schema/value
  validators, the **value rules**) may use `to_pandas()`; everything else names
  only generic shapes (`Dataset`, `columns`, `len`) so the public surface stays
  tiny.

## Scope note: the engine in an engine-confined `Protocol` (amended, #309)

The original wording said the concrete engine must never appear in a `Protocol`
signature. That is the rule for the *public* seams, but two engine-confined
contracts have always been exceptions, and the ADR should say so rather than
state an absolute the code does not keep:

- `ValueRule` (`framework/_internal/schema.py`) — `check(series)` /
  `violating_mask(series)` name a pandas `Series`; the concrete rules in
  `framework.core.value_rules` import pandas at module scope.
- `RowCheck`, in the same module, hands the author one row as a `Series`.

This is a deliberate trade-off, not an oversight. A value rule judges every
value in a column; running a regex or a membership test row-by-row in plain
Python would be unusably slow, so a rule is handed the column and uses the
engine's vectorised operations — exactly the bargain Readers, Writers and
transforms already make. **Authoring a value rule or a row check is therefore an
engine-confined act**, and swapping the engine would touch those rules just as
it would touch the readers and writers.

The decision itself is unchanged: pipeline scripts and the domain layer still
never name the engine, and the bulk carrier stays opaque. Only the list of
acknowledged engine-confined components is corrected.
</content>
