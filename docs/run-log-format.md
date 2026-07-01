# The JSONL run log & the `RunLog` primitive

Every `.run()` can emit **structured run observability**: one JSON object per
line to a `.log` file, plus a human-readable line per record to the console for
development. The file is deliberately infrastructure-free now, yet it is the
**seam the run-registry ingests** (ADR-0011) without parsing free text. See
ADR-0005 for the *why* (fail-fast, atomic, no silent drops).

## Wiring it in

`RunLog` is composed onto the builder at construction; the builder owns no path
or format knowledge — it just drives the sink:

```python
from framework.io import CsvReader, Refresh
from tools.store import StoreRegistry
from framework.run import Pipeline
from tools.medallion import medallion, RunLog

run_log = RunLog("/path/to/share/cases/runs.log")
pipeline = Pipeline("cases", run_log=run_log)
source = pipeline.read(CsvReader("feed.csv"), name="read")
pipeline.write(
    medallion(StoreRegistry("/path/to/share"), "cases").raw.writer("cases", Refresh()),
    source,
    name="write_raw",
)
pipeline.run()
print(pipeline.pipeline_run_id)  # the run's correlating id, shared by every record
```

When a pipeline runs under the `PipelineRunner` (or the path-addressed `run`
command), the run — not the builder — owns the sink: by default it opens
`<base>/_runs/<subject or pipeline>.log`. Pass a `RunLog` to
`PipelineRunner.register(..., run_log=...)` to redirect it; omit it for that
default. The handler's `RunContext` carries whichever `RunLog` the run resolved,
so a builder composed inside the handler should read `context.run_log` rather
than open its own.

If no `RunLog` is composed, `.run()` behaves identically but emits nothing (a
null sink keeps the terminus branch-free). The human-readable console lines are
logged at `INFO` on the `framework.run.run_log` logger, so an entry-point that calls
`logging.basicConfig(level=logging.INFO)` (as `pipelines/demo_csv_to_raw.py`
does) will surface them. The `.log` file is always written when a `RunLog` is
present, regardless of logging configuration.

## The three run identifiers

Run traceability hangs off three identifiers, **widest to narrowest scope**.
Each ends in `_run_id`; the prefix names what it identifies.

| Identifier | Scope | Minted by | Stable across re-drives? |
|---|---|---|---|
| `orchestration_run_id` | one runner/orchestrator pass, **shared by every pipeline it triggers** | `tools.orchestration` (its decision store) | no — a fresh pass each time |
| `pipeline_run_id` | one **individual pipeline attempt** | the framework, per `.run()` (a fresh uuid) | no — fresh per attempt |
| `logical_run_id` | the **business run / idempotency key** (`<label>:<run_date>`) | the caller / the default | **yes** — a re-drive of the same `run_date` reuses it |

Run-log `pipeline_run_id` is the concrete attempt being observed. A truly ad hoc
`Pipeline.run()` (no runner, no ambient context) mints a fresh one and exposes it
as `pipeline.pipeline_run_id`; `Pipeline.run(context=...)` uses the supplied
`RunContext.pipeline_run_id`. A **bare** `p.run()` inside a runner handler (or a
dry run) inherits the attempt's ambient id instead of minting its own, so a
handler that runs several hops (raw → silver → gold) with bare `p.run()` calls
records every hop — and stamps every row those hops write — under the *one*
attempt-level `pipeline_run_id`, rather than orphaning each hop under a fresh id.
**Every record of a single execution carries the same `pipeline_run_id`**, so the
registry can group a run's steps and its summary. Every record *also* carries its
`logical_run_id`, so the business run a re-drive belongs to is visible in the log
itself.

The distinction that matters for a re-run: `pipeline_run_id` changes on every
attempt (so it "orphans" across re-drives), while `logical_run_id` is stable —
a re-drive of the same `run_date` reuses it. So accumulating tables key
idempotency on `logical_run_id` (a re-driven business run replaces its prior
rows), while each row still carries its own `pipeline_run_id` for traceability.
Note the scope nuance: `logical_run_id` is *also* per-pipeline — it differs from
`pipeline_run_id` by **attempt vs. business-run**, not by scope. The umbrella
`orchestration_run_id` is the only one shared across pipelines; it lives in the
orchestration decision store, joined to the run log via `pipeline_run_id`.

## Record schema

Every line is a JSON object with a **stable key set** — fields that don't apply
to a step are `null` (or `[]`), so the registry sees one shape. `timestamp`
leads each line; the examples below elide it for width but it is always present:

| Field       | Type                | Meaning |
|-------------|---------------------|---------|
| `timestamp` | string              | ISO-8601 **UTC** instant the record was emitted (step close / run end). The time dimension the run-registry orders by — "latest run per pipeline", "row counts over time". |
| `pipeline_run_id` | string        | The pipeline attempt's correlating id (same on every line of the run). The key the registry groups a run's records by. |
| `logical_run_id` | string \| null | The business run / idempotency key this attempt belongs to (`<label>:<run_date>`). Stable across re-drives of the same run date. |
| `pipeline`  | string              | The feed/pipeline name (the builder's `name`) or the runner's stable domain label (`<case_type>/<pipeline>`, e.g. `cases/selection`). |
| `step`      | string              | `read`, `pre-validate`, `quarantine`, `process`, `profile`, `explain`, `post-validate`, `write`, `freshness`, or `run` (the summary). |
| `step_address` | string \| null   | The stable dependency address for this record. Builder steps are recorded as `<pipeline>.<step>` (for example `pipeline_2.step_4`); the `run` summary is recorded as the pipeline address. The registry stores this field so downstream dependency checks can ask whether a specific upstream step has succeeded. |
| `status`    | `"ok"` \| `"error"` | Step/run outcome. |
| `rows_in`   | int \| null         | Rows the step consumed (`null` where N/A, e.g. `read`). |
| `rows_out`  | int \| null         | Rows the step produced. |
| `rows_quarantined` | int \| null  | Rows routed aside on a `quarantine` step (value-rule breaches — ADR-0007); `null` elsewhere. |
| `rows_excluded` | int \| null     | Cases a gate excluded on an `explain` step (Selection explainability — ADR-0008); `null` elsewhere. |
| `duration`  | float \| null       | Wall-clock seconds for the step/run. |
| `errors`    | string[]            | Error messages when `status` is `error`; `[]` otherwise. |
| `warn_hits` | string[]            | Warn-severity validator messages tolerated at this step; `[]` otherwise. |
| `committed` | bool                | `true` on a step that durably wrote an artifact (`write`, `quarantine` with rejects, `explain`, `checkpoint`) — independently committed evidence that **survives a later step's failure** (ADR-0005). Set only on the success record; `false` everywhere else. |
| `profile`   | object \| null      | The per-column statistical profile a `profile` step recorded (#284): a `DatasetProfile` record (`row_count` + per-column `null_rate`, `distinct_count`, `min`/`max`, bounded top-N distribution). `null` on every non-profile step. The registry stores it in a queryable `profile` column and trends it across runs via `recent_profiles(address)`. |

### Steps per run

One record per step, in execution order, then a final `run` summary:

1. `read` — `rows_out` is the rows the Reader produced.
2. `pre-validate` — input validators; `warn_hits` lists any tolerated failures.
3. `post-validate` — output validators (the home of ADR-0006 schema checks).
4. `write` — present only when a Writer is composed; `rows_in` is the rows handed to it.
5. `run` — the **summary**: overall `status`, total `duration`, and the
   run's aggregated `warn_hits`.

Opt-in steps appear only when their path is configured: `quarantine` (between
`pre-validate` and the processors — ADR-0007, with `rows_quarantined`),
`dependency:<name>` (a read-only join dependency materialized before the
processor that consumes it), `profile` (a read-only per-column profile recorded
on the step's `profile` field — #284), and `explain` (after `post-validate` — ADR-0008, with `rows_excluded`; its `rows_in`/`rows_out` are the Cases
considered/selected by Selection). A `process` step is recorded per attached
processor, so dependency reads are distinguishable from downstream join
processing.

Builder-created nodes receive their address when they are declared. For example,
`Pipeline("pipeline_2").task("step_4", ...)` emits a step record with
`step="step_4"` and `step_address="pipeline_2.step_4"`. The bare `step` remains
for human-readable logs and existing per-run views; `step_address` is the
cross-run dependency key. After ingest, `RunRegistry.records_for_address(...)`
returns records for that address and `RunRegistry.has_successful_address(...)`
answers the simple upstream-success check. `RunRegistry.latest_success(...)`
returns the newest successful record for a `RunAddress`: whole-pipeline
addresses read the `step="run"` summary, and task/step addresses read successful
non-`run` records for the target `step_address`. Its `on=...` and
`on_or_after=...` filters compare against the run-log record `timestamp` date;
there is no separate load-date filter in this first implementation.

The runner adds one domain-level opt-in step before a handler executes:
`freshness`. It is emitted for a downstream Pipeline that declares an upstream
`Requirement` or legacy `FreshnessRequirement`. If the latest successful
upstream pipeline/task record satisfies the requirement, the step is `ok`. If no
successful upstream history exists, the first-run policy controls the result:
`allow` records `ok` silently, `warn` records `ok` with a `warn_hits` message,
and `block` records `error`. If history exists but is stale, the step is
`error`, the runner writes an errored `run` summary for the downstream label,
and the handler is not called.

When the same check runs under `tools.orchestration.Orchestrator`, a stale
pipeline/task success, a missing upstream with `on_first_run("block")`, or an
upstream failure in the same orchestration pass produces a `blocked` decision in
`<base_dir>/_orchestration/runs.db`. The decision `reason` stores the
requirement failure text so operators can see which `RunAddress` prevented the
scheduled item from running.

### Happy path (a successful run of 4 rows)

```json
{"pipeline_run_id": "f8263986…", "pipeline": "cases", "step": "read",          "status": "ok", "rows_in": null, "rows_out": 4, "rows_quarantined": null, "rows_excluded": null, "duration": 0.0007, "errors": [], "warn_hits": []}
{"pipeline_run_id": "f8263986…", "pipeline": "cases", "step": "pre-validate",  "status": "ok", "rows_in": 4,    "rows_out": 4, "rows_quarantined": null, "rows_excluded": null, "duration": 0.0000, "errors": [], "warn_hits": []}
{"pipeline_run_id": "f8263986…", "pipeline": "cases", "step": "post-validate", "status": "ok", "rows_in": 4,    "rows_out": 4, "rows_quarantined": null, "rows_excluded": null, "duration": 0.0000, "errors": [], "warn_hits": []}
{"pipeline_run_id": "f8263986…", "pipeline": "cases", "step": "write",         "status": "ok", "rows_in": 4,    "rows_out": 4, "rows_quarantined": null, "rows_excluded": null, "duration": 0.0016, "errors": [], "warn_hits": []}
{"pipeline_run_id": "f8263986…", "pipeline": "cases", "step": "run",           "status": "ok", "rows_in": 4,    "rows_out": 4, "rows_quarantined": null, "rows_excluded": null, "duration": 0.0030, "errors": [], "warn_hits": []}
```

### Fail-fast abort (error-severity validator)

The failing step is recorded `error` with its message, the `run` summary closes
the run as `error`, **no `write` record is emitted** (nothing partial lands —
ADR-0005), and `.run()` re-raises `ValidationError`:

```json
{"pipeline_run_id": "…", "pipeline": "cases", "step": "read",         "status": "ok",    "rows_out": 1, "errors": [],                                                     "warn_hits": []}
{"pipeline_run_id": "…", "pipeline": "cases", "step": "pre-validate", "status": "error", "rows_in": 1,  "errors": ["cases pre-validate failed: missing required column(s): case_ref"], "warn_hits": []}
{"pipeline_run_id": "…", "pipeline": "cases", "step": "run",          "status": "error", "errors": ["cases pre-validate failed: missing required column(s): case_ref"], "warn_hits": []}
```

### Abort *after* a committed artifact

A run that writes an artifact (quarantine reject, explain/trace, or checkpoint)
and *then* fails leaves that artifact **on disk** — it is independently committed
evidence, not rolled back ([ADR-0005](adr/0005-fail-fast-atomic-runs-and-observability.md)).
The `committed` marker is the operator's index of what already landed: the
quarantine step below committed (`committed: true`) before the terminus `write`
blew up, so the reject table is real even though the run is `error`.

```json
{"pipeline_run_id": "…", "pipeline": "cases", "step": "read",       "status": "ok",    "rows_out": 4, "committed": false, "errors": []}
{"pipeline_run_id": "…", "pipeline": "cases", "step": "quarantine", "status": "ok",    "rows_out": 3, "rows_quarantined": 1, "committed": true,  "errors": []}
{"pipeline_run_id": "…", "pipeline": "cases", "step": "write",      "status": "error", "rows_in": 3,  "committed": false, "errors": ["terminus write failed: …"]}
{"pipeline_run_id": "…", "pipeline": "cases", "step": "run",        "status": "error", "committed": false, "errors": ["terminus write failed: …"]}
```

### Warn escape hatch

A warn-severity failure is recorded as a `warn_hit` on its step (status stays
`ok`), the run continues to the write, and the `run` summary surfaces the
aggregated `warn_hits` — so a tolerated condition is still visible (ADR-0005).

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
`INSERT OR IGNORE` on the primary key `(pipeline_run_id, step, step_ordinal)` guarantees
idempotency — no record is double-counted even if earlier content is revisited.

**Idempotent.** A second call on the same unchanged file returns 0 and costs
only a stat + DB lookup.
