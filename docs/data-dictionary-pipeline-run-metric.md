# Data dictionary — `pipeline_run_metric`

Five gold **Aggregate tables**: four over the **run registry** — the
step-level records every pipeline run emits (`tools.observability`, declared
once in `record_schema.py`) — and one over the **orchestration decision
store**. They belong to the `pipeline_run_metric` Reporting subject and are
rebuilt whole (`Refresh()`) on every run from the stores as they stand.

For the at-a-glance view, `python -m cli perf` reads
`duration_percentiles_daily` and `batch_finish_daily` (see
[operator-cli.md](operator-cli.md#perf--durations-at-a-glance)).

The Python contracts are
[`pipelines/pipeline_run_metric/schema.py`](../pipelines/pipeline_run_metric/schema.py);
the reductions are
[`pipelines/pipeline_run_metric/metrics.py`](../pipelines/pipeline_run_metric/metrics.py);
the wiring is
[`pipelines/pipeline_run_metric/pipeline.py`](../pipelines/pipeline_run_metric/pipeline.py).

## Five things to know before reading a number

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

**4. A record is stamped when its step ends.** So a step started at its
`timestamp` less its `duration`, and a run started at the earliest of those.
`started_at` and the execution date (below) both use that start, not the
first record's stamp, which would be late by the whole first step.

**5. A run is filed under the pipeline its own summary names.** A handler that
runs nested `Pipeline` stages writes each stage's steps and a summary under the
stage's name, then the runner writes the run's summary under the pipeline's.
`pipeline` in every table is the run's — the last summary record's — so a stage
never shows up as a pipeline of its own; its steps keep their stage in
`step_address`.

## Part A — Subject overview

| Attribute | Value |
|-----------|-------|
| **Subject** | `pipeline_run_metric` Reporting subject |
| **Medallion layer** | gold only |
| **Is this a Case Type?** | No — operational aggregates |
| **Source system** | The base directory's run registry, `run_records`, and its orchestration decisions, `orchestration_records`, both located by `RunStore` (`tools/observability/run_store.py`) — the one place that says where run metadata lives, as `tools.store` says where data lives. The decisions are read through `OrchestrationStore`, so a store from before a column existed is brought up to date first. Not Shared Readers: both are run metadata owned by the framework's observability, not another subject's published dataset |
| **Load strategy** | `Refresh()`, every table |
| **Upstream dependencies** | None declared; a base directory nothing has run in yet lands empty tables |
| **Shared Readers** | `readers/pipeline_run_metric.py` serves `duration_percentiles_daily` and `batch_finish_daily` (to `cli perf`) |
| **Schedule / freshness** | Daily, in its own `operations` set after every other set |
| **Migrations** | `migrations/pipeline_run_metric/gold/` |
| **Owner / data steward** | *<team>* |
| **Last reviewed** | 2026-10-09 |

`as_of_utc` is the latest record timestamp in the registry at the read, so a
re-run over the same registry produces the same tables; an empty registry has
none, and the run's own clock stands in.

## Part B — The tables

Every table also carries `as_of_utc` and the reserved `pipeline_run_id`
provenance column (see *1.* above). Neither is repeated below.

Every table is dated, and **not by the same date in all five**. A run has two
dates, which differ only for a re-drive of an earlier date:

- its **business date** — the `run_date` its run summary recorded, else the
  local calendar date the run started. `pipeline_run_summary` and
  `step_row_flow` carry this as `run_date`: they file a run beside its
  `logical_run_id`. `batch_finish_daily`'s `run_date` is the orchestration's
  business date too: the date the batch was for.
- its **execution date** — the **local** calendar date the run started (*4.*
  above), whatever date it was run for. `step_duration_trend_daily` carries
  this as `run_date`, and `duration_percentiles_daily` as `as_of_date`: "is
  this getting slower?" is a question about when it ran, on that day's machine
  and data.

So when an operator re-drives `ingest` on 27 Aug for 5 Jan
(`cli run pipelines/ingest --run-date 2026-01-05`), the run's summary and row
flow rows land under `run_date = 2026-01-05`, beside the attempt it replaces;
its durations land in the trend's **27 Aug** row and in the percentile windows
ending on and after **27 Aug**, and the 5 Jan rows, and the baselines and
windows of the January days after it, are left as they were.

### `pipeline_run_summary` — one row per pipeline run

Grain: `run_id`. The registry has only step rows; this is the one-row-per-run
table every other operational question joins to.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `run_id` | `str` | No | The registry's `pipeline_run_id`. |
| `pipeline` | `str` | No | The run's pipeline label. |
| `logical_run_id` | `str` | Yes | The business run this attempt belongs to; what a re-drive shares with the run it replaces. |
| `run_date` | `str` | No | `YYYY-MM-DD`, the **business date**: the recorded run date, else the local date the run started. |
| `started_at` / `finished_at` | `str` | No | Earliest record start (`timestamp − duration`, the run summary included — for a runner-recorded run the summary's clock starts first, so it is the run's own start) and last record instant, UTC ISO. |
| `wall_clock_seconds` | `float` | No | The summary record's `duration`; where a run died before writing one, `finished_at − started_at`. |
| `step_duration_seconds` | `float` | No | Sum of the step records' durations. |
| `step_count` | `int` | No | Step records (the summary is not a step). |
| `failed_step_count` | `int` | No | Steps with `status = error`. |
| `committed_step_count` | `int` | No | Steps that durably wrote an artifact. |
| `warn_hit_count` | `int` | No | Warn hits across the run's step records. The summary is left out because a builder pipeline repeats every step's warns on it. |
| `status` | `str` | No | `ok` / `error` / `incomplete`: the summary record's, else `error` if any step errored, else `incomplete` (killed, or still running when the registry was read). |
| `error_category` | `str` | Yes | The first triage category recorded (`data` / `operational` / `config`), else NULL. |
| `attempt_number` | `int` | No | Rank by start among runs sharing `logical_run_id` (a run with none is its own group). |
| `is_latest_attempt` | `bool` | No | Whether no later attempt of the same logical run exists. |
| `orchestration_run_id` | `str` | Yes | The orchestration pass that started the run; NULL for a run started by hand. |
| `overhead_seconds` | `float` | No | `wall_clock_seconds − step_duration_seconds`, floored at zero: time no step accounts for (imports, registry catch-up, freshness checks). |
| `retry_attempts` / `retry_wait_seconds` | `float` | Yes | Attempts retried during the run and the time they cost, from the summary record; NULL where the run wrote none, or predates the fields. |
| `external_calls` / `external_wait_seconds` | `float` | Yes | Calls to other services during the run and the time spent waiting on them; likewise. |

### `step_duration_trend_daily` — step durations per day against their recent past

Grain: `pipeline` × `step_address` × `run_date`, where `run_date` is the
**execution date** (Part B, above), over **successful** step records carrying
a duration. A failed step's duration is how long it took to
fail, so it would drag the percentiles down (a fast failure) or up (a timeout).

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `pipeline` / `step_address` | `str` | No | The step's stable address; derived from `pipeline.step` for a record predating the column, as the registry's own backfill does. |
| `run_date` | `str` | No | `YYYY-MM-DD`, the **execution date**: the local date the run the execution belonged to started — not the business date the other two tables carry under the same name (see Part B). The column keeps the name its baseline migration gave it; renaming it would be a migration of its own. |
| `execution_count` | `int` | No | Successful executions that day. |
| `duration_p50` / `duration_max` | `float` | No | Over that day's executions, seconds. There is no daily p95: a step that runs once a day has one value per day, so it was the max. Percentiles across days are in `duration_percentiles_daily`. |
| `trailing_p50_median` | `float` | Yes | Median of the step's daily p50 over its previous seven execution dates *with data*; NULL on the step's first day. |
| `delta_seconds` | `float` | Yes | `duration_p50 − trailing_p50_median`. |
| `delta_ratio` | `float` | Yes | `delta_seconds / trailing_p50_median`; NULL where the baseline is NULL or zero. |

### `step_row_flow` — the row funnel through each step of each run

Grain: `run_id` × `step_address`, over step records that reported at least
one row count. A step executed more than once in a run is summed.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `run_id` | `str` | No | The registry's `pipeline_run_id`. |
| `pipeline` / `step_address` | `str` | No | As above. |
| `run_date` | `str` | No | `YYYY-MM-DD`, the **business date**, as in `pipeline_run_summary`. |
| `execution_count` | `int` | No | Executions summed. |
| `rows_in` / `rows_out` / `rows_quarantined` / `rows_excluded` | `float` | Yes | Summed; NULL where no execution reported that count (a read has no `rows_in`). |
| `out_ratio` | `float` | Yes | `rows_out / rows_in`; NULL where `rows_in` is NULL or zero. |
| `quarantine_ratio` | `float` | Yes | `rows_quarantined / rows_in`; likewise. |
| `duration_seconds` | `float` | Yes | Summed durations of those executions. |
| `rows_per_second` | `float` | Yes | `rows_out / duration_seconds`; NULL where either is NULL or the duration is zero. A slowdown with flat row counts points at a service; one with rising counts, at volume. |

### `duration_percentiles_daily` — percentiles you can watch over time

Grain: `level` × `pipeline` × `step_address` × `window_days` × `as_of_date`.
One row for each **execution date** on which a pipeline (or step) ran — the
local date a run started, not the business date it was for (Part B) —
covering the `window_days` calendar days ending on that date, for windows of 28
and 90 days. Because each
date has its own row, the table is the history of each percentile: plot
`duration_p90` against `as_of_date` to see whether a pipeline is heading the
right way. A 28-day window gives a daily job about 20 samples; 90 days shows
the slow tail.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `as_of_date` | `str` | No | `YYYY-MM-DD`, the last day of the window: an **execution date**, the local date on which a run in the window started. Not a business run date, so a re-drive of 5 Jan run on 27 Aug is a sample in the windows ending on and after 27 Aug. |
| `level` | `str` | No | `pipeline` (a run's wall clock) or `step`. |
| `pipeline` / `step_address` | `str` | No | What is measured; for `level = pipeline`, `step_address` is the pipeline. |
| `window_days` | `int` | No | 28 or 90. |
| `execution_count` | `int` | No | Executions in the window that finished `ok` or `error`. A run still `incomplete` is in neither count. |
| `ok_count` | `int` | No | Of those, `ok`: the sample every duration below is over. |
| `duration_p50` / `duration_p90` / `duration_p95` / `duration_max` | `float` | Yes | Seconds over the `ok` executions. p90 is NULL below 10 samples and p95 below 20, where they are in effect the max; all four are NULL when no execution in the window succeeded. |
| `failure_rate` | `float` | Yes | `error` executions over `execution_count`. |
| `retry_rate` | `float` | Yes | Share of executions in which anything was retried; NULL where no execution recorded the retry fields. |
| `external_wait_p50` / `external_wait_p95` | `float` | Yes | Seconds spent waiting on other services per `ok` execution; NULL where none recorded it. Read against the duration, it says how much of a slow step is the service. |
| `rows_per_second_p50` | `float` | Yes | Median throughput of a step's `ok` executions that reported `rows_out`; NULL at pipeline level. |
| `p50_change_ratio_28d` / `p90_change_ratio_28d` | `float` | Yes | Change against the same subject's row 28 days earlier (or the latest within a week before that, for a job that did not run that day), as a ratio: `0.25` is a quarter slower. NULL with no such row or a zero baseline. |

### `batch_finish_daily` — when the scheduled work finished

Grain: `run_date` — the orchestration's business date. From the orchestration
decision store, so only scheduled work counts; a run date appears once an item
ran for it.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `run_date` | `str` | No | `YYYY-MM-DD`. |
| `pass_count` | `int` | No | Orchestration passes that decided items for the date. |
| `started_at` / `finished_at` | `str` | No | When the first pass began and when the last item that ran finished, UTC ISO. |
| `finished_after_midnight_seconds` | `float` | No | `finished_at` measured from the start of `run_date` on the local calendar; more than 86,400 when the batch ran past midnight. "Is everything done by 07:00?" is this against 25,200. |
| `finish_p50_28d` / `finish_p90_28d` | `float` | No / Yes | Over the run dates in the 28 days ending on this one; p90 NULL below 10 of them. |
| `items_run` | `int` | No | Items handed to a pipeline: succeeded, failed, or blocked by a freshness check. |
| `items_succeeded` / `items_failed` / `items_blocked` | `int` | No | By outcome. `items_blocked` also counts items blocked by a failed upstream, which never ran. |
| `queue_wait_max_seconds` | `float` | Yes | The longest an item waited between its pass starting and it starting, behind the items before it; NULL for decisions written before the start columns existed. |

## Part C — Row checks

None. Each group-by produces its declared grain. Every table is gated by its
`SchemaValidator` (columns, types, nullability, `OneOf` on `status` and
`level`, `Range` on the counts and rates) before it is written.

## Part D — Quarantine & data quality

- Nothing is quarantined: the source is the registry, whose shape is derived
  from the one field declaration the run log writes from.
- The registry is caught up — and so migrated to the declared record shape,
  even where its logs have been rotated away — then read once for the whole run
  and gated by a `ColumnValidator` on the record columns the reductions use, so
  a registry the reductions cannot read fails the run with the column named,
  before any table is written.
- Every table is reduced and passes its `SchemaValidator` before any is
  written, so a reduction or check that fails leaves the previous tables in
  place together. The `Refresh()` writes are still separate transactions: a
  failure *during* the writes can leave the earlier tables new and the later
  ones old, until the next run rebuilds them all.
- Cost grows with the history kept. On a year of registry history for 100
  pipelines of 10 daily steps (398k records) the whole run takes about 34 s,
  of which the percentile table is about 16 s to build and write (797k rows).
  Pruning the registry keeps it bounded.
- The reductions read the registry's *stored* forms (`warn_hits` as JSON text,
  `committed` as 0/1) directly rather than through `RunRegistry`'s decode; a
  `warn_hits` value that is not a JSON list counts as no hits.
