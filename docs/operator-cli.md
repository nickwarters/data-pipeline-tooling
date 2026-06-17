# The operator CLI — run, orchestrate, status, runs, log

The framework is import-only, but it is also runnable as a tool:
`python -m framework <command>` is the single entry point for both authoring
(`scaffold`, see [adding a feed](adding-a-feed.md)) and operating pipelines. The
operator side is a small command surface for the everyday tasks that would
otherwise need a hand-written wrapper script: **run** a
registered pipeline, **orchestrate** scheduled due work, check its **status**,
list recent **runs**, and inspect a run **log** (issue #99). It is a thin shell
over the public `framework.run` runtime surface (`PipelineRunner`,
`Orchestrator`) and the `RunLog` / `RunRegistry` observability seam —
everything stays local SQLite + JSONL, with no external services
([ADR-0001](adr/0001-sqlite-medallion-store-on-network-share.md),
[ADR-0007](adr/0007-fail-fast-atomic-runs-jsonl-observability.md)).

Run it as a module from the repository root so the import-only `framework`
package resolves on `sys.path`:

```sh
python -m framework <command> ...
```

All commands take the **base directory** of the run store — the same path you
pass to `run`. The runner lays out `<base>/_runs/<case_type>.log` (the JSONL run
logs) and `<base>/_registry/runs.db` (the queryable run registry) underneath it;
`status` / `runs` / `log` read from there. `orchestrate` also writes
`<base>/_orchestration/runs.db`, a separate SQLite decision log for due,
skipped, succeeded, failed, and blocked scheduled items. Actual pipeline
execution records remain in `RunLog` / `RunRegistry` only.

The framework owns the run/orchestrate machinery but not *which* pipelines an
application defines. `run` and `orchestrate` therefore take a **required `--app`**
naming an application module that exposes `build_runner()` and
`build_pipeline_sets()` — for this repo, `pipelines.demo_source_to_selection`.
The framework imports it by name *at runtime*, so the dependency stays one-way —
`pipelines/` depends on `framework`, never the reverse, and the framework carries
no application name of its own. (`runs` / `status` / `log` read the run store
directly and need no `--app`.) The examples below use the demo module.

## `run` — execute a registered pipeline

```sh
python -m framework run <case_type> <pipeline> <base_dir> --app MODULE \
    [--run-date YYYY-MM-DD] [--logical-run-id ID] [--freshness-days N]
```

Runs the domain Pipeline registered for `(case_type, pipeline)`. `--run-date`
sets the run date (defaults to today). `--freshness-days` relaxes the
upstream-freshness window. Exit code is `0` on success, non-zero on a clear error
(see below).

```console
$ python -m framework run cases selection /data --app pipelines.demo_source_to_selection --run-date 2026-05-29
available cases: 3 -> SelectionPool: 2 cases (Question Bank qb-100, logical run cases/selection:2026-05-29); trace: 3 considered, 1 excluded with a reason
```

### Re-driving a business run — `--logical-run-id`

A run's **logical run id** is the idempotency key for its accumulated rows: a
re-run under the *same* logical id replaces that run's rows rather than adding
duplicates, while each execution stays individually traceable by its own
`execution_id` ([ADR-0006](adr/0006-load-idempotency-refresh-upstream-accumulate-downstream.md),
#77). When omitted it defaults to `case_type/pipeline:run_date`, so re-running a
given date is already idempotent.

Pass `--logical-run-id` to re-drive a specific business run explicitly — for
example to reprocess a correction batch under a stable id independent of the
calendar date:

```console
$ python -m framework run cases selection /data --app pipelines.demo_source_to_selection --logical-run-id 2026-05-correction
$ python -m framework run cases selection /data --app pipelines.demo_source_to_selection --logical-run-id 2026-05-correction
```

The second invocation replaces the first run's rows in the SelectionPool (the
`run_id` / `logical_run_id` columns hold `2026-05-correction`); the row count
stays stable instead of doubling.

## `orchestrate` — run scheduled due work

```sh
python -m framework orchestrate <base_dir> --app MODULE \
    [--run-date YYYY-MM-DD] [--once | --loop] [--poll-seconds N]
```

Runs the configured `PipelineSet`s for the given run date. `--once` performs one
due-work pass. `--loop` keeps polling the same run date until work due that day
has settled or the idle poll limit is reached. The current demo configuration is
one `cases` set with `ingest -> selection`, both scheduled on `Weekdays()`.

Schedules are Python definitions owned by the pipeline code. The framework
provides `Weekdays`, `SpecificWeekdays`, `DayOfMonth`,
`NthWorkingDayOfMonth`, `LastWorkingDayOfMonth`, and `ManualOnly`. `Weekdays()`
is the normal "daily" schedule; weekends and holidays are evaluated by
`WorkingDayCalendar`.

Dependencies are freshness-based. A scheduled downstream runs through
`PipelineRunner` only when its declared upstreams have successful history fresh
enough for the run date. A failed scheduled item is terminal for that
orchestrator invocation; its downstream dependants are marked `blocked`, while
independent pipelines in the same set and all other `PipelineSet`s continue.

```console
$ python -m framework orchestrate /data --app pipelines.demo_source_to_selection --run-date 2026-05-29 --once
2026-05-29  cases  cases/ingest  succeeded
2026-05-29  cases  cases/selection  succeeded
```

## `status` — the latest run per pipeline

```sh
python -m framework status <base_dir> [--case-type cases] [--pipeline cases/ingest]
```

With no filter, prints the most recent run summary for **every** pipeline.
`--case-type` narrows to one subject's pipelines; `--pipeline` shows a single
named pipeline's latest run.

```console
$ python -m framework status /data --case-type cases
2026-06-10T09:39:30.627378+00:00  cases/ingest  ok  rows_out=5  [run 5f8ff8c7]
2026-06-10T09:39:30.882733+00:00  cases/selection  ok  rows_out=2  [run fbde70de]
```

## `runs` — recent run history

```sh
python -m framework runs <base_dir> [--pipeline cases/ingest] [--status ok] [--limit N]
```

Lists recent run summaries from the registry, oldest-to-newest, capped to the
most recent `--limit` (default 10). `--pipeline` and `--status` narrow the list.

```console
$ python -m framework runs /data --pipeline cases/ingest --limit 5
2026-06-10T09:39:30.627378+00:00  cases/ingest  ok  rows_out=5  [run 5f8ff8c7]
```

## `log` — inspect a run log file

```sh
python -m framework log <base_dir> <case_type> [--run-id <execution-id-prefix>]
```

Reads `<base>/_runs/<case_type>.log`, prints one line per step record, and ends
with a summary across the runs in the file. `--run-id` filters to a single
execution (a prefix of the execution id — the eight-character id shown by
`status` / `runs` works).

```console
$ python -m framework log /data cases
run log: /data/_runs/cases.log
  cases/ingest  run: ok  rows_in=5  rows_out=5  0.010s
  cases/selection  freshness: ok
  cases/selection  run: ok  rows_in=2  rows_out=2  rows_quarantined=0  rows_excluded=0  0.008s
3 step records across 2 run(s): 0 failed, 0 warned
```

Zero-valued row metrics are printed explicitly because they distinguish a step
that produced, quarantined, or excluded no rows from a metric that does not
apply to that step.

## Errors

The CLI turns the expected failure modes into a clear message on `stderr` and a
non-zero exit code — never an unhandled traceback. `run` and `orchestrate` catch
the whole `PipelineError` family with a single `except` and present it through
`framework.core.format_failure`, which renders the failure kind and its message
as a short ASCII block (a genuine bug is not a `PipelineError`, so it still
surfaces its traceback). The block looks like:

```
Pipeline run failed [ValidationError]
  cases ingest pre-validate failed: missing required column(s): case_id
```

| Situation | Message |
|-----------|---------|
| Unknown pipeline | `unknown pipeline 'nope' for case type 'cases'` |
| Stale upstream | `upstream cases/ingest is stale: latest successful run was …` |
| Validation failure | the `ValidationError` message from the failing check |
| No registry yet (`status` / `runs`) | `no run registry under '/data'; run a pipeline first` |
| No run log (`log`) | `no run log at /data/_runs/cases.log` |

The same `except PipelineError` / `format_failure` pair is what a scaffolded
feed's `main()` uses, so running a feed directly (`python -m pipelines.<feed>.pipeline`)
reports a failed check the same way.
