---
status: accepted
---

# Run order is derived per pass from deadlines, not declared or scheduled

A `PipelineSet`'s run order is **derived on every pass**, as a pure function of
(the candidate items, the wall-clock time of day, which items already succeeded
today). It is not declared by the author, not stored anywhere, and not a
wake-up schedule: the three ordering inputs on `ScheduledPipeline` —
`due_time` (also spelled `deadline`), `earliest_run`, and `priority` — are read
at run time and nothing ever sleeps until a time arrives.

**Dependency order dominates every time input.** The order is produced by a
priority topological selection over `depends_on` restricted to the candidate
pool, so no deadline and no priority can move a dependent ahead of an upstream
that is also running in this pass.

**A deadline inherits up the `depends_on` graph.** An item with no `due_time` of
its own takes the tightest effective deadline of its dependents, transitively, so
an upstream is run in time for the dependent that carries the deadline. Only
items that are due today participate, so a disabled or not-due dependent cannot
push its deadline onto an upstream.

## Why

Ordering is a question about *now*, and the answer changes between two passes of
the same day: an item is more urgent at 08:55 than it was at 06:00, and a
deadline that has already passed stops exerting pressure the moment the item
succeeds. A declared order cannot express that, and a stored one would be a
second source of truth to keep in step with the schedules. Deriving it costs
nothing — the pass already reads the schedules and the run registry — and it is a
pure function, so it can be tested without a clock, a store, or a pipeline.

Time inputs must not become a second runnability predicate. Freshness
(`framework/run/freshness.py`) is the sole answer to "may this run at all";
ordering only chooses the sequence in which runnable items are attempted. That
separation is why the derivation reads run history for *overdue-ness only* — "has
it run today" decides whether a passed deadline still applies, and never whether
the item executes.

And dependency dominance has to be a selection rather than a sort, because
inheritance deliberately gives an upstream the same deadline as its dependent. A
pure sort would then let the dependent's `priority` put it first, where it would
come straight back as `blocked` — the ordering would have made the pass worse.

## Consequences

- **`earliest_run` is a per-pass eligibility gate, never a sleep.** A gated item
  is recorded `skipped` with a reason naming the window, and a `--loop` may
  settle for the day before that window opens. That is the requested semantics,
  not a defect.
- **`due_time` is a time on `run_date`; there is no next-day deadline.** A
  deadline of `00:30` evaluated at `23:50` reads as maximally overdue for that
  date.
- **A set that declares a dependent *before* its upstream changes behaviour.**
  Previously the dependent was attempted first and came back `blocked`; now the
  upstream runs first. This is an intended behaviour change.
- **The final tiebreaker is declared order** (a stable sort), so a set that
  declares none of the new fields keeps exactly its existing order.
