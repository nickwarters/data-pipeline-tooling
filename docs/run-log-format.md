# The JSONL run log & the `RunLog` primitive

Every `.run()` can emit **structured run observability**: one JSON object per
line to a `.log` file, plus a human-readable line per record to the console for
development. The file is deliberately infrastructure-free now, yet it is the
**seam the run-registry ingests** without parsing free text. The *why*: runs are
fail-fast and atomic, with no silent drops.

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
logged at `INFO` on the `tools.observability.run_log` logger, so an entry-point that calls
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

Queryable from the registry's side by [`records_for_logical_run` and
`succeeded_logical_run_ids`](#querying-by-business-run-logical_run_id).

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
leads each line; the examples below elide it for width but it is always present.

**The schema is declared once, in code**: `RUN_RECORD_FIELDS` in
[`tools/observability/record_schema.py`](../tools/observability/record_schema.py)
is the authoritative field list — names, order, SQL types, encodings, and which
fields show on the console. Read it for *what* the fields are; the table below
says what they *mean*. Everything else is derived from that declaration: the
JSONL record, the registry's `CREATE TABLE`, its additive column migration
(`ensure_columns`), the `INSERT`, the row decode, and the console line. Adding a
field is **one entry** in that list — and since the declaration order is the
JSONL key order and the column order of live files on the share, **append to it,
never reorder it**.

The console line renders its fragments in that same declared order, so it is a
projection of the record rather than a separately-maintained format. One
consequence: the warn-hit fragment now prints before `committed`/`profiled`
rather than at the end of the line. The console line is for humans and nothing
parses it — the JSONL is the machine-readable contract. A field that declares
**no** console form at all is deliberately absent from the human line:
`data_locations` is stored and logged but never rendered, because a glob read
carries one entry per file and would swamp the line an operator scans.

Two fields differ between the two surfaces, by design: `step_ordinal` is the
store's own (assigned at ingest, so re-ingesting a line is a no-op) and never
appears in the log; `params` is logged but has no column.

| Field       | Type                | Meaning |
|-------------|---------------------|---------|
| `timestamp` | string              | ISO-8601 **UTC** instant the record was emitted (step close / run end), timezone-aware and carrying an explicit `+00:00` offset. The time dimension the run-registry orders by — "latest run per pipeline", "row counts over time". See [Instants are UTC, calendar dates are local](#instants-are-utc-calendar-dates-are-local). |
| `pipeline_run_id` | string        | The pipeline attempt's correlating id (same on every line of the run). The key the registry groups a run's records by. |
| `logical_run_id` | string \| null | The business run / idempotency key this attempt belongs to (`<label>:<run_date>`). Stable across re-drives of the same run date. |
| `pipeline`  | string              | The feed/pipeline name (the builder's `name`) or the runner's stable domain label (`<case_type>/<pipeline>`, e.g. `cases/selection`). |
| `step`      | string              | `read`, `pre-validate`, `quarantine`, `process`, `profile`, `explain`, `post-validate`, `write`, `freshness`, or `run` (the summary). |
| `step_address` | string \| null   | The stable dependency address for this record, supplied by the one place a step is recorded — so it is present identically on the real and the dry-run path. Builder steps are recorded as `<pipeline>.<step>` (for example `pipeline_2.step_4`); the `run` summary is recorded as the pipeline address. The registry stores this field so downstream dependency checks can ask whether a specific upstream step has succeeded. |
| `status`    | `"ok"` \| `"error"` | Step/run outcome. |
| `rows_in`   | int \| null         | Rows the step consumed (`null` where N/A, e.g. a one-shot `read`, which consumes nothing). A **streamed** read is the exception: it reports the rows it scanned from the source, so a filtering source's record shows the whole scan rather than only the survivors it passed on. |
| `rows_out`  | int \| null         | Rows the step produced. |
| `rows_quarantined` | int \| null  | Rows routed aside on a `quarantine` step (value-rule breaches); `null` elsewhere. |
| `rows_excluded` | int \| null     | Cases a gate excluded on an `explain` step (Selection explainability); `null` elsewhere. |
| `duration`  | float \| null       | Wall-clock seconds for the step/run. |
| `errors`    | string[]            | Error messages when `status` is `error`; `[]` otherwise. |
| `error_category` | string \| null | The triage category of an expected failure (`data` / `operational` / `config`) so an operator can route it without reading every message. `null` for a bug (a non-`PipelineError`) — the absence is the signal. |
| `warn_hits` | string[]            | Warn-severity validator messages tolerated at this step; `[]` otherwise. |
| `committed` | bool                | `true` on a step that durably wrote an artifact (`write`, `quarantine` with rejects, `explain`, `checkpoint`) — independently committed evidence that **survives a later step's failure**. Set only on the success record; `false` everywhere else. |
| `params`    | object              | The run's parameters, recorded only after caller-side redaction; `{}` when none. Logged for traceability but **not** stored by the registry — it has no column for them. |
| `profile`   | object \| null      | The per-column statistical profile a `profile` step recorded: a `DatasetProfile` record (`row_count` + per-column `null_rate`, `distinct_count`, `min`/`max`, bounded top-N distribution). `null` on every non-profile step. The registry stores it in a queryable `profile` column and trends it across runs via `recent_profiles(address)`. |
| `data_locations` | object[]     | The file(s) or table(s) this step actually touched, one `{"namespace", "name"}` entry each (OpenLineage's dataset identity): `{"namespace": "file", "name": "/data/orders.csv"}` for a file, `{"namespace": "sqlite:/data/raw.db", "name": "orders"}` for a table. `[]` on every step that is not a read or a write — and on a few that are, see below. A `GlobCsvReader` over three files carries three entries. Stored by the registry; never shown on the console line. |

Known-empty cases for `data_locations`, all of them deliberate:

- A **dry run**'s write step records `[]`. The write is skipped, so nothing was
  touched; the configured target is not interrogated as a substitute.
- A **failed** read or write records `[]` — the error path carries no metrics.
  A located path may still reach `errors` (the strict CSV reader puts the file
  in its message).
- A **zero-chunk** streamed drive records nothing at all: the sub-graph below
  the source never executes.
- `quarantine` and `explain` steps record `[]` today even though they commit.

### Instants are UTC, calendar dates are local

Two clocks meet in the run metadata, and mixing them silently is how a nightly
batch blocks itself on a perfectly fresh upstream. The rule is decided in one
place — `tools/observability/timestamps.py` — and every surface reads it
from there:

- **Instants are UTC.** A record's `timestamp` is a timezone-aware UTC moment,
  stored as ISO-8601 text with an explicit `+00:00` offset. That is the on-disk
  format and it is unchanged: it sorts correctly as text and never depends on
  the reading machine's zone. The orchestration decision store stamps its rows
  the same way.
- **Calendar dates are local.** A `run_date` — and an operator's "did last
  night's run succeed?" — is the box's local calendar date; `run_date` defaults
  to the local `date.today()`.
- **Every comparison between the two converts first.** A freshness check takes
  the **local** date of the stored instant before comparing it with the run
  date, and a "successes on this run date" query bounds on **local midnight
  expressed as UTC**, formatted exactly as the emitter formats a record so
  SQLite's text comparison compares like with like.

The behavioural consequence, and the bug that motivated it: the deployment
target is a UK box, at UTC+1 for roughly half the year. An upstream that
succeeded at 00:10 local on the 28th is stamped `2026-07-27T23:10:00+00:00`. A
downstream starting at 00:30 local on the 28th used to compute `run_date = 28th`
against a **UTC** `latest_date = 27th` and fail a `.same_day()` requirement —
blocking as stale twenty minutes after the upstream had succeeded. It now reads
the local date (the 28th) and proceeds. **This changes which runs count as
fresh**: a run stamped in the previous UTC day but the same local day is now
accepted, both by `FreshnessGuard` and by the `orchestrate` plan preview, which
apply the rule identically.

### Steps per run

**Exactly one record per step**, in execution order, then a final `run` summary.
That is an invariant of the engine, not a convention: recording lives in one
place (the node wrapper), and a node reports its counts by returning them rather
than by logging. Before that, `quarantine` and `explain` each emitted
*two* records — one carrying the counts, one carrying the duration, and the
quarantine pair disagreed on `step_address` under a dry run. Registry databases
written before the fix still hold those pairs; `RunRegistry.ingest()` keeps
assigning a `step_ordinal` per `(pipeline_run_id, step)`, so both historic rows
remain readable and `cli log` / `cli status` still render them. Nothing is
migrated or deleted — only new runs are single-record.

The steps of a run:

1. `read` — `rows_out` is the rows the Reader produced.
2. `pre-validate` — input validators; `warn_hits` lists any tolerated failures.
3. `post-validate` — output validators (the home of the schema checks).
4. `write` — present only when a Writer is composed; `rows_in` is the rows handed to it.
5. `run` — the **summary**: overall `status`, total `duration`, and the
   run's aggregated `warn_hits`.

Opt-in steps appear only when their path is configured: `quarantine` (between
`pre-validate` and the processors, with `rows_quarantined`),
`dependency:<name>` (a read-only join dependency materialized before the
processor that consumes it), `profile` (a read-only per-column profile recorded
on the step's `profile` field), and `explain` (after `post-validate`, with
`rows_excluded`; its `rows_in`/`rows_out` are the Cases
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

### Querying by business run (logical_run_id)

The queries above key off `pipeline_run_id` (one attempt) or `step_address`
(a stable step). `logical_run_id` — the business run / idempotency key — was
write-only from the registry's side until two read methods joined it:

`RunRegistry.records_for_logical_run(logical_run_id)` returns every record
sharing that business key, oldest first, deliberately spanning several
`pipeline_run_id`s — that span is how a re-drive is tied back to the
attempt(s) it replaces. A record with no `logical_run_id` (SQL `NULL`)
belongs to no business run and is excluded, not an error: it is still
findable via `records_for_run`. Unlike its sibling below, this method takes
no `pipeline` argument, so the key is unique only by convention — the default
`<label>:<run_date>` key embeds the pipeline label, but a caller-supplied key
reused across two pipelines would interleave their records.

`RunRegistry.succeeded_logical_run_ids(pipeline, logical_run_ids=None)`
returns the `set[str]` of business keys of `pipeline` that have at least one
`run` summary closed `status="ok"` — "any ok attempt wins", the same
multi-attempt semantic as `has_successful_address`. A key equal to its own
`pipeline_run_id` is excluded — the fallback `RunContext._default_logical_run_id`
mints when a context has no pipeline name, which is not a business key and
must never read as satisfied. A `NULL` key (no business run) is also never
reported: it fails that same comparison, since SQL `NULL` never equals
anything. Passing `logical_run_ids` bounds the result to that candidate set (an empty
iterable returns `set()` without querying); omitted, every succeeded key for
`pipeline` is returned. One hazard is deliberately *not* guarded against: a
re-drive of an already-succeeded key can clear its existing rows before
writing (`AccumulateByRun` deletes by `logical_run_id`), so a key can still
read as succeeded here even though a later, failed re-drive attempt left no
data rows behind — this answers "did an attempt ever close ok", not "is data
currently present".

Why this exists: a watermark (`DatedFileDiscovery.available_between`, see
[`docs/core-primitives.md`](core-primitives.md)) silently drops a
late-arriving artifact for a date before the mark, and `succeeded_logical_run_ids`
is the right-hand side of the correct catch-up — discovered artifacts minus
artifacts already successfully processed; the watermark form remains the
older idiom for the common case where nothing arrives late.

Neither method is backed by an index: the repository has zero indexes today,
the hotter `step_address`/`pipeline` read keys are unindexed too, and the
write path is a shared-drive SQLite file that inserts row-by-row under an
exclusive lock with WAL unavailable — a real cost for an index to add. The
existing `registry_migrations` ledger keeps that cheap to revisit: an index
added later is DDL applied once, with no on-disk format change.

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

The freshness decision itself is made in exactly one place —
`evaluate_requirement` in `framework/run/freshness.py` — of which the
runner's `FreshnessGuard` is the recording-and-raising wrapper and
`Orchestrator.plan()` the read-only caller, so the run log's `freshness` step,
the `blocked` decision, and the plan preview all describe a condition the same
way. The decision store also records `was_due` (0/1): whether the item was
scheduled work for that run date at all. It was appended to that store's
declaration, so rows written earlier read back `NULL` — the orchestrator only
reads the flag on decisions it has just made, so the older rows are unaffected.

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
the run as `error`, **no `write` record is emitted** (nothing partial lands), and
`.run()` re-raises `ValidationError`:

```json
{"pipeline_run_id": "…", "pipeline": "cases", "step": "read",         "status": "ok",    "rows_out": 1, "errors": [],                                                     "warn_hits": []}
{"pipeline_run_id": "…", "pipeline": "cases", "step": "pre-validate", "status": "error", "rows_in": 1,  "errors": ["cases pre-validate failed: missing required column(s): case_ref"], "warn_hits": []}
{"pipeline_run_id": "…", "pipeline": "cases", "step": "run",          "status": "error", "errors": ["cases pre-validate failed: missing required column(s): case_ref"], "warn_hits": []}
```

### Abort *after* a committed artifact

A run that writes an artifact (quarantine reject, explain/trace, or checkpoint)
and *then* fails leaves that artifact **on disk** — it is independently committed
evidence, not rolled back ([fail-fast atomic runs, independently-committed
artifacts](adr/0005-fail-fast-atomic-runs-and-observability.md)).
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
aggregated `warn_hits` — so a tolerated condition is still visible.

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
than total history — important on a network-share deployment.

**Partial-line safety.** The tail is read in binary mode.  If the tail does not
end with `\n` (the writer is mid-append), the trailing fragment is left for the
next call; the stored offset advances only through the last complete line.

**Truncation / rotation.** If the file is shorter than the stored offset, the
offset is reset to 0 and the whole file is re-read from the top.
`INSERT OR IGNORE` on the primary key `(pipeline_run_id, step, step_ordinal)` guarantees
idempotency — no record is double-counted even if earlier content is revisited.

**Idempotent.** A second call on the same unchanged file returns 0 and costs
only a stat + DB lookup.

**Schema migration.** Registry databases on the share are long-lived, so opening
one is also how it catches up with the declaration: `ensure_columns` adds any
declared column the table lacks (nullable, in place — never a re-create) and
returns the names it added. A database written before `committed`, `step_address`,
`logical_run_id`, `profile` or `data_locations` existed therefore keeps ingesting, and its older
rows read back with those fields empty. `tools.orchestration`'s decision store
uses the same helper over its own separate declaration — shared machinery, two
distinct contracts.

## A streamed read records the same shape

`Pipeline.read_chunks(...)` drives the sub-graph below it once per chunk, so each
step below a streamed source executes many times. That does **not** change this
format: no field was added for streaming, the key set and key order are
identical, `step_address` is the usual `<pipeline>.<step>`, and each step still
emits **exactly one** record. The per-chunk records are folded before they are
emitted — `rows_in` / `rows_out` / `rows_quarantined` / `rows_excluded` /
`duration` sum, `warn_hits`, `errors` and `data_locations` concatenate dropping a
repeat — so the one file every chunk was read from reads once, not fifty times —
`committed` is true if any chunk committed, `error_category` and `step_address`
are the step's own, and one failing chunk makes the step's `status` an `error`.
`profile` is the last chunk's payload, so a profile step under a stream describes
a chunk rather than the source.

The only thing to read differently is what the numbers *count*: for a filtering
reader the read step's `rows_in` is the **whole source scanned** and
`rows_excluded` what the filter dropped, so `rows_in` far exceeds `rows_out` by
design. See [streaming-large-sources.md](streaming-large-sources.md).
