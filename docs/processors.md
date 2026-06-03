# Selection processors & the lazy cross-feed join

This documents the `Processor` primitives that drive the **Selection** workload —
`Filter`, `Score`, `Sort`, `Rename` — and `JoinWith`, the cross-feed join that
holds a **lazy reference to another builder** (#9). For the *why*, see
[ADR-0002](adr/0002-python-only-processing-dumb-store-two-tier-carrier.md)
(Python-only processing) and
[ADR-0003](adr/0003-deferred-fluent-builder-composition-model.md) (deferred
builder, joins as lazy references); for the surrounding primitives and the
`SchemaCoercion` processor, [core-primitives.md](core-primitives.md) and
[schema-enforcement.md](schema-enforcement.md).

## What a processor is

A `Processor` is an engine-confined transform run mid-pipeline — it takes the
bulk-tier `Dataset` and returns a transformed one:

```python
class Processor(Protocol):
    def process(self, dataset: Dataset) -> Dataset: ...
```

It is attached with `.with_processor(...)` and runs as the builder's `process`
step, in attach order, between the pre- and post-validators. Unlike the
structural validators it is **engine-confined** — a transform needs the engine's
vectorised operations, so it reaches the backing frame via
`to_pandas()`/`from_pandas()` exactly as a Reader/Writer does (ADR-0002). A
processor has **no severity**: a transform either applies or it can't, so a
failure is always fail-fast (ADR-0007) — it raises and the run aborts.

These five are the **Selection** transforms (the `filter/score/sort/join` of
`CONTEXT.md`): the Selection Pipeline reads the **CasePool**, narrows and ranks
it, joins in Reference Data, and emits the **SelectionPool**. The
`SchemaCoercion` processor (#23) is documented separately —
[schema-enforcement.md](schema-enforcement.md).

## Business rules are plain Python, not SQL

`Filter` and `Score` carry their business rule as a **plain-Python callable over
a row mapping** (`{column: value}`), not a SQL string or a column-operator DSL.
This is ADR-0002 made concrete: all business logic happens in Python, and the
store stays dumb. The rule is ordinary Python and never names the engine — the
processor applies it row-wise behind the `Dataset` seam:

```python
RowPredicate = Callable[[Mapping[str, Any]], bool]   # Filter
RowScorer    = Callable[[Mapping[str, Any]], Any]     # Score
```

Volumes are small (≤ ~1M rows per feed/run — ADR-0002), so row-wise application
is fine; chunking/streaming is explicitly deferred.

### `Filter` — narrow the rows

Keeps only the rows for which the predicate is true (the narrowing half of
Selection — eligibility/availability criteria computed in Python):

```python
from framework.processors import Filter

# keep cases scored at least 10
Filter(lambda row: row["score"] >= 10)
```

An empty feed in yields an empty feed out (no error) — realistic when an upstream
filter has already matched nothing.

An optional `name=` labels the eligibility gate so Selection explainability can
record *which* filter excluded a Case — `Filter(lambda r: r["score"] >= 10,
name="high-value")`. Unnamed filters still work; see
[`selection.md`](selection.md) for the per-Case trace (#53).

### `Score` — rank the rows

Computes a column from each row via a scorer; every other column is untouched. A
new column name adds; an existing one overwrites:

```python
from framework.processors import Score

# derive a priority from the row's amount
Score("priority", lambda row: row["amount"] * 2)
```

### `Sort` — order the rows

Orders rows so a downstream "top N" is meaningful. `by` is a column or a sequence
of them; `ascending` a single flag or a matching sequence. The sorted dataset's
index is reset (`0..n-1`) so it reads positionally clean and no stale source
order leaks through to storage:

```python
from framework.processors import Sort

Sort("priority", ascending=False)        # highest first
Sort(["region", "priority"])             # by region, then priority
```

### `Rename` — align column vocabulary

Renames columns by an `{old: new}` mapping; columns the mapping doesn't name pass
through in place and in order. Typically used to make two feeds agree on a key
name before a join:

```python
from framework.processors import Rename

Rename({"ref": "case_ref", "amt": "amount"})
```

### `Stamp` — write a constant column

Writes one constant value onto every row. Where `Score` derives a column from
each row, `Stamp` records a single run-level constant — chiefly the applicable
`question_bank_id` a Variation resolves (`CONTEXT.md`) — so the stamp reads as
the constant it is, not a degenerate scorer. The column is added (or overwritten)
even on an empty feed, so the SelectionPool's shape is stable whether or not any
Case was selected:

```python
from framework.processors import Stamp

Stamp("question_bank_id", variation.question_bank_id)
```

## `JoinWith` — the lazy cross-feed join

A Case Type's Selection joins against other feeds — most commonly **Reference
Data** (the Adviser hierarchy, product codes, mappings), which is read-only to
Case Types and joined in Python, never written by them (`CONTEXT.md`, ADR-0002).
`JoinWith` is that join, and it is a `Processor`:

```python
from framework.processors import JoinWith

JoinWith(reference_builder, on="adviser", how="inner")
```

- `other` — a **lazy reference to another builder**: any `Runnable`
  (`run() -> Dataset`), typically a read-only `Pipeline` over another
  subject's silver/gold (a `Store.reader(...)` with **no** writer, so `.run()`
  just returns that feed's dataset).
- `on` — the shared key column(s).
- `how` — the join kind: `inner` (default — unmatched rows dropped),
  `left`/`right`/`outer`.
- `name=` (optional) — labels the join so Selection explainability records a Case
  an *inner* join drops as excluded by this join, rather than silently absent
  (#53; see [`selection.md`](selection.md)).

### Lazy: a DAG without a DAG engine

The defining property (ADR-0003): `other` is **not executed when `JoinWith` is
constructed**. The reference stays unexecuted until the join's `process` step
runs `other.run()`, materialises that feed, and merges the two in Python. So a
pipeline that joins another feed is a small **DAG** — two builders resolved at
one `.run()` — expressed behind a linear-looking fluent surface, with no separate
DAG engine to build.

To keep `JoinWith` from importing the builder (which imports this module — a
cycle), the reference is held through a structural `Runnable` Protocol
(`run() -> Dataset`) rather than the concrete `Pipeline` class. Naming the
*shape* is what lets the join carry any unexecuted builder.

## Worked example — filter one feed, join another's silver

A Selection-shaped pipeline: read one subject's silver CasePool, narrow it in
Python, and join another subject's silver Reference Data via a lazy `JoinWith`.

```python
from framework.builder import Pipeline
from framework.processors import Filter, JoinWith
from framework.store import Store

cases = Store("/path/to/share/cases")
advisers = Store("/path/to/share/advisers")

# The other feed is an *unexecuted* read-only builder (no writer).
reference = Pipeline("advisers", advisers.reader("silver", "advisers"))

selection_pool = (
    Pipeline("cases", cases.reader("silver", "cases"))
    .with_processor(Filter(lambda row: row["amount"] >= 50))   # narrow (Python)
    .with_processor(JoinWith(reference, on="adviser"))          # join Reference Data
    .run()                                                      # resolves the DAG
)
```

At `.run()` the outer pipeline reads `cases` silver, filters it, then the
`JoinWith` step runs the `reference` builder, reads `advisers` silver, and merges
on `adviser` — all in Python, the store never asked to join. The result is the
bulk-tier `Dataset` the Selection Pipeline would accumulate into gold as the
SelectionPool (via [`silver_to_gold`](gold-accumulation.md)).

The domain capstone (#11, landed) composes these processors into a Case Type's
full Selection flow — `CaseType`/`Variation` + `CasePool` → `SelectionPool`,
stamping the Variation's `question_bank_id` onto the chosen Cases. See
[`selection.md`](selection.md).

## Per-group narrowing — `TopNPerGroup` and `SamplePerGroup`

Real selection rules reduce each *group* of Cases to at most *N* — "the single
highest-scoring available Case per Adviser", or "sample 5 Cases per region". Two
sibling processors do this (#62; CONTEXT.md **Sampling**). They are separate,
intention-revealing names — not one `mode=` class — in the house style that
keeps `Filter` and `Score` apart, and share a private group-and-cut helper.
`key` is one or more group columns (`str | Sequence[str]`, mirroring
`LatestPerKey`): one adviser, or Adviser × region.

### `TopNPerGroup` — ranked

```python
from framework.processors import TopNPerGroup

# the single highest-scoring Case per adviser
TopNPerGroup(key="adviser", by="score", n=1)
TopNPerGroup(key=["adviser", "region"], by="score", n=3)   # top-3 per group
```

It carries its **own** sort (`by`/`ascending`), so it does not depend on a
preceding `Sort` surviving the grouping, and applies a **stable secondary
tie-break** on `tiebreak` (default `"case_id"` — every Case has one, ADR-0009),
so ranked output is **reproducible when scores tie**.

`TopNPerGroup(key=K, by=B, n=1)` is the structural generalisation of the Ingest
reduction `LatestPerKey(key=K, by=B)` (top-1 per key). They keep separate names
for separate domains — Selection narrowing vs current-state reduction.

### `SamplePerGroup` — seeded random, pure

```python
from framework.processors import SamplePerGroup

SamplePerGroup(key="region", n=5, seed=7)   # 5 Cases per region, reproducibly
```

It is a **pure function** of (input dataset, `seed`) — ADR-0010. The seed is a
fixed, configurable constant, *not* derived from `run_id` or the clock: run-to-run
variation comes from the upstream population shrinking (select-once #60, history
gates), not from varying the randomness. Each group is ordered by `order`
(default `"case_id"`) then drawn via a per-group seed from stdlib hashing
(`hashlib`, stable across Windows/macOS — not the salted builtin `hash`), so the
draw is **invariant to incoming row order** and each group is independent: same
set in + same seed ⇒ same sample out. As-of replay (#53) reconstructs the past
input and re-feeds the same seed to reproduce a past draw.

For both: a group with fewer than `n` rows passes through whole (no error), and
an empty feed in yields an empty feed out (consistent with `Filter`). The
aggregate considered/kept/dropped counts land on the run's `process` step
(`rows_in`/`rows_out`). Exposing the *per-row* dropped reason ("ranked Kth of M",
"not drawn") at the cut point for the explainability trace (#53) is a follow-on.

## Not yet (follow-on tickets)

- **Typed `Case` objects** at the domain edge: the CasePool returns the bulk-tier
  `Dataset` today; materialising fully typed Cases on demand is reserved for a
  later slice (ADR-0002).
- **Lineage checkpoints** (`.checkpoint(writer)`): persisting an intermediate
  layer mid-pipeline, the other half of the deferred-builder terminus story.
