# The operator CLI — run, orchestrate, status, runs, log

The framework is import-only, but it is also runnable as a tool:
`python -m cli <command>` is the single entry point for both authoring
(`scaffold`, see [adding a feed](adding-a-feed.md)) and operating pipelines. The
operator side is a small command surface for the everyday tasks that would
otherwise need a hand-written wrapper script: **run** a
pipeline by its path, **orchestrate** scheduled due work, check its **status**,
list recent **runs**, and inspect a run **log**. It is a thin shell
over the public `framework.run` runtime surface (`run_pipeline`,
`Orchestrator`) and the `RunLog` / `RunRegistry` observability seam —
everything stays local SQLite + JSONL, with no external services
([ADR-0001](adr/0001-sqlite-per-subject-medallion-store.md),
[ADR-0005](adr/0005-fail-fast-atomic-runs-and-observability.md)).

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
due, skipped, succeeded, failed, and blocked scheduled items. Each decision
carries the `logical_run_id` the pass assigned and the `pipeline_run_id` it read
back, so one orchestration pass joins to every pipeline execution it triggered
(`pipeline_run_id` is the key into the run registry). Actual pipeline execution
records remain in `RunLog` / `RunRegistry` only.

### The base directory — `--base-dir` or `--env`

The base directory is set by the **optional `--base-dir` flag**. Pass it to point
at a root directly, or omit it and let `--env` resolve it from a named
environment — `prod`, `dev`, and so on. Which physical root each environment maps
to is an operational concern, not the framework's, so the mapping lives in the
sibling utility [`tools.environments`](public-api.md): each environment reads its
root from an OS environment variable (`PIPELINE_DATA_DIR_PROD`,
`PIPELINE_DATA_DIR_DEV`, …), so a machine-specific path — a UNC share on Windows,
a local directory on macOS — never has to be committed to source. `dev` falls
back to `./data` so a fresh clone runs out of the box.

```sh
python -m cli run pipelines/ingest --env prod              # base_dir from PIPELINE_DATA_DIR_PROD
python -m cli run pipelines/ingest --env dev               # base_dir from PIPELINE_DATA_DIR_DEV or ./data
python -m cli run pipelines/ingest --base-dir /explicit/path  # an explicit path still wins
```

`--env` defaults to the `PIPELINE_ENV` OS variable, then to `dev`. An explicit
`--base-dir` always wins. An unknown environment, or a known one whose variable
is unset and that has no fallback (e.g. `prod`), exits non-zero with an
actionable message rather than a traceback. The same `--base-dir` / `--env`
choice applies to every command (`run`, `orchestrate`, `runs`, `status`, `log`).

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
python -m cli run pipelines/<name> [--base-dir DIR] [--env ENV] \
    [--run-date YYYY-MM-DD] [--logical-run-id ID] [--freshness-days N] \
    [--param KEY=VALUE ...] [--dry-run]
```

Imports `pipelines.<name>.pipeline` and runs its `run(context)` callable, after
checking any upstreams it declares via `UPSTREAMS`. The pipeline's run-history
identity is its directory name (`<name>`). `--run-date` sets the run date
(defaults to today); `--freshness-days` relaxes the upstream-freshness window.
Exit code is `0` on success, non-zero on a clear error (see below).

```console
$ python -m cli run pipelines/selection --base-dir /data --run-date 2026-05-29
available cases: 3 -> SelectionPool: 2 cases (Question Bank qb-100, logical run selection:2026-05-29); trace: 3 considered, 1 excluded with a reason
```

### Previewing a pipeline — `--dry-run`

Pass `--dry-run` to **preview** a pipeline during local development without
landing anything. The handler runs against real data — every read, transform,
and validation executes — but each write, quarantine commit, and explain trace
is **skipped**, and no run log or run registry is touched. The command prints a
per-step report: the node type and name, the row count, the columns with their
dtypes, a small bounded sample of rows, and the *intent* of each skipped commit
(`would write N row(s)`, `would quarantine N row(s)`).

```console
$ python -m cli run pipelines/ingest --base-dir /data --run-date 2026-05-29 --dry-run
dry run — no artifacts were written
  [Read] read: 5 rows
      columns: case_ref:str, adviser:str, activity_date:str, amount:int64
      case_ref=c1, adviser=adv-a, activity_date=2026-05-29, amount=500
      ...
  [Write] write: 5 rows
      ...
      would write 5 row(s)
```

A dry run **reads against committed data**: it skips the *current* run's writes,
so a later hop that reads an intermediate store sees what is already on disk, not
what this dry run would have written. Land the upstream hops for real once, then
preview — previewing a brand-new feed whose own raw store does not exist yet only
previews up to that first read.

An error-severity validation failure stops the run fast (the AC's documented
behaviour): the preview still prints every step up to the failure with a clear
`FAILED: <reason>` note, the `stopped:` line names the error, and the exit code
is non-zero — same fail-fast contract as a real run, without writing anything.

### Re-driving a business run — `--logical-run-id`

A run's **logical run id** is the idempotency key for its accumulated rows: a
re-run under the *same* logical id replaces that run's rows rather than adding
duplicates, while each execution stays individually traceable by its own
`pipeline_run_id` ([ADR-0004](adr/0004-per-feed-load-strategy-owned-by-writer.md)). When omitted it defaults to `<pipeline>:run_date`, so re-running a
given date is already idempotent.

Pass `--logical-run-id` to re-drive a specific business run explicitly — for
example to reprocess a correction batch under a stable id independent of the
calendar date:

```console
$ python -m cli run pipelines/selection --base-dir /data --logical-run-id 2026-05-correction
$ python -m cli run pipelines/selection --base-dir /data --logical-run-id 2026-05-correction
```

The second invocation replaces the first run's rows in the SelectionPool (the
`logical_run_id` column holds `2026-05-correction`); the row count
stays stable instead of doubling.

### Passing run parameters — `--param`

Pass one or more `--param KEY=VALUE` entries when a path-addressed pipeline
needs an explicit run input without discovering it internally. The parameters
arrive as `context.params`:

```console
$ python -m cli run pipelines/claims --base-dir /data \
    --run-date 2026-06-22 \
    --logical-run-id claims:ingest:20260622:claims_20260622_a.csv \
    --param source_file=/share/upstream/claims/claims_20260622_a.csv
```

```python
from framework.io import CsvReader
from framework.run import RunContext


def run(context: RunContext):
    source_file = context.params["source_file"]
    return raw_builder(CsvReader(source_file), writer).run(context=context)
```

Run parameters are recorded on the run summary in the JSONL run log for
diagnosis; values whose keys look sensitive, such as `password`, `secret`,
`token`, `credential`, or `key`, are redacted by default.

## `orchestrate` — run scheduled due work

```sh
python -m cli orchestrate [--base-dir DIR] [--env ENV] --app MODULE \
    [--run-date YYYY-MM-DD] [--once | --loop] [--poll-seconds N]
```

Runs the configured `PipelineSet`s for the given run date. `--once` performs one
due-work pass. `--loop` keeps polling the same run date until work due that day
has settled or the idle poll limit is reached.

> **Note:** when `run` moved to path-addressing, the demo's `--app` orchestration
> wiring (`build_runner()` / `build_pipeline_sets()`) was removed; re-expressing
> orchestrate's schedules over path-addressed pipelines is a known follow-up.
> The command and its `--app` contract are unchanged for a real application that
> still supplies a registry module.

Schedules are Python definitions owned by the pipeline code. The framework
provides `Weekdays`, `SpecificWeekdays`, `DayOfMonth`,
`NthWorkingDayOfMonth`, `LastWorkingDayOfMonth`, and `ManualOnly`. `Weekdays()`
is the normal "daily" schedule; weekends and holidays are evaluated by
`WorkingDayCalendar`.

For everyday authoring, prefer the friendly `Schedule.*` constructors over the
implementation class names and weekday ordinals — they read as operator language
and produce exactly the same schedules:

```python
from tools.orchestration import Schedule, ScheduledPipeline

ScheduledPipeline("claims", "ingest", Schedule.daily())

ScheduledPipeline(
    "claims",
    "weekly_quality_check",
    Schedule.on_weekdays("monday", "wednesday"),  # case-insensitive names
)

ScheduledPipeline("claims", "monthly_snapshot", Schedule.day_of_month(21))

ScheduledPipeline("claims", "month_open", Schedule.nth_working_day_of_month(1))

ScheduledPipeline("claims", "month_close", Schedule.last_working_day_of_month())

ScheduledPipeline("claims", "ad_hoc_backfill", Schedule.manual_only())
```

`Schedule.on_weekdays(...)` accepts the full English weekday names
(`"monday"` … `"sunday"`) case-insensitively; an unknown weekday name or an
out-of-range month day fails immediately with a clear message. `is_due(run_date,
calendar)` stays the core protocol — these constructors are ergonomics only and
leave the orchestration semantics unchanged.

Dependencies are requirement-based. A scheduled downstream runs through
`PipelineRunner` only when its declared `Requirement` predicates, or legacy
`FreshnessRequirement` dependencies, have successful upstream history fresh
enough for the run date. Requirements can target a whole Pipeline or a task-level
`RunAddress`, for example
`Requirement.succeeded(RunAddress.task("pipeline-2", "step-4", subject="case-a")).within_days(7)`.
A failed scheduled item is terminal for that orchestrator invocation; its
downstream dependants are marked `blocked`, while independent pipelines in the
same set and all other `PipelineSet`s continue. Blocked decisions include the
stale, missing, or failed upstream reason in `<base>/_orchestration/runs.db`.

```console
$ python -m cli orchestrate --base-dir /data --app my_app.pipelines --run-date 2026-05-29 --once
2026-05-29  cases  cases/ingest  succeeded
2026-05-29  cases  cases/selection  succeeded
```

## Orchestration plan preview — `Orchestrator.plan()`

Before running `orchestrate`, you can preview what would happen for a given run
date without executing any pipelines or touching any log file. Call
`Orchestrator.plan(base_dir, run_date=...)` from Python — it reads the existing
run registry and returns a `PlanResult` whose items describe each scheduled
pipeline's projected status:

| Status | Meaning |
|--------|---------|
| `ready` | schedule is due and all freshness requirements are met |
| `skipped` | schedule is not due on that date |
| `disabled` | item has `enabled=False` |
| `already-satisfied` | pipeline already succeeded on the run date |
| `blocked` | a declared upstream is stale or missing |

```python
from tools.orchestration import Orchestrator

result = orchestrator.plan("/data", run_date=dt.date(2026, 6, 23))
print(result)
```

```
2026-06-23  claims  claims/ingest          ready              schedule daily is due
2026-06-23  claims  claims/quality_check   skipped            schedule monday,wednesday is not due on tuesday
2026-06-23  claims  claims/month_open      already-satisfied  already succeeded on 2026-06-23
2026-06-23  claims  claims/reporting       blocked            upstream claims/ingest is stale: ...
```

`str(result)` renders an aligned table using only stdlib; columns are sized to
the widest value so the output stays readable regardless of pipeline name length.

For per-file source artifact planning (catch-up scenarios where a backlog of
files needs processing), use the standalone `plan_for_each()` helper:

```python
from tools.orchestration import plan_for_each

items = plan_for_each(
    source_files=["share/claims_20260601.csv", "share/claims_20260602.csv"],
    subject="claims",
    pipeline="ingest",
    set_name="claims",
    run_date=dt.date(2026, 6, 23),
    file_id_fn=lambda f: Path(f).name,
)
# Each item: status="ready", reason="source file: claims_20260601.csv"
```

`plan_for_each()` returns one `PlanItem(status="ready")` per source file without
consulting run history or calling any handler — it is a pure projection of
planned per-file runs.

> **Note:** CLI dry-run support for the `run` and `orchestrate` commands (passing
> `--dry-run` / `--plan` on the command line) is a known follow-up.

## `status` — the latest run per pipeline

```sh
python -m cli status [--base-dir DIR] [--env ENV] [--case-type cases] [--pipeline cases/ingest]
```

With no filter, prints the most recent run summary for **every** pipeline.
`--pipeline` shows a single pipeline's latest run by its run-history label;
`--case-type` narrows to one subject's pipelines (the `subject/` prefix
orchestrate records under).

```console
$ python -m cli status --base-dir /data
2026-06-10T09:39:30.627378+00:00  ingest  ok  rows_out=5  [run 5f8ff8c7]
2026-06-10T09:39:30.882733+00:00  selection  ok  rows_out=2  [run fbde70de]
```

## `runs` — recent run history

```sh
python -m cli runs [--base-dir DIR] [--env ENV] [--pipeline ingest] [--status ok] [--limit N]
```

Lists recent run summaries from the registry, oldest-to-newest, capped to the
most recent `--limit` (default 10). `--pipeline` and `--status` narrow the list.

```console
$ python -m cli runs --base-dir /data --pipeline ingest --limit 5
2026-06-10T09:39:30.627378+00:00  ingest  ok  rows_out=5  [run 5f8ff8c7]
```

## `log` — inspect a run log file

```sh
python -m cli log <pipeline> [--base-dir DIR] [--env ENV] [--pipeline-run-id <prefix>]
```

Reads `<base>/_runs/<pipeline>.log` (path-addressed runs partition the log per
pipeline name), prints one line per step record, and ends with a summary across
the runs in the file. `--pipeline-run-id` filters to a single execution (a prefix
of the pipeline run id — the eight-character id shown by `status` / `runs` works).

```console
$ python -m cli log selection --base-dir /data
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
