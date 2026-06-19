# The JSONL run log & the `RunLog` primitive

Every `.run()` can emit **structured run observability**: one JSON object per
line to a `.log` file, plus a human-readable line per record to the console for
development. The file is deliberately infrastructure-free now, yet it is the
**seam the run-registry ingests** (ADR-0005) without parsing free text. See
ADR-0007 for the *why* (fail-fast, atomic, no silent drops).

## Wiring it in

`RunLog` is composed onto the builder at construction; the builder owns no path
or format knowledge — it just drives the sink:

```python
from framework.core import RAW
from framework.io import CsvReader, Refresh, StoreCatalog
from framework.run import Pipeline, RunLog

run_log = RunLog("/path/to/share/cases/runs.log")
pipeline = Pipeline("cases", CsvReader("feed.csv"), run_log=run_log)
landed = (
    pipeline
    .write_to(
        StoreCatalog("/path/to/share").store("cases").writer(RAW, "cases", Refresh())
    )
    .run()
)
print(pipeline.run_id)  # the run's correlating id, shared by every record
```

If no `RunLog` is composed, `.run()` behaves identically but emits nothing (a
null sink keeps the terminus branch-free). The human-readable console lines are
logged at `INFO` on the `framework.run.run_log` logger, so an entry-point that calls
`logging.basicConfig(level=logging.INFO)` (as `pipelines/demo_csv_to_raw.py`
does) will surface them. The `.log` file is always written when a `RunLog` is
present, regardless of logging configuration.

## `run_id` — the execution correlation key

Run-log `run_id` is the **execution id**: the concrete attempt being observed.
Ad hoc `Pipeline.run()` creates a fresh execution id and exposes it as
`pipeline.run_id`; `Pipeline.run(context=...)` uses the supplied
`RunContext.execution_id`. **Every record of a single execution carries the same
`run_id`**, so the registry can group a run's steps and its summary.

Accumulating tables use a separate **logical run id** for idempotency: a
re-driven business run uses the same logical id so it replaces its prior rows,
while each execution still has its own execution id for traceability. Context-
derived accumulated writes stamp `run_id` and `logical_run_id` with the logical
id, and `execution_id` with the value that matches the run-log/registry `run_id`.

## Record schema

Every line is a JSON object with a **stable key set** — fields that don't apply
to a step are `null` (or `[]`), so the registry sees one shape. `timestamp`
leads each line; the examples below elide it for width but it is always present:

| Field       | Type                | Meaning |
|-------------|---------------------|---------|
| `timestamp` | string              | ISO-8601 **UTC** instant the record was emitted (step close / run end). The time dimension the run-registry orders by — "latest run per pipeline", "row counts over time". |
| `run_id`    | string              | The run's correlating id (same on every line of the run). |
| `pipeline`  | string              | The feed/pipeline name (the builder's `name`) or the runner's stable domain label (`<case_type>/<pipeline>`, e.g. `cases/selection`). |
| `step`      | string              | `read`, `pre-validate`, `quarantine`, `process`, `explain`, `post-validate`, `write`, `freshness`, or `run` (the summary). |
| `status`    | `"ok"` \| `"error"` | Step/run outcome. |
| `rows_in`   | int \| null         | Rows the step consumed (`null` where N/A, e.g. `read`). |
| `rows_out`  | int \| null         | Rows the step produced — for `write`, the rows actually persisted (`0` on an idempotent accumulate re-run that only replaced its own prior rows). |
| `rows_quarantined` | int \| null  | Rows routed aside on a `quarantine` step (value-rule breaches — ADR-0007 amd 01); `null` elsewhere. |
| `rows_excluded` | int \| null     | Cases a gate excluded on an `explain` step (Selection explainability — ADR-0007 amd 02); `null` elsewhere. |
| `duration`  | float \| null       | Wall-clock seconds for the step/run. |
| `errors`    | string[]            | Error messages when `status` is `error`; `[]` otherwise. |
| `warn_hits` | string[]            | Warn-severity validator messages tolerated at this step; `[]` otherwise. |

### Steps per run

One record per step, in execution order, then a final `run` summary:

1. `read` — `rows_out` is the rows the Reader produced.
2. `pre-validate` — input validators; `warn_hits` lists any tolerated failures.
3. `post-validate` — output validators (the home of ADR-0008 schema checks).
4. `write` — present only when a Writer is composed; `rows_in` is the rows handed
   to it, and `rows_out` is the rows it actually **persisted**. For an accumulate
   writer (`AccumulateByRunWriter` and the file `AccumulateByRun` path) re-driven
   under the same logical run id, the delete-by-run then insert replaces the
   run's own prior rows, so the net-new count is `0` — the log reports `0`, not a
   fresh load of N, matching the unchanged table state.
5. `run` — the **summary**: overall `status`, total `duration`, and the
   run's aggregated `warn_hits`.

Opt-in steps appear only when their path is configured: `quarantine` (between
`pre-validate` and the processors — ADR-0007 amd 01, with `rows_quarantined`),
`dependency:<name>` (a read-only join dependency materialized before the
processor that consumes it), and `explain` (after `post-validate` — ADR-0007 amd
02, with `rows_excluded`; its `rows_in`/`rows_out` are the Cases
considered/selected by Selection). A `process` step is recorded per attached
processor, so dependency reads are distinguishable from downstream join
processing.

The runner adds one domain-level opt-in step before a handler executes:
`freshness`. It is emitted for a downstream Pipeline that declares an upstream
freshness requirement. If the latest successful upstream run is current enough,
the step is `ok`. If there is no successful upstream history yet, the step is
also `ok` but carries a `warn_hits` message so the first-run gap is visible. If
history exists but is stale, the step is `error`, the runner writes an errored
`run` summary for the downstream label, and the handler is not called.

### Happy path (a successful run of 4 rows)

```json
{"run_id": "f8263986…", "pipeline": "cases", "step": "read",          "status": "ok", "rows_in": null, "rows_out": 4, "rows_quarantined": null, "rows_excluded": null, "duration": 0.0007, "errors": [], "warn_hits": []}
{"run_id": "f8263986…", "pipeline": "cases", "step": "pre-validate",  "status": "ok", "rows_in": 4,    "rows_out": 4, "rows_quarantined": null, "rows_excluded": null, "duration": 0.0000, "errors": [], "warn_hits": []}
{"run_id": "f8263986…", "pipeline": "cases", "step": "post-validate", "status": "ok", "rows_in": 4,    "rows_out": 4, "rows_quarantined": null, "rows_excluded": null, "duration": 0.0000, "errors": [], "warn_hits": []}
{"run_id": "f8263986…", "pipeline": "cases", "step": "write",         "status": "ok", "rows_in": 4,    "rows_out": 4, "rows_quarantined": null, "rows_excluded": null, "duration": 0.0016, "errors": [], "warn_hits": []}
{"run_id": "f8263986…", "pipeline": "cases", "step": "run",           "status": "ok", "rows_in": 4,    "rows_out": 4, "rows_quarantined": null, "rows_excluded": null, "duration": 0.0030, "errors": [], "warn_hits": []}
```

### Fail-fast abort (error-severity validator)

The failing step is recorded `error` with its message, the `run` summary closes
the run as `error`, **no `write` record is emitted** (nothing partial lands —
ADR-0007), and `.run()` re-raises `ValidationError`:

```json
{"run_id": "…", "pipeline": "cases", "step": "read",         "status": "ok",    "rows_out": 1, "errors": [],                                                     "warn_hits": []}
{"run_id": "…", "pipeline": "cases", "step": "pre-validate", "status": "error", "rows_in": 1,  "errors": ["cases pre-validate failed: missing required column(s): case_ref"], "warn_hits": []}
{"run_id": "…", "pipeline": "cases", "step": "run",          "status": "error", "errors": ["cases pre-validate failed: missing required column(s): case_ref"], "warn_hits": []}
```

### Warn escape hatch

A warn-severity failure is recorded as a `warn_hit` on its step (status stays
`ok`), the run continues to the write, and the `run` summary surfaces the
aggregated `warn_hits` — so a tolerated condition is still visible (ADR-0007).

## Reading the log back

One JSON object per line means trivial ingestion — no custom parser:

```python
import json
records = [json.loads(line) for line in open("runs.log")]
```

## Registry ingest — incremental high-water-mark

`RunRegistry.ingest()` is **incremental**: the byte offset of the last fully
consumed line is persisted in the registry DB's `ingest_progress` table, keyed
by the normalised absolute path of the log file.  On each call only the tail
bytes beyond that offset are read, so cost is proportional to new records rather
than total history — important on a network-share deployment (ADR-0001).

**Partial-line safety.** The tail is read in binary mode.  If the tail does not
end with `\n` (the writer is mid-append), the trailing fragment is left for the
next call; the stored offset advances only through the last complete line.

**Truncation / rotation.** If the file is shorter than the stored offset, the
offset is reset to 0 and the whole file is re-read from the top.
`INSERT OR IGNORE` on the primary key `(run_id, step, step_ordinal)` guarantees
idempotency — no record is double-counted even if earlier content is revisited.

**Idempotent.** A second call on the same unchanged file returns 0 and costs
only a stat + DB lookup.
