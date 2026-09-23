---
status: accepted
---

# A transformer's crash is a located `TransformError`

**A transform step re-raises a crash in its transformer as a `TransformError`
(category `code`) that names the step, the transformer, and the author's line
that raised, chaining the original.** A `PipelineError` the transformer raises
itself passes through untouched, and a bug anywhere else — a reader, a writer, a
validator, the framework — still surfaces as the raw exception it is.

This amends one line of
[ADR-0005](0005-fail-fast-atomic-runs-and-observability.md): "a bug carries no
category, and keeps its traceback".

## Why

That line drew the expected-failure-vs-bug boundary so a defect would look like
one: a full traceback, no category, noticed. For a transformer it did the
opposite of its purpose. A transformer is the pipeline author's own code, very
often an inline lambda
([ADR-0027](0027-eager-steps-are-the-default-authoring-model.md)), and the raw
traceback of its crash named neither the step it ran in nor — for a lambda —
the transformer at all: thirty frames of pandas ending in `KeyError: 'total'`,
with the one frame in the author's file somewhere in the middle, called
`<lambda>`. An operator reading the run's stderr could not tell which of a
feed's dozen transforms had broken, and the run log recorded only `'total'`.

## What it says

```
Pipeline run failed [TransformError, code]
  transform step 'derive-ratio' failed: KeyError: 'total'
  transformer: <lambda> at pipelines/orders/pipeline.py:42
    data = transform(lambda d: d.assign(ratio=d["amount"] / d["total"]), data)
  raised at pipelines/orders/pipeline.py:42, in <lambda>
```

- **The step** — its run-log name, so the message and the log's `error` record
  agree.
- **The transformer** — a lambda by the file and line it was written on and its
  source line, so "which lambda?" answers itself; a function by its qualified
  name and location; a bound method by its owner; a `partial` by what it wraps;
  a callable object through its own `describe()`.
- **Where it raised** — the innermost frame *outside* the standard library and
  installed packages, i.e. the author's line, not the pandas frame the error
  surfaced in.

## Consequences

- The wrapping is at the **step** — the eager `transform` and the builder's
  `TransformNode` — never inside a transformer, so a transformer called directly
  in a unit test raises what it always raised.
- The original is the `TransformError`'s `__cause__` (and `.original`), so a
  debugger breaking on the raise, a test, or `traceback.print_exception` still
  has the full stack. What an operator *loses* is the traceback on stderr by
  default; the `raised at` line is the part of it they were looking for.
- `ErrorCategory` gains `code` — "the fix is in the transform code, or in data
  it did not anticipate". `error_category` is free text in the run log and the
  registry, so no migration follows.
- `dry_run_pipeline` records a `PipelineError` on its report rather than raising
  it, so a dry run that reaches a crashing transformer now shows the preview up
  to the failure instead of a traceback.
- Tests asserting a raw exception out of a transform step now assert
  `TransformError` and, where it matters, its `__cause__`.
