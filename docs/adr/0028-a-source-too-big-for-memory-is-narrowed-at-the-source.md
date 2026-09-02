---
status: accepted
---

# A source too big for memory is narrowed at the source

## Decision

A source that does not fit in memory is not the framework's problem. Narrow it
at the source — with a SQL `WHERE`, a column projection, or a pre-filtered
landed file — and hand the framework a `Dataset`.

## Why

The streaming seam had no consumer outside the framework and its own tests:
the `ChunkReader` family, `Pipeline.read_chunks`, Writer chunk-write sessions,
and `stream_step`. It carried about 614 production SLOC and about 1,640 lines
of tests without serving a feed.

It also imposed rules on every author who never streamed: validators advertised
whether they needed a whole dataset; Writers had an optional chunk-write
protocol; the builder rejected chunk-unsafe pairings while wiring; and the run
log folded many executions into one record.

That model contradicts ADR-0027's eager authoring model. A chunk-driven graph
executes a step repeatedly and folds the result, so an author cannot single-step
the run as ordinary top-to-bottom Python.

## Confirmed SAS scope

The domain decision recorded in [#807](https://github.com/nickwarters/data-pipeline-tooling/issues/807)
is that no feed needs streamed SAS reads inside the framework. Any oversized SAS
extract must be narrowed upstream. SAS execution also remains outside the
framework: a pipeline reads the landed file.

`SasReader`, ADR-0012's remote-execution seam, is therefore outside this
decision and is unchanged here. *(It has since been removed under
[ADR-0029](0029-sas-runs-outside-the-framework.md), which records the second
half of #807's answer.)*

## Consequences

- A feed whose source genuinely outgrows memory has no in-framework answer.
  That is deliberate. If upstream narrowing cannot make it fit, revisit this
  ADR rather than quietly restoring a streaming seam.
- The framework removes its chunked readers, chunk-writing protocol, streamed
  builder drive, streaming validators, retry decorators, and folded run records.
- Whole-dataset `Reader`, `Writer`, validation, and deferred-DAG capabilities
  remain unchanged.
