---
status: accepted
---

# Eager steps are the default authoring model

> **A pipeline is an ordinary Python function that runs top to bottom. The
> deferred graph is the exception, kept for the graphs that genuinely fan in.**

A pipeline is written with **eager steps** — `read`, `transform`, `validate`,
`write`, plus `coerce` / `enforce` / `quarantine` / `step` — each of which does
its work when it is called and returns an ordinary `Dataset`:

```python
def run(context):
    med = medallion(StoreRegistry(context.base_dir), "orders")
    data = read(CsvReader(SOURCE))          # <- breakpoint here; data is real
    data = coerce(OrderRow, data)           # <- step over; watch it change
    validate(SchemaValidator(OrderRow), data)
    write(med.silver.writer("orders", strategy), data)
```

## What breaks today

The deferred `Pipeline` builder wires a graph and executes it later, from the
leaves backwards. Stepping through an author's own code shows them nothing:

```python
r = p.read(CsvReader(SAMPLE_CSV), name="read")   # step over -> nothing. r is a ReadNode.
node = p.transform(SchemaCoercion(Row), r, ...)  # step over -> nothing. A TransformNode.
p.write(med.raw.writer(...), node, name="write") # step over -> nothing.
p.run()                                          # step over -> it is all over.
```

To watch a frame change after coercion an author must set a breakpoint inside
`framework/run/builder.py::TransformNode._do_execute` and understand that
`Node.execute` recurses **backwards** through its inputs before doing any work.
That is framework internals, and it is the only way to see one's own data.

This is not a theoretical cost. The second-most-experienced engineer on the team
spent **a week** on `pipelines/ingest` — the simplest pipeline in the repository,
estimated at half a day — and the debugger was the barrier. The team's working
model is PyCharm: set a breakpoint, step, watch values change. The deferred
builder is opaque to exactly that model.

### The graph was not paying for itself

Counted across every wiring in `pipelines/`:

| Wiring | Count |
|---|---|
| Nodes with exactly **one** input | 161 |
| Nodes with 2–3 inputs (true fan-in) | 8 |
| `depends_on=` edges | 1 |

The eight fan-in nodes live in two files (`notifications`, and the
`retail_analytics` demo). **95% of pipeline code is a straight line described as
a graph** — paying deferred, un-steppable execution everywhere to serve fan-in
almost nowhere.

## Decision

The eager steps in `framework/run/steps.py` are the **default** authoring model,
exported from the `framework.run` facade. `scaffold` renders them. The deferred
`Pipeline` builder stays, unchanged and supported, for graphs that genuinely fan
in and for the pipelines not yet converted.

**The two interoperate.** A `Pipeline.run()` inside an eager `run(context)`
inherits the same ambient context, so both models record against one
`pipeline_run_id`. A part-converted feed is one run in the registry, not two.
`pipelines/ingest` is deliberately left in that state as the worked example: raw
and silver eager, the shared gold reduce still deferred.

### The observable properties are unaffected

Every step emits exactly the record the equivalent node emits — one per step,
with its timing, row counts either side, warn hits, data locations, and whether
it committed — against the ambient `RunContext` the runner already establishes.
So **replay, the run registry, freshness, orchestration and `cli status` are
untouched**: they were produced by the runner wrapping `run(context)`, never by
the graph.

Three specifics worth stating, because each was a plausible casualty:

- **Dry run survives, and improves.** `write` and `quarantine` skip their commit
  under `RunContext(dry_run=True)` and record the intent, exactly as the nodes
  do. The preview is now *more* informative: because the reads really happened,
  every step reports real columns, dtypes and sample rows.
- **Step names are derived, not typed.** `read` and `write` take the verb an
  operator expects; `transform` and `validate` take the component's own name
  (`Filter` → `filter`, `SchemaCoercion` → `schema_coercion`). Repeats are
  suffixed (`filter-2`), so every record still names exactly one step. An
  explicit `name=` always wins. This removes 278 hand-written `name=` arguments
  from the tree as pipelines convert.
- **No run context is a supported state.** Called with no runner above them —
  an author in a scratch file or a debugger — the steps do their work and record
  nothing. Being able to call `read(CsvReader(path))` on its own, with no
  ceremony, is the point of the change and not an accident of it.

### `enforce` composes; it does not replace

`enforce(schema, data, reject_writer=...)` is the coerce → quarantine → validate
sequence in the order that makes it correct. Each part still records its own
step, so it is shorthand rather than a black box. `transform` and `validate`
remain primitives: a validation need not follow a coercion, and most do not.

## What this does not decide

Deliberately out of scope, each its own decision:

- **Removing the deferred builder.** Not proposed. It earns its place where a
  graph fans in.
- **Converting the remaining 19 pipelines.** Mechanical but not free; the
  conversion is `p.transform(X, node, name=...)` → `data = transform(X, data)`,
  which is why the argument order was kept identical.
- **Deleting streaming**, dropping quarantine, the `source()` column mapping,
  arrival gating for multi-file feeds, and `context.medallion()`. All recorded in
  [`framework-simplification-review.md`](../framework-simplification-review.md).

## Consequences

- A pipeline can be stepped through in PyCharm, which is how this team reads
  code. That is the whole justification; everything else is preserved rather
  than gained.
- Two authoring models exist during the migration. This is a real cost, and the
  mitigation is that the scaffold renders only one of them, so nobody meets the
  builder unless they open an unconverted pipeline.
- `Pipeline.describe()` has no eager equivalent. `cli run --dry-run` covers the
  need it served, with better output.
- A pipeline's `main()` now calls the same `run_pipeline` the operator CLI uses.
  Previously the scaffolded `main()` registered with `PipelineRunner` under a
  subject, producing a *different* run label and `logical_run_id` than
  `cli run` for the same feed (`myfeed/myfeed` vs `myfeed`) — two run histories,
  and a re-drive through the other entry point that accumulated rows instead of
  replacing them. Keeping `main()` matters for a PyCharm-first team; keeping it
  divergent was a defect.
