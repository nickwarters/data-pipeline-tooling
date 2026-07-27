---
status: accepted
---

# Deferred DAG composition model

A pipeline is described as an explicit **directed acyclic graph (DAG)** of nodes
and executed lazily. Each operation — `read`, `transform`, `validate`, `write`,
`explain`, `quarantine`, `action` — is a method on a `Pipeline` that **returns a
node**, and downstream operations take prior nodes as their inputs. Nothing runs
until `.run()`, which walks the graph from its leaves, executing each node after
its inputs:

```python
p = Pipeline("orders/ingest")
r    = p.read(CsvReader("orders.csv"), name="read")
pre  = p.validate(ColumnValidator(["case_ref"]), r, name="pre_val")
t    = p.transform(Score("score", scorer), pre, name="score")
post = p.validate(RowCountValidator(minimum=1), t, name="post_val")
p.write(writer, post, name="write")
p.run()
```

Components are reusable, role-typed, parameter-constructed objects (Readers,
Validators, Writers). **Transforms are plain Python callables** (`Dataset ->
Dataset`); the built-in utilities (`Filter`, `Score`, `JoinWith`, `Sort`, …)
implement `__call__`, so they drop straight into `.transform()` with no special
protocol. There is no fluent processing chain and no separate stage abstraction —
the graph *is* the structure.

## Why a DAG

- **Multi-input and fan-out are native.** A join is a node with two input nodes; a
  fan-out is one source node feeding several downstream paths. Neither needs a
  special dependency object or a hack around a linear chain — the cross-feed join
  reads its other input as just another node in the graph, and the runner owns the
  execution order.
- **Config later, for free.** The deferred graph *is* a spec. A future
  YAML/declarative loader builds the same nodes the Python author builds by hand,
  so the builder and a config front-end are two faces of one representation — no
  rewrite.
- **Cross-cutting concerns are centralised.** Because `.run()` owns execution, it
  wraps every node uniformly with timing, structured logging, lineage, dry-run
  handling, and fail-fast error handling. An author composes *what*
  runs; the runner owns *how* it runs.
- **Inspectable before it executes.** `.describe()` renders the planned graph from
  the same node list `.run()` walks, so the inspected plan and the executed plan
  cannot drift. A run under `RunContext(dry_run=True)` reads, transforms, and
  validates real data but skips every side effect — the write, quarantine and
  explain commits and the `action` escape hatch alike — accumulating a
  `DryRunReport` of what it would have done.

## Considered options

- **Uniform flat step list** — trivially config-able but fights multi-input joins
  and loses the typed component roles.
- **Role-typed components hand-wired in plain Python** — typed and join-friendly,
  but composition is bespoke per script and cross-cutting concerns are not
  centralised.
- **Fluent single-line builder** (`.with_processor().write_to()`) — clean for a
  linear feed, but branching and multi-input joins distort it, and it needs a
  bespoke dependency object to pull in another feed. The DAG subsumes it.

## Consequences

- **The "acyclic" in DAG is enforced, not assumed.** The walk starts from the
  leaves — the nodes nothing else depends on — so a cyclic wiring has no starting
  point at all. Rather than let that execute zero nodes and report success,
  `.run()` raises a `PipelineGraphError` (an `ErrorCategory.CONFIG`
  `PipelineError`, so a run boundary catches it with the rest of the fail-fast
  family) naming the pipeline and the condition — that every node is an input to
  another, so there is nowhere to start; it does not name the nodes forming the
  cycle. The guard sits before any node runs, so a dry run refuses the same
  graph for the same reason.
- `.run()` returns the bulk `Dataset` from the graph's terminal node(s); the
  domain edge (CasePool) returns typed `Case` objects.
- A **checkpoint is not a special primitive** — it is simply a `write` node placed
  mid-graph whose dataset other nodes still depend on. It snapshots the data at
  that point and the graph continues; its commit is independently-committed
  evidence, and it appears as an ordinary write step in the run log.
- Multi-table fan-out from one feed (a Case table plus its Detail Tables) is
  expressed as separate single-table pipelines over the shared raw table, not a
  multi-output node.
- Every node carries a stable **run address** (`pipeline.step`, optionally
  `subject/pipeline.step`) so logs, declared dependencies, and registry queries
  name the same thing. Keeping every component parameter-constructed is the
  standing discipline that keeps the config-later path real.
</content>
