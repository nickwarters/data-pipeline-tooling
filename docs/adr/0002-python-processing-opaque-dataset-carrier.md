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

## Scope note: the engine in an engine-confined `Protocol` (amended)

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

## ~~Amendment, 2026-07-27 (finding `C2`): streaming *was* needed~~ — withdrawn

> ~~This amendment recorded a `ChunkReader` family, `Pipeline.read_chunks` and a
> `ChunkWritable` write session as existing machinery.~~ Withdrawn by
> [ADR-0028](0028-a-source-too-big-for-memory-is-narrowed-at-the-source.md): the
> streaming seam never acquired a consumer outside its own tests and contradicted
> the eager authoring model of
> [ADR-0027](0027-eager-steps-are-the-default-authoring-model.md), so it was
> removed. A source too big for memory is narrowed at the source and the
> framework is handed a whole `Dataset`.
>
> The **volume premise this amendment corrected stays corrected** — a feed at
> 100M-row scale is expected, not hypothetical. What changed back is only where
> the answer lives: upstream of the framework rather than inside it. The
> opaque-carrier decision itself was never in question in either direction.
>
> The rest of this section is kept as the record of what was decided in
> July 2026.

The Consequences above say memory is a risk "in principle" but that volumes are
small (≤ ~1M rows per feed/run), so "no chunking/streaming machinery is needed up
front. Revisit only if a feed grows large."

**A feed grew large, the revisit happened, and this ADR was never amended to say
so** — leaving it contradicting both the code and `docs/streaming-large-sources.md`
while carrying `status: accepted`. This amendment records the revisit.

### What triggered it

A SAS extract feeding one Case Type is on the order of **100M rows**, of which
fewer than ~100K are ids we track. Landing it faithfully added roughly **500MB
per run** — about **1.5GB after three runs** — and the source cannot be
materialised as one `Dataset` at all. The ≤ ~1M-rows-per-feed premise simply did
not hold for that feed.

### What was chosen

Streaming was added **beside** the in-memory carrier, not instead of it:

- A `ChunkReader` port, `chunks(size) -> Iterator[Dataset]` — the streaming dual
  of `Reader`, with concrete `ChunkedCsvReader` / `SasFileReader` sources and the
  `PredicateChunkReader` / `KeyFilterChunkReader` per-chunk row filters.
- `Pipeline.read_chunks(...)`, which drives the sub-graph below it once per chunk
  so a streamed feed keeps the validators, quarantine, dry run, profiling and
  per-step run records the builder provides.
- A `ChunkWritable` write-side session (`writing_chunks()`) so many chunk writes
  land as one logical load, and wiring-time refusal of the pairings that cannot
  be made chunk-safe.

### Why the decision above still stands

The opaque-carrier decision is **unchanged**, and deliberately so. The in-memory
`Dataset` contract holds **per chunk**: each chunk is one ordinary `Dataset` and
every consumer downstream of the read sees exactly what it always saw. There is
no lazy or iterator-backed `Dataset` variant, and `ChunkReader` is deliberately
*not* unified with `Reader` by giving it a `read()` that materialises everything
— that would be a trap door straight back to the memory problem. Business logic
stays in Python, the store stays dumb, and the engine (pandas `chunksize` /
`read_sas` behind the seam) is as confined as it ever was.

What is corrected is only the *volume premise*: chunking/streaming machinery is
no longer "not needed up front". It is needed, it exists, and a feed at that
scale is expected rather than hypothetical.
