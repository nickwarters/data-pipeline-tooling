# The operator CLI — run, orchestrate, status, runs, log

The framework is import-only, but it is also runnable as a tool:
`python -m cli <command>` is the single entry point for both authoring
(`scaffold`, see [adding a feed](adding-a-feed.md)) and operating pipelines. The
operator side is a small command surface for the everyday tasks that would
otherwise need a hand-written wrapper script: **run** a
pipeline by its path, **orchestrate** scheduled due work, check its **status**,
list recent **runs**, and inspect a run **log** (issue #99). It is a thin shell
over the public `framework.run` runtime surface (`run_pipeline`,
`Orchestrator`) and the `RunLog` / `RunRegistry` observability seam —
everything stays local SQLite + JSONL, with no external services
([ADR-0001](adr/0001-sqlite-medallion-store-on-network-share.md),
[ADR-0007](adr/0007-fail-fast-atomic-runs-jsonl-observability.md)).

Run it as a module from the repository root so the import-only `framework`
package resolves on `sys.path`:

```sh
python -m cli <command> ...
```

All commands take the **base directory** of the run store — the same path you
pass to `run`. The runner lays out `<base>/_runs/<pipeline>.log` (the JSONL run
logs, one per pipeline) and `<base>/_registry/runs.db` (the queryable run
registry) underneath it; `status` / `runs` / `log` read from there. `orchestrate`
also writes `<base>/_orchestration/runs.db`, a separate SQLite decision log for
due, skipped, succeeded, failed, and blocked scheduled items. Actual pipeline
execution records remain in `RunLog` / `RunRegistry` only.

`run` addresses a pipeline by **its location on disk**: `pipelines/orders` maps
to the module `pipelines.orders.pipeline`, imported *at runtime*, whose
`run(context)` callable the framework executes (reading an optional `UPSTREAMS`
tuple of freshness requirements). The dependency stays one-way — the framework
imports the pipeline by path at runtime, so `pipelines/` depends on `framework`,
never the reverse. `orchestrate` still needs *which* pipelines an application
schedules, so it alone takes a **required `--app`** naming a module that exposes
`build_runner()` and `build_pipeline_sets()`. (`runs` / `status` / `log` read the
run store directly and need neither.)

## `run` — execute a pipeline by its path

```sh
python -m cli run pipelines/<name> <base_dir> \
    [--run-date YYYY-MM-DD] [--logical-run-id ID] [--freshness-days N]
```

Imports `pipelines.<name>.pipeline` and runs its `run(context)` callable, after
checking any upstreams it declares via `UPSTREAMS`. The pipeline's run-history
identity is its directory name (`<name>`). `--run-date` sets the run date
(defaults to today); `--freshness-days` relaxes the upstream-freshness window.
Exit code is `0` on success, non-zero on a clear error (see below).

```console
$ python -m cli run pipelines/selection /data --run-date 2026-05-29
available cases: 3 -> SelectionPool: 2 cases (Question Bank qb-100, logical run selection:2026-05-29); trace: 3 considered, 1 excluded with a reason
```

### Re-driving a business run — `--logical-run-id`

A run's **logical run id** is the idempotency key for its accumulated rows: a
re-run under the *same* logical id replaces that run's rows rather than adding
duplicates, while each execution stays individually traceable by its own
`execution_id` ([ADR-0006](adr/0006-load-idempotency-refresh-upstream-accumulate-downstream.md),
#77). When omitted it defaults to `<pipeline>:run_date`, so re-running a
given date is already idempotent.

Pass `--logical-run-id` to re-drive a specific business run explicitly — for
example to reprocess a correction batch under a stable id independent of the
calendar date:

```console
$ python -m cli run pipelines/selection /data --logical-run-id 2026-05-correction
$ python -m cli run pipelines/selection /data --logical-run-id 2026-05-correction
```

The second invocation replaces the first run's rows in the SelectionPool (the
`run_id` / `logical_run_id` columns hold `2026-05-correction`); the row count
stays stable instead of doubling.

## `orchestrate` — run scheduled due work

```sh
python -m cli orchestrate <base_dir> --app MODULE \
    [--run-date YYYY-MM-DD] [--once | --loop] [--poll-seconds N]
```

Runs the configured `PipelineSet`s for the given run date. `--once` performs one
due-work pass. `--loop` keeps polling the same run date until work due that day
has settled or the idle poll limit is reached.

> **Note:** when `run` moved to path-addressing, the demo's `--app` orchestration
> wiring (`build_runner()` / `build_pipeline_sets()`) was removed; re-expressing
> orchestrate's schedules over path-addressed pipelines is tracked in issue #197.
> The command and its `--app` contract are unchanged for a real application that
> still supplies a registry module.

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
$ python -m cli orchestrate /data --app my_app.pipelines --run-date 2026-05-29 --once
2026-05-29  cases  cases/ingest  succeeded
2026-05-29  cases  cases/selection  succeeded
```

## `status` — the latest run per pipeline

```sh
python -m cli status <base_dir> [--case-type cases] [--pipeline cases/ingest]
```

With no filter, prints the most recent run summary for **every** pipeline.
`--pipeline` shows a single pipeline's latest run by its run-history label;
`--case-type` narrows to one subject's pipelines (the `subject/` prefix
orchestrate records under).

```console
$ python -m cli status /data
2026-06-10T09:39:30.627378+00:00  ingest  ok  rows_out=5  [run 5f8ff8c7]
2026-06-10T09:39:30.882733+00:00  selection  ok  rows_out=2  [run fbde70de]
```

## `runs` — recent run history

```sh
python -m cli runs <base_dir> [--pipeline ingest] [--status ok] [--limit N]
```

Lists recent run summaries from the registry, oldest-to-newest, capped to the
most recent `--limit` (default 10). `--pipeline` and `--status` narrow the list.

```console
$ python -m cli runs /data --pipeline ingest --limit 5
2026-06-10T09:39:30.627378+00:00  ingest  ok  rows_out=5  [run 5f8ff8c7]
```

## `log` — inspect a run log file

```sh
python -m cli log <base_dir> <pipeline> [--run-id <execution-id-prefix>]
```

Reads `<base>/_runs/<pipeline>.log` (path-addressed runs partition the log per
pipeline name), prints one line per step record, and ends with a summary across
the runs in the file. `--run-id` filters to a single execution (a prefix of the
execution id — the eight-character id shown by `status` / `runs` works).

```console
$ python -m cli log /data selection
run log: /data/_runs/selection.log
  selection  freshness: ok
  selection  run: ok  rows_in=2  rows_out=2  rows_quarantined=0  rows_excluded=0  0.008s
2 step records across 1 run(s): 0 failed, 0 warned
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
| Unknown pipeline path (`run`) | `no pipeline at 'pipelines/nope': cannot import 'pipelines.nope.pipeline' …` |
| Module without a `run` callable | `pipeline 'pipelines/x' (pipelines.x.pipeline) defines no run(context) callable` |
| Stale upstream | `upstream ingest is stale: latest successful run was …` |
| Validation failure | the `ValidationError` message from the failing check |
| No registry yet (`status` / `runs`) | `no run registry under '/data'; run a pipeline first` |
| No run log (`log`) | `no run log at /data/_runs/<pipeline>.log` |

The same `except PipelineError` / `format_failure` pair is what a scaffolded
feed's `main()` uses, so running a feed directly (`python -m pipelines.<feed>.pipeline`)
reports a failed check the same way.

For the full operator loop from one of these failures back to a green run —
investigate, diagnose, resolve, and re-drive idempotently — see
[resolving-a-failed-run.md](resolving-a-failed-run.md).
