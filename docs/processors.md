# Processors — the Selection & Ingest transforms

This documents the concrete `Processor` primitives in `framework.transform.processors`.
They fall into two workload families:

- **Selection narrowing** — `Filter`, `Score`,
  `VectorizedFilter`, `VectorizedDerive`, `Sort`, `Rename`, `Stamp`, `JoinWith`,
  and `AntiJoinWith`,
  the cross-feed join/exclusion gates that consume explicit read-only
  dependencies. The Selection Pipeline reads the **CasePool**, narrows and ranks
  it, joins in Reference Data, filters exclusion lists, and emits the
  **SelectionPool**.
- **Ingest & fan-out reshaping** — `SelectColumns`, `DropColumns`, `Unpivot`,
  `DeriveKey`, `LatestPerKey`: the transforms that fan one wide feed into a Case
  table and its Detail Tables, derive the deterministic `case_id`, and reduce
  accumulated history to current-state gold (ADR-0009).

For the *why*, see
[ADR-0002](adr/0002-python-processing-opaque-dataset-carrier.md)
(Python-only processing),
[ADR-0003](adr/0003-deferred-dag-composition.md) (deferred
builder, explicit join dependencies), and
[ADR-0009](adr/0009-case-identity-and-gold-grain.md) (case identity, gold grain,
multi-table feeds). The schema-driven `SchemaCoercion` processor lives with the
schema and is documented separately — [core-primitives.md](core-primitives.md)
and [schema-enforcement.md](schema-enforcement.md).

## What a processor is

A `Processor` is an engine-confined transform run mid-pipeline — it takes the
bulk-tier `Dataset` and returns a transformed one:

```python
# Transforms are now standard callables.
# e.g. Callable[[Dataset], Dataset]
```

It is attached with `.transform(...)` and runs as the builder's `process`
step, in attach order, between the pre- and post-validators. Unlike the
structural validators it is **engine-confined** — a transform needs the engine's
vectorised operations, so it reaches the backing frame via
`to_pandas()`/`from_pandas()` exactly as a Reader/Writer does (ADR-0002). A
processor has **no severity**: a transform either applies or it can't, so a
failure is always fail-fast (ADR-0005) — it raises and the run aborts.

The sections below cover the **Selection** transforms first (the
`filter/score/sort/join` of `CONTEXT.md`): the Selection Pipeline reads the
**CasePool**, narrows and ranks it, joins in Reference Data, and emits the
**SelectionPool**. The **Ingest & fan-out** transforms follow. The
`SchemaCoercion` processor is documented separately —
[schema-enforcement.md](schema-enforcement.md).

Pipeline authors may also define small, pipeline-local processors when the
operation is specific to one Case Type or report, such as joining a contact-count
aggregate onto a case snapshot or grouping selected cases into an adviser
summary. Keep those classes beside the concrete pipeline and expose only the
business behavior in tests; promote them into `framework.transform` only when
the same transform becomes reusable across pipelines. See
`pipelines/comprehensive_examples/` for a multi-source bronze-to-silver and
silver-to-gold example using this pattern.

## Row-callable and vectorized rules

`Filter` and `Score` carry their business rule as a **plain-Python callable over
a row mapping** (`{column: value}`), not a SQL string or a column-operator DSL.
This is ADR-0002 made concrete: all business logic happens in Python, and the
store stays dumb. The rule is ordinary Python and never names the engine — the
processor applies it row-wise behind the `Dataset` seam:

```python
RowPredicate = Callable[[Mapping[str, Any]], bool]   # Filter
RowScorer    = Callable[[Mapping[str, Any]], Any]     # Score
```

Use row-callable processors when the rule is small, easiest to read as ordinary
Python over one Case, or reused in direct unit tests with a `dict` row. For
large feeds or common column expressions, use the vectorized processors:

```python
FramePredicate = Callable[[pd.DataFrame], pd.Series]  # VectorizedFilter
FrameDeriver = Callable[[pd.DataFrame], object]       # VectorizedDerive
```

`VectorizedFilter` calls its predicate once with the whole frame and expects a
same-length boolean mask. `VectorizedDerive` calls its deriver once with the
whole frame and writes the returned series/scalar/array-like value into one
column. These processors intentionally expose pandas inside the processor
callable: they are still engine-confined behind the `Dataset` seam, but trade
some portability for batch-friendly execution. Chunking/streaming remains
explicitly deferred.

### Authoring selection rules

Selection rules should be written so the Selection trace can explain them and a
reader can test them without booting a whole Pipeline:

- **Name every explainable gate**: pass `name=` to `Filter` and `JoinWith` when
  the processor may exclude a Case. Use the business reason, e.g.
  `name="high-value"` or `name="adviser-hierarchy"`, not an implementation note.
  Unnamed gates still run, but the trace can only report a generic label.
- **Keep predicates and scorers pure**: make them deterministic functions of the
  row mapping and explicit constants. Do not read the clock, open files, query a
  database, mutate module state, or depend on run order inside the callable. Pass
  run-level facts in as ordinary constants when constructing the pipeline.
- **Extract repeated rules into helpers**: if the same expression appears in two
  gates, or a scorer shares sub-calculation with a predicate, move it to a named
  function. The function name becomes documentation, and the rule can be tested
  independently.
- **Test rule functions directly**: a predicate/scorer is just Python, so unit
  tests can call it with a small `dict` row. Use full Pipeline tests for the
  wiring: score column present, filter named in the trace, rank/order correct,
  and the SelectionPool write.
- **Budget for row-wise Python**: `Filter` and `Score` call your function once
  per row via the backing engine. That keeps business logic portable and
  debuggable, but a slow callable scales linearly with row count. Avoid network
  calls, disk I/O, expensive parsing, and repeated reference lookups in the row
  function; pre-compute reference data before the processor, use `JoinWith`, or
  express the rule as `VectorizedFilter` / `VectorizedDerive` when it is a
  natural column operation.

```python
from typing import Any, Mapping

from framework.transform import Filter, Score


def high_value_case(row: Mapping[str, Any]) -> bool:
    return row["amount"] >= 100


def priority_score(row: Mapping[str, Any]) -> int:
    return row["amount"] * 2


pipeline = (
    pipeline
    .transform(Score("priority_score", priority_score))
    .transform(Filter(high_value_case, name="high-value"))
)
```

### `Filter` — narrow the rows

Keeps only the rows for which the predicate is true (the narrowing half of
Selection — eligibility/availability criteria computed in Python):

```python
from framework.transform import Filter


def high_score(row):
    return row["score"] >= 10



def high_score(row):
    return row["score"] >= 10


# keep cases scored at least 10
Filter(high_score, name="high-score")
```

An empty feed in yields an empty feed out (no error) — realistic when an upstream
filter has already matched nothing.

An optional `name=` labels the eligibility gate so Selection explainability can
record *which* filter excluded a Case — `Filter(high_value_case,
name="high-value")`. Unnamed filters still work; see
[`selection.md`](selection.md) for the per-Case trace.

### `Score` — rank the rows

Computes a column from each row via a scorer; every other column is untouched. A
new column name adds; an existing one overwrites:

```python
from framework.transform import Score


def priority_score(row):
    return row["amount"] * 2



def priority_score(row):
    return row["amount"] * 2


# derive a priority from the row's amount
Score("priority", priority_score)
```

### `VectorizedFilter` / `VectorizedDerive` — batch-friendly rules

Use these when the rule is naturally a whole-column expression and row-wise
callbacks would become the dominant cost for a large feed:

```python
from framework.transform import VectorizedDerive, VectorizedFilter

pipeline = (
    pipeline
    .transform(
        VectorizedFilter(lambda df: df["score"] >= 10, name="score-threshold")
    )
    .transform(VectorizedDerive("priority", lambda df: df["amount"] * 2))
)
```

The equivalent row-callable form is still valid and remains the clearer choice
for rules that read best one Case at a time:

```python
from framework.transform import Filter, Score

pipeline = (
    pipeline
    .transform(Filter(lambda row: row["score"] >= 10, name="score-threshold"))
    .transform(Score("priority", lambda row: row["amount"] * 2))
)
```

### `Sort` — order the rows

Orders rows so a downstream "top N" is meaningful. `by` is a column or a sequence
of them; `ascending` a single flag or a matching sequence. The sorted dataset's
index is reset (`0..n-1`) so it reads positionally clean and no stale source
order leaks through to storage:

```python
from framework.transform import Sort

Sort("priority", ascending=False)        # highest first
Sort(["region", "priority"])             # by region, then priority
```

### `Rename` — align column vocabulary

Renames columns by an `{old: new}` mapping; columns the mapping doesn't name pass
through in place and in order. Typically used to make two feeds agree on a key
name before a join:

```python
from framework.transform import Rename

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
from framework.transform import Stamp

Stamp("question_bank_id", variation.question_bank_id)
```

## Column shaping — `JoinColumns`

Small, general-purpose column transforms for feeds that need a readable
composite key or output field. They are ordinary `Processor`s
(engine-confined, fail-fast) and, like
`SelectColumns`/`DropColumns`, raise `ValueError` naming a missing column rather
than silently skipping it.

### `JoinColumns` — recombine several columns into one

```python
from framework.transform import JoinColumns

JoinColumns(["first", "last"], "full_name", sep=" ")
JoinColumns(["region", "adviser"], "group_key", drop=True)
```

`JoinColumns` stringifies each row's `columns` values and joins them with `sep`
(`","` by default) into the `into` column (new, or an overwrite). The source
columns are kept by default (`drop=False`) — joining typically adds a composite
alongside its parts; pass `drop=True` to consume them. It is the plain-text
sibling of `DeriveKey`, which hashes the joined natural key into a deterministic
UUID; reach for `JoinColumns` when you want the readable composite itself, and
`DeriveKey` when you want the stable `case_id`.

## `JoinWith` — explicit cross-feed dependency join

A Case Type's Selection joins against other feeds — most commonly **Reference
Data** (the Adviser hierarchy, product codes, mappings), which is read-only to
Case Types and joined in Python, never written by them (`CONTEXT.md`, ADR-0002).
`JoinWith` is that join, and it is a `Processor`:

```python
from framework.transform import JoinDependency, JoinWith

reference = JoinDependency("advisers", advisers.silver.reader("advisers"))
JoinWith(reference, on="adviser", how="inner")
```

- `other` — a `JoinDependency`, `Reader`, or materialized `Dataset`.
  `JoinDependency(name, reader)` is the preferred form because the name appears
  in run logs as `dependency:<name>` and the reader is cached after one read.
- `on` — the shared key column(s).
- `how` — the join kind: `inner` (default — unmatched rows dropped),
  `left`/`right`/`outer`, or `cross`.
- `name=` (optional) — labels the join so Selection explainability records a Case
  an *inner* join drops as excluded by this join, rather than silently absent
  (see [`selection.md`](selection.md)).

### Explicit dependencies

`JoinWith` never runs another pipeline. Upstream feeds should be run
by the runner/registry layer, freshness-checked there, and exposed to downstream
selection as a read-only `Reader`, cached `Dataset`, or future named upstream
output. The builder materializes each `JoinDependency` once before the processor
step and records that read separately, so upstream dependency reads and
downstream join processing have distinct failure attribution and run-log rows.

## `AntiJoinWith` — exclusion-list dependency gate

`AntiJoinWith` is the "x not in y" companion to `JoinWith`: it keeps rows from
the current `Dataset` only when their key does **not** appear in another
read-only dependency. Use it when Selection needs to remove Cases already present
in a prior result, review outcome feed, suppression list, or other materialized
dataset.

```python
from framework.transform import AntiJoinWith, JoinDependency

already_reviewed = JoinDependency(
    "already-reviewed", reviews.reader("review_outcomes")
)
AntiJoinWith(already_reviewed, on="case_id", name="already-reviewed")
```

- `other` — a `JoinDependency`, `Reader`, or materialized `Dataset`, cached the
  same way as `JoinWith`.
- `on` — one key column or a sequence of key columns.
- `name=` (optional) — labels the exclusion gate so Selection explainability
  records a dropped Case as excluded by this anti-join.

Duplicate keys in `other` are treated as set membership, so they do not duplicate
or distort the kept rows. The output keeps the current feed's columns only; the
dependency supplies membership, not additional columns.

## Worked example — filter one feed, join another's silver

A Selection-shaped pipeline: read one subject's silver CasePool, narrow it in
Python, and join another subject's silver Reference Data via an explicit
read-only dependency.

```python
from tools.store import StoreRegistry
from framework.run import Pipeline
from framework.transform import AntiJoinWith, Filter, JoinDependency, JoinWith

from tools.medallion import medallion

registry = StoreRegistry("/path/to/share")
cases = medallion(registry, "cases")
advisers = medallion(registry, "advisers")

reference = JoinDependency("advisers", advisers.silver.reader("advisers"))
already_reviewed = JoinDependency(
    "already-reviewed", cases.silver.reader("review_outcomes")
)


def selection_value_case(row):
    return row["amount"] >= 50

p = Pipeline("cases")
r = p.read(cases.silver.reader("cases"), name="read")
valued = p.transform(Filter(selection_value_case, name="selection-value"), r, name="filter")
anti = p.transform(
    AntiJoinWith(already_reviewed, on="case_ref", name="already-reviewed"),
    valued,
    name="anti-join",
)
joined = p.transform(
    JoinWith(reference, on="adviser", name="adviser-reference"), anti, name="join"
)
selection_pool = p.run()
```

At `.run()` the pipeline reads `cases` silver, reads the `advisers` dependency
once under `dependency:advisers`, reads `already-reviewed` once under its own
dependency step, filters, anti-joins on `case_ref`, then merges on `adviser` in
Python. The store never performs the join. The result is the bulk-tier `Dataset`
the Selection Pipeline would accumulate into gold as the SelectionPool (via an
`AccumulateByRun` gold write — see [gold-accumulation.md](gold-accumulation.md)).

The domain capstone composes these processors into a Case Type's
full Selection flow — `CaseType`/`Variation` + `CasePool` → `SelectionPool`,
stamping the Variation's `question_bank_id` onto the chosen Cases. See
[`selection.md`](selection.md).

## Ingest & fan-out processors — multi-table feeds (ADR-0009)

The transforms above narrow the CasePool *into* the SelectionPool. The four
below sit on the other side of the medallion: **Ingest**, where one wide source
feed (650+ columns) is fanned out into a Case table and zero or more **Detail
Tables**, each a single-table pipeline over the shared raw table (
[ADR-0009](adr/0009-case-identity-and-gold-grain.md)). They are ordinary
callables — same `(dataset) -> Dataset` shape, same engine-confined,
fail-fast contract — composed on the `raw → silver` and `silver → gold` builders.

### `SelectColumns` — project the columns this pipeline needs

```python
from framework.transform import SelectColumns

SelectColumns(["case_ref", "adviser", "activity_date", "amount"])
```

Keeps only the listed columns and drops the rest. It is the **projection seam**
that keeps each single-table pipeline narrow over a wide shared raw table
(ADR-0009): the Case pipeline projects the Case columns, each Detail pipeline
projects its own slice + the natural key. A requested column that is **absent**
raises `ValueError` naming the missing column(s) and the available ones — so a
mis-typed projection fails at run time rather than silently producing an
incomplete result. (At read time the planned reader `columns=` parameter pushes
the same projection into the `SELECT`; `SelectColumns` is the processor form for
a feed already in memory.)

### `DropColumns` — drop the columns this pipeline doesn't want

```python
from framework.transform import DropColumns

DropColumns(["scratch", "internal_flag"])
```

The **exclusion** form of the projection seam and the complement of
`SelectColumns`: where `SelectColumns` names the columns to **keep**,
`DropColumns` names the columns to **remove**, keeping the rest in their
original order. It is the ergonomic choice for a wide feed that wants *almost*
every column — strip a couple of internal/scratch columns off a wide raw table
without enumerating the many it keeps. A column named for dropping that is
**absent** raises `ValueError` naming the missing column(s) and the available
ones — so a mis-typed drop fails at run time rather than silently doing nothing.

### `Unpivot` — wide→long, for a Detail Table

```python
from framework.transform import Unpivot

Unpivot(
    id_vars=["case_id"],                 # kept on every output row
    value_vars=[f"product_{i}" for i in range(1, 11)],  # melted into rows
    var_name="product_slot",             # records which source column a row came from
    value_name="product_name",           # holds the value
)
```

Melts a repeated column group (`product_1..10`) into **one row per value**,
keeping the `id_vars` on each — the wide→long reshape that turns a wide feed's
repeated section into a Detail Table at its own finer grain (many lines per
Case). `var_name` labels the column recording *which* source column each row came
from; `value_name` the column holding the value. With `drop_empty=True` (the
default), rows whose value is `None` or an empty/whitespace-only string are
dropped — the usual case for `product 1..10` feeds where unoccupied slots are
blank. Pass `drop_empty=False` to keep them.

### `DeriveKey` — stamp the deterministic `case_id`

```python
import uuid
from framework.transform import DeriveKey

namespace = uuid.uuid5(uuid.NAMESPACE_DNS, "wide_cases")  # the case-type namespace
DeriveKey(into="case_id", namespace=namespace, natural_key=["case_ref"])
```

Computes `uuid5(namespace, natural_key_string)` for every row and writes it into
the `into` column (new or overwrite). The natural-key string joins the `str()` of
each `natural_key` column's value with `"|"`, in declared order — so the **same
values always produce the same UUID on every run and every machine** (pure stdlib
`uuid`, no platform variance). This is the deterministic `case_id` of ADR-0009:
because the Case pipeline and each Detail pipeline derive it from the *same*
`namespace` + `natural_key`, a Detail row links back to its Case with **no join**
and idempotency holds across runs. (Contrast `Stamp`, which writes one constant;
`DeriveKey` computes a per-row key from the row's natural-key columns.)

### `LatestPerKey` — collapse accumulated history to current state

```python
from framework.transform import LatestPerKey

LatestPerKey(key="case_id", by="load_date")
```

Keeps the **latest row per `key`**, where "latest" is the maximum `by` value (a
timestamp or load column). `key` is one column or a list. This is the
*current-gold* reduction of the history-upstream / current-gold Ingest profile
(ADR-0004): raw + silver accumulate the change-over-time record, and
`LatestPerKey` reduces accumulated silver to the one-row-per-Case current state
the CasePool reads. **Tie-break:** when rows for a key share the maximum `by`
value, the row appearing **last in the input** is kept — deterministic given a
stable input order (accumulating silver is appended in load order, so the last
tied row is the most recently appended). A missing `key`/`by` column raises
`ValueError`.

### Worked example — fanning one wide feed into a Case table + Detail Table

These processors are composed both **directly** on a pipeline (`SelectColumns`,
`Unpivot`) and **inside** the ingest gold builders (`ingest_silver_to_gold` wires
`DeriveKey → LatestPerKey → UniqueValidator`; `detail_ingest_silver_to_gold`
wires `DeriveKey → Unpivot`, with **no** `LatestPerKey` because a Detail Table
keeps many lines per Case). The full path — one wide CSV → a `cases` gold table +
a `case_products` Detail Table — is the runnable
[`../pipelines/demo_fan_out.py`](../pipelines/demo_fan_out.py):

```sh
python -m pipelines.demo_fan_out /tmp/demo_fan_out
```

```python
# Cases pipeline: shared raw → project case columns → coerce/validate → silver
p = Pipeline("cases")
r = p.read(med.raw.reader(SUBJECT), name="read")
this_run = p.transform(Filter(lambda row: row["run_id"] == RUN_ID), r, name="filter-run")
renamed = p.transform(Rename({"case_ref_no": "case_ref"}), this_run, name="rename")  # shared normalisation
projected = p.transform(
    SelectColumns(["case_ref", "adviser", "activity_date", "amount"]), renamed, name="select"
)
coerced = p.transform(SchemaCoercion(CaseSchema), projected, name="coerce")
validated = p.validate(SchemaValidator(CaseSchema), coerced, name="post-validate")
p.write(med.silver.writer("cases", AccumulateByRun(RUN_ID, RUN_ID)), validated, name="write")
p.run()
# CASES is the feed's CaseType — it owns the identity contract (namespace +
# natural_key), so both builders below derive the same case_id (ADR-0009).
# Cases gold: DeriveKey → LatestPerKey → UniqueValidator → current-only gold
ingest_silver_to_gold(med, CASES, "cases").run()

# Products Detail Table gold: DeriveKey (same CaseType → same key) → Unpivot wide→long
detail_ingest_silver_to_gold(
    store, CASES, "case_products",
    unpivot=Unpivot(id_vars=["case_id"], value_vars=PRODUCT_COLS,
                    var_name="product_slot", value_name="product_name"),
).run()
```

Both pipelines read the *same* raw table and share one `Rename` normalisation
instance; each is independently validated and writes its own gold. See
[gold-accumulation.md](gold-accumulation.md) for the gold builders and
[ADR-0009](adr/0009-case-identity-and-gold-grain.md) for the fan-out rationale.

## Not yet (follow-on tickets)

- **Typed `Case` objects** at the domain edge: the CasePool returns the bulk-tier
  `Dataset` today; materialising fully typed Cases on demand is the
  typed-on-demand edge at the domain layer (ADR-0002).
