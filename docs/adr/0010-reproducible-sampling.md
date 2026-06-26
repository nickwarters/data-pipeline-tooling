---
status: accepted
---

# Reproducible sampling: a pure function with a fixed seed, variation supplied by upstream

The random selectors (`SamplePerGroup` and its ungrouped counterpart `Sample`) are
a **pure function** of their input `Dataset` and a **fixed, configured seed** —
*not* a seed derived from a run id or the wall clock. The same input state plus the
same seed always yields the same SelectionPool. The run-to-run *variation* in who
gets sampled is supplied entirely by the **upstream** filters/sorts/joins, whose
candidate population changes each run (shrunk by select-once and the history
gates), not by varying the randomness itself.

## Why

- **Two reproducibility needs pull in opposite directions.** Each nightly run
  should sample *different* Cases (sampling the same Cases every night defeats the
  purpose), yet any past run must be *re-derivable* on demand ("reproduce what
  Selection picked last quarter"). A fixed seed alone seems to satisfy only the
  second; a fresh-random seed only the first.
- **Letting upstream supply the variation resolves the tension without a
  run-varying seed.** Because the input population already differs every run, a
  *pure, fixed-seed* sampler still produces a different draw each night — while
  remaining trivially replayable: reconstruct the past input (from accumulated
  silver as-of-date) and re-feed the same fixed seed to get the identical draw. No
  per-run seed to record and replay; no dependence on run-id semantics.
- **Purity keeps the seam clean.** A transform is `Dataset -> Dataset` (ADR-0002),
  engine-confined and context-free. Injecting a run id or the clock would smuggle
  run context into a transform that should know nothing of it, and would make the
  same data + same config non-reproducible across machines and times.
- **Order-invariance makes "same state" robust.** Each group is ordered by a stable
  key (`case_id`) and drawn via `hash(seed, group_key)`, so the result is invariant
  to incoming row/group ordering and each group is independent — "same *set* in ⇒
  same sample out," even if an upstream join reshuffled rows. This mirrors the
  deterministic-identity reasoning of ADR-0009 (pure stdlib hashing, identical on
  Windows/macOS).

## Considered options

- **Seed derived from a run id** — gives a different draw per run automatically and
  is recorded, so a re-drive of the same run id reproduces it. Rejected: it couples
  a context-free transform to run identity, depends on re-drives reusing the same
  id, and is unnecessary once upstream already supplies the variation.
- **Fresh random seed each run (clock/OS entropy)** — varies correctly but is **not
  replayable**; a past run can never be reconstructed. Rejected — it breaks the
  reproducibility commitment outright.

## Consequences

- The configured seed is part of a Variation's selection config; changing it
  re-shuffles every future sample for that selector (and any as-of replay must use
  the seed in force at the time being reproduced).
- Reproducibility of a sampled run is only as good as the reproducibility of its
  **input** — it rests on the as-of reconstruction of accumulated silver being
  faithful. The sampler adds no nondeterminism of its own.
- `SamplePerGroup` and `Sample` need no access to a run id, the clock, or any run
  context — they are testable as plain pure functions. They share the same seeded,
  order-invariant draw; `Sample` derives it straight from the configured seed,
  `SamplePerGroup` from a per-group seed hashed off it.
</content>
