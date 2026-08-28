# Data dictionary — `pipeline_run_metric`

Three gold **Aggregate tables** over the **run registry** — the step-level
records every pipeline run emits (`tools.observability`, declared once in
`record_schema.py`). They belong to the `pipeline_run_metric` Reporting subject
and are rebuilt whole (`Refresh()`) on every run from the registry as it stands.

The Python contracts are
[`pipelines/pipeline_run_metric/schema.py`](../pipelines/pipeline_run_metric/schema.py);
the reductions are
[`pipelines/pipeline_run_metric/metrics.py`](../pipelines/pipeline_run_metric/metrics.py);
the wiring is
[`pipelines/pipeline_run_metric/pipeline.py`](../pipelines/pipeline_run_metric/pipeline.py).

## Three things to know before reading a number

**1. `run_id`, not `pipeline_run_id`.** Every table-backed Writer stamps the
reserved `pipeline_run_id` column with the id of the run that *wrote the
table* — here, the reporting run. So the registry's `pipeline_run_id` lands in
these tables as **`run_id`**. A query joining `pipeline_run_summary.run_id` to
`run_records.pipeline_run_id` is right; one joining on `pipeline_run_id` gets
the reporting run every time.

**2. The reporting run never sees itself.** The registry is caught up from
every run log *before* the read, so a run recorded under any subject is
visible — including this pipeline's own previous runs. Its current run's
records are ingested after it returns, so the tables describe every run
before this one. It is scheduled last in the day for the same reason.

**3. Durations are the registry's.** Seconds, as each step recorded them:
`wall_clock_seconds` is the run's summary record where one was written,
`step_duration_seconds` is the sum of its step records. Statistics over an
empty set are NULL, never zero.

## Part A — Subject overview

| Attribute | Value |
|-----------|-------|
| **Subject** | `pipeline_run_metric` Reporting subject |
| **Medallion layer** | gold only |
| **Is this a Case Type?** | No — operational aggregates |
| **Source system** | The base directory's run registry, `run_records`, opened through `RunStore` (`tools/observability/run_store.py`) — the one place that says where run metadata lives, as `tools.store` says where data lives. Not a Shared Reader: the registry is run metadata owned by the framework's observability, not another subject's published dataset |
| **Load strategy** | `Refresh()`, every table |
| **Upstream dependencies** | None declared; a base directory nothing has run in yet lands three empty tables |
| **Schedule / freshness** | Daily, in its own `operations` set after every other set |
| **Migrations** | `migrations/pipeline_run_metric/gold/` |
| **Owner / data steward** | *<team>* |
| **Last reviewed** | 2026-08-28 |

`as_of_utc` is the latest record timestamp in the registry at the read, so a
re-run over the same registry produces the same tables; an empty registry has
none, and the run's own clock stands in.

## Part B — The tables

Every table also carries `as_of_utc` and the reserved `pipeline_run_id`
provenance column (see *1.* above). Neither is repeated below. `run_date` is
everywhere the **local** calendar date of the run's first record.

### `pipeline_run_summary` — one row per pipeline run

Grain: `run_id`. The registry has only step rows; this is the one-row-per-run
table every other operational question joins to.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `run_id` | `str` | No | The registry's `pipeline_run_id`. |
| `pipeline` | `str` | No | The run's pipeline label. |
| `logical_run_id` | `str` | Yes | The business run this attempt belongs to; what a re-drive shares with the run it replaces. |
| `run_date` | `str` | No | `YYYY-MM-DD`, local. |
| `started_at` / `finished_at` | `str` | No | First and last record instants, UTC ISO. |
| `wall_clock_seconds` | `float` | No | The summary record's `duration`; where a run died before writing one, `finished_at − started_at`. |
| `step_duration_seconds` | `float` | No | Sum of the step records' durations. |
| `step_count` | `int` | No | Step records (the summary is not a step). |
| `failed_step_count` | `int` | No | Steps with `status = error`. |
| `committed_step_count` | `int` | No | Steps that durably wrote an artifact. |
| `warn_hit_count` | `int` | No | Warn hits across every record of the run. |
| `status` | `str` | No | `ok` / `error`: the summary record's, else `error` if any step errored. |
| `error_category` | `str` | Yes | The first triage category recorded (`data` / `operational` / `config`), else NULL. |
| `attempt_number` | `int` | No | Rank by start among runs sharing `logical_run_id` (a run with none is its own group). |
| `is_latest_attempt` | `bool` | No | Whether no later attempt of the same logical run exists. |

### `step_duration_trend_daily` — step durations per day against their recent past

Grain: `pipeline` × `step_address` × `run_date`, over step records carrying a
duration.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `pipeline` / `step_address` | `str` | No | The step's stable address; derived from `pipeline.step` for a record predating the column, as the registry's own backfill does. |
| `run_date` | `str` | No | Local date of the run the execution belonged to. |
| `execution_count` | `int` | No | Executions that day. |
| `duration_p50` / `duration_p95` / `duration_max` | `float` | No | Over that day's executions, seconds. |
| `trailing_p50_median` | `float` | Yes | Median of the step's daily p50 over its previous seven run dates *with data*; NULL on the step's first day. |
| `delta_seconds` | `float` | Yes | `duration_p50 − trailing_p50_median`. |
| `delta_ratio` | `float` | Yes | `delta_seconds / trailing_p50_median`; NULL where the baseline is NULL or zero. |

### `step_row_flow` — the row funnel through each step of each run

Grain: `run_id` × `step_address`, over step records that reported at least
one row count. A step executed more than once in a run is summed.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `run_id` | `str` | No | The registry's `pipeline_run_id`. |
| `pipeline` / `step_address` / `run_date` | `str` | No | As above. |
| `execution_count` | `int` | No | Executions summed. |
| `rows_in` / `rows_out` / `rows_quarantined` / `rows_excluded` | `float` | Yes | Summed; NULL where no execution reported that count (a read has no `rows_in`). |
| `out_ratio` | `float` | Yes | `rows_out / rows_in`; NULL where `rows_in` is NULL or zero. |
| `quarantine_ratio` | `float` | Yes | `rows_quarantined / rows_in`; likewise. |

## Part C — Row checks

None. Each group-by produces its declared grain. Every table is gated by its
`SchemaValidator` (columns, types, nullability, `OneOf` on `status`, `Range`
on the counts) before it is written.

## Part D — Quarantine & data quality

- Nothing is quarantined: the source is the registry, whose shape is derived
  from the one field declaration the run log writes from.
- Each step's read is gated by a `ColumnValidator` on the record columns the
  reductions use, so a registry the reductions cannot read fails that step
  with the column named.
- The reductions read the registry's *stored* forms (`warn_hits` as JSON text,
  `committed` as 0/1) directly rather than through `RunRegistry`'s decode; a
  `warn_hits` value that is not a JSON list counts as no hits.
