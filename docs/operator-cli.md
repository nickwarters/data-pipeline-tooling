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
([the SQLite per-subject medallion store](adr/0001-sqlite-per-subject-medallion-store.md),
[structured JSONL observability](adr/0005-fail-fast-atomic-runs-and-observability.md)).

Run it as a module from the repository root so the import-only `framework`
package resolves on `sys.path`:

```sh
python -m cli <command> ...
```

All commands take the **base directory** of the run store — the same path you
pass to `run`. The layout underneath it has one owner in code, `RunStore`
(`tools/observability/run_store.py`), and nothing else spells the
fragments out:

| Path | What |
|------|------|
| `<base>/_runs/<pipeline>.log` | the JSONL run logs, one per subject / path-addressed pipeline |
| `<base>/_registry/runs.db` | the queryable run registry those logs are ingested into |
| `<base>/_orchestration/runs.db` | the scheduled-work decision log |

A base directory holds one further category the CLI does not read: source
**control state** under `<base>/_checkpoints/`
([adding-a-feed.md](adding-a-feed.md#sharepointcheckpointstorebase_dir--where-the-polling-got-to)).

`status` / `runs` / `log` read from there. `orchestrate`
also writes `<base>/_orchestration/runs.db`, a separate SQLite decision log for
due, skipped, succeeded, failed, and blocked scheduled items. Each decision
carries the `logical_run_id` the pass assigned and the `pipeline_run_id` it read
back, so one orchestration pass joins to every pipeline execution it triggered
(`pipeline_run_id` is the key into the run registry). Actual pipeline execution
records remain in `RunLog` / `RunRegistry` only.

The read-only commands (`status`, `runs`, `log`) are **safe to run while
pipelines are running**. Opening a registry and migrating it are separate
steps: against an up-to-date file a query opens a connection and reads
without executing a single write statement, so it takes no write lock and cannot
collide with a running pipeline's commit. The exception is the *first* open of a
file that is behind — that one still migrates, and so still writes; if a
concurrent writer holds the file it fails loudly rather than reading a
half-migrated table. (WAL is unavailable on a
network share, so a writer's lock is exclusive; before the split,
every read ran the schema migration first and briefly locked the file against
every concurrent writer.)

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
never the reverse. **`orchestrate` addresses pipelines exactly the same way** —
each scheduled item names a `pipelines/<name>` path — so it needs no pre-wired
handler registry. It still needs *which* pipelines an application schedules and
when, so it alone takes a **required `--app`** naming a module that exposes
`build_pipeline_sets()` (the schedules). (`runs` / `status` / `log` read the run
store directly and need neither.)

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

`run` **bypasses schedule due-ness entirely** — it does not consult any
`--app` schedules, so a pipeline scheduled on working days will still execute if
you invoke it directly on a Sunday. It also writes no `_orchestration/runs.db`
decision, so a direct re-drive is absent from the day's orchestration audit trail
(it is still in the run registry, which `runs` and `status` read).

```console
$ python -m cli run pipelines/selection --base-dir /data --run-date 2026-05-29
available cases: 3 -> SelectionPool: 2 cases (Question Bank qb-100, logical run selection:2026-05-29); trace: 3 considered, 1 excluded with a reason
```

### Previewing a pipeline — `--dry-run`

Pass `--dry-run` to **preview** a pipeline during local development without
landing anything. The handler runs against real data — every read, transform,
and validation executes — but every side effect is **skipped**: each write,
quarantine commit and explain trace, and any `action` step (its callable is not
called, since the framework cannot see what side effect it would have). No run
log or run registry is touched either. The command prints a per-step report: the
node type and name, the row count, the columns with their dtypes, a small bounded
sample of rows, and the *intent* of each skipped side effect (`would write N
row(s)`, `would quarantine N row(s)`, `would run action <name>`).

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

A preview runs the handler exactly as a real run does apart from the commits, so
`--param` applies to `--dry-run` too: `context.params` holds the same values
under both, and a pipeline that reads `context.params["source_file"]` previews
without error. The no-write promise covers **every** composition, not just
a single `Pipeline`: a `ForEach` fan-out previews each item — its per-item
contexts are derived from the dry-run context, so they carry the flag — and the
one report accumulates the steps of every item.

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
`pipeline_run_id`
([accumulation is idempotent by logical run](adr/0004-per-feed-load-strategy-owned-by-writer.md)).
When omitted it defaults to `<pipeline>:run_date`, so re-running a
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
    [--run-date YYYY-MM-DD] [--once | --loop] [--poll-seconds N] \
    [--calendar FILE]
```

Runs the configured `PipelineSet`s for the given run date. `--once` performs one
due-work pass and is the default when neither mode is named. `--loop` keeps
polling the same run date until work due that day has settled or the idle poll
limit is reached.

A `--app` that names a module which cannot be imported, or which exposes no
`build_pipeline_sets()`, is a configuration error: it exits non-zero with the
same clean, traceback-free message every other CLI failure prints.

### Seeding the working-day calendar — `--calendar`

Every schedule judges its run date against a `WorkingDayCalendar`. `--calendar`
points at the YAML file that seeds it:

```yaml
# holidays.yml
weekend: [saturday, sunday]   # optional; this is the default
holidays:
  - 2026-01-01                # New Year's Day
  - 2026-12-25                # Christmas Day
```

```sh
python -m cli orchestrate --app case_review.schedules --env prod --once \
    --calendar holidays.yml
```

Omit the flag and the calendar is the default: **weekends only, no holidays**.
The full file format, the date-parsing rules and the error messages are in
[working-day-calendar.md](working-day-calendar.md#from-a-calendar-file--workingdaycalendarfrom_yamlpath).

The same file drives every schedule that consults the calendar — `Weekdays`,
`DayOfMonth`, `NthWorkingDayOfMonth` and `LastWorkingDayOfMonth`. The month-walk
schedules *count* their working days against it, so seeding the 1st of a month
as a holiday makes `NthWorkingDayOfMonth(1)` due on the 2nd instead.

A skipped item's reason names the aspect of the date its schedule judged, not
the calendar entry: a daily schedule skipping a Monday holiday prints
`schedule daily is not due on monday`.

`orchestrate` runs the **same path-addressed pipelines** as `run`. Each
`ScheduledPipeline` names a `pipelines/<name>` path; when it comes due the
orchestrator imports `pipelines.<name>.pipeline` at runtime and executes its
`run(context)` callable — composing the module's `UPSTREAMS` with the schedule's
own `depends_on` requirements. So an application supplies only the *schedules*
via `--app`; there is no handler registry to wire up. The `--app` module exposes
one function:

```python
# my_app/schedules.py
from framework.run import FreshnessRequirement
from tools.orchestration import PipelineSet, Schedule, ScheduledPipeline


def build_pipeline_sets():
    return (
        PipelineSet(
            "claims",
            (
                ScheduledPipeline("pipelines/claims_ingest", Schedule.daily()),
                ScheduledPipeline(
                    "pipelines/claims_selection",
                    Schedule.daily(),
                    depends_on=(FreshnessRequirement("claims_ingest"),),
                ),
            ),
        ),
    )
```

```sh
python -m cli orchestrate --app my_app.schedules --base-dir /data --run-date 2026-05-29 --once
```

The real `--app` module in this repository is
[`case_review/schedules.py`](../case_review/schedules.py), which puts the
`sharepoint_cases` feed on `Schedule.daily()`:

```sh
python -m cli orchestrate --app case_review.schedules --base-dir /data/case-review --once
```

Repeated `--once` passes on the same day are safe — the schedule gates the *day*
and a polling feed's watermark gates the *data*. That, and why the feed cannot
yet reach a tenant, are in
[sharepoint-rest-ingest.md](sharepoint-rest-ingest.md#2-the-daily-command).

A scheduled item's `pipelines/<name>` path lines up one-to-one with a pipeline
package on disk, and its run-history label is that path's **leaf name** — the
same identity `run`, `status`, `runs`, and `log` all key on. A `depends_on`
requirement targets an upstream by that leaf name too:

```
pipelines/
  claims_ingest/            # ScheduledPipeline("pipelines/claims_ingest", …)
    pipeline.py             #   run(context), optional UPSTREAMS
  claims_selection/         # ScheduledPipeline("pipelines/claims_selection", …)
    pipeline.py             #   depends_on=(FreshnessRequirement("claims_ingest"),)
```

Schedules are Python definitions owned by the pipeline code. The framework
provides `Weekdays`, `SpecificWeekdays`, `DayOfMonth`,
`NthWorkingDayOfMonth`, `LastWorkingDayOfMonth`, and `ManualOnly`. `Weekdays()`
is the normal "daily" schedule; weekends and holidays are evaluated by
`WorkingDayCalendar`, seeded by `--calendar`.

For everyday authoring, prefer the friendly `Schedule.*` constructors over the
implementation class names and weekday ordinals — they read as operator language
and produce exactly the same schedules:

```python
from tools.orchestration import Schedule, ScheduledPipeline

ScheduledPipeline("pipelines/claims_ingest", Schedule.daily())

ScheduledPipeline(
    "pipelines/weekly_quality_check",
    Schedule.on_weekdays("monday", "wednesday"),  # case-insensitive names
)

ScheduledPipeline("pipelines/monthly_snapshot", Schedule.day_of_month(21))

ScheduledPipeline("pipelines/month_open", Schedule.nth_working_day_of_month(1))

ScheduledPipeline("pipelines/month_close", Schedule.last_working_day_of_month())

ScheduledPipeline("pipelines/ad_hoc_backfill", Schedule.manual_only())
```

`Schedule.on_weekdays(...)` accepts the full English weekday names
(`"monday"` … `"sunday"`) case-insensitively; an unknown weekday name or an
out-of-range month day fails immediately with a clear message. `is_due(run_date,
calendar)` stays the core protocol — these constructors are ergonomics only and
leave the orchestration semantics unchanged.

Dependencies are requirement-based. A scheduled downstream runs only when its
declared `Requirement` predicates, or legacy `FreshnessRequirement` dependencies,
have successful upstream history fresh enough for the run date. An upstream is
identified by its leaf name — the same run-history label it records under — so a
requirement can target a whole Pipeline or a task-level `RunAddress`, for example
`Requirement.succeeded(RunAddress.task("claims_ingest", "normalise")).within_days(7)`.
A failed scheduled item is terminal for that orchestrator invocation; its
downstream dependants are marked `blocked`, while independent pipelines in the
same set and all other `PipelineSet`s continue. Blocked decisions include the
stale, missing, or failed upstream reason in `<base>/_orchestration/runs.db`.

### Run order within a set

A `ScheduledPipeline` may declare three optional ordering inputs. They influence
only the **sequence** runnable items are attempted in, never whether an item may
run — that stays the freshness rule's question alone.

| Field | Type | Meaning |
|-------|------|---------|
| `due_time` (also spelled `deadline`) | `"HH:MM"` | The time of day this should be finished by. The closer to, or further past, the deadline, the earlier it is attempted. |
| `earliest_run` | `"HH:MM"` | Do not attempt before this time of day. |
| `priority` | `int` | Higher wins. A tie-breaker only, with no time meaning. |

Both times are zero-padded 24-hour strings and are parsed when the item is
constructed; `"9:5"`, `"24:00"` and `"0900"` all fail at start-up, naming the
value.

```python
from tools.orchestration import PipelineSet, Schedule, ScheduledPipeline
from framework.run import FreshnessRequirement


def build_pipeline_sets():
    return (
        PipelineSet(
            "claims",
            (
                # No deadline of its own: it inherits claims_selection's 09:00.
                ScheduledPipeline("pipelines/claims_ingest", Schedule.daily()),
                ScheduledPipeline(
                    "pipelines/claims_selection",
                    Schedule.daily(),
                    depends_on=(FreshnessRequirement("claims_ingest"),),
                    due_time="09:00",
                ),
                # Cheap, no deadline, but jump the other deadline-free work.
                ScheduledPipeline(
                    "pipelines/claims_reference", Schedule.daily(), priority=10
                ),
                # The source file does not land before the evening.
                ScheduledPipeline(
                    "pipelines/claims_recon",
                    Schedule.daily(),
                    earliest_run="18:00",
                ),
            ),
        ),
    )
```

The order is derived on **every pass**, from the candidates, the wall clock, and
which items already succeeded today. The whole rule, in order:

1. **Dependencies dominate.** No deadline and no priority can move an item ahead
   of an upstream in the same set that is also due this pass.
2. **A deadline inherits up the `depends_on` graph.** An item with no `due_time`
   takes the tightest deadline of whatever depends on it, transitively, so
   `claims_ingest` above is run in time for `claims_selection`. Only items due
   today contribute.
3. **Deadline pressure.** Overdue items first, most overdue first; then items
   with a deadline still ahead, soonest first; then everything else. An item
   that already succeeded today exerts no deadline pressure at all.
4. **`priority`**, higher first, breaking a tie between equal deadlines.
5. **Declared order**, breaking everything else. A set declaring none of these
   fields therefore keeps exactly its existing order.

Items that are not due work at all — disabled, or whose schedule is not due — are
reported after the day's work, in declared order.

An item before its `earliest_run` is recorded `skipped` with the window in its
reason (`before earliest_run 18:00`). The gate is evaluated per pass and
**nothing sleeps waiting for it**: a `--loop` orchestration whose remaining work
is all gated will settle for the day before the window opens. Run a later
`--once` (or a later cron-driven `--loop`) for that work. `due_time` is likewise
a time on the run date only — there is no next-day deadline, so `00:30` read at
`23:50` is maximally overdue for that date. The reasoning is
[ADR-0017](adr/0017-run-order-is-derived-per-pass-not-declared.md).

The YAML overrides file cannot yet set these three fields; that gap is tracked
in issue #429.

Each output line is `run_date  set_name  pipeline  status`, where `pipeline` is
the scheduled item's leaf name, followed by the decision's reason when it has
one:

```console
$ python -m cli orchestrate --base-dir /data --app my_app.schedules --run-date 2026-05-29 --once
2026-05-29  claims  claims_ingest  succeeded
2026-05-29  claims  claims_selection  succeeded
2026-05-29  claims  claims_month_close  skipped  schedule last working day of month is not due on 2026-05-29
```

The `status` vocabulary is unchanged — `succeeded`, `failed`, `blocked`,
`skipped` — and `reason` is prose written for you to read. Nothing in
the orchestrator branches on that prose: whether an item counted as *due work*
for the run date is carried by a separate `was_due` flag on the decision, stored
alongside it in `<base>/_orchestration/runs.db`. That flag is what `--loop` uses
to decide the day's work has settled, so a reworded message can no longer change
when an orchestration stops polling. Disabled and not-due items are the ones
recorded with `was_due = 0`; rows written before the flag existed read back
`NULL` (see [run-log-format.md](run-log-format.md)).

The not-due reason names the schedule that was not due, in that schedule's own
terms: a weekday schedule names the weekday, a monthly one names the date. It
used to describe every schedule in weekday language, so a day-of-month schedule
reported "is not due on monday".

## Orchestration plan preview — `Orchestrator.plan()`

Before running `orchestrate`, you can preview what would happen for a given run
date without executing any pipelines or touching any log file. Call
`Orchestrator.plan(base_dir, run_date=...)` from Python — it reads the existing
run registry and returns a `PlanResult` whose items describe each scheduled
pipeline's projected status:

| Status | Meaning |
|--------|---------|
| `ready` | schedule is due and all freshness requirements are met |
| `skipped` | schedule is not due on that date, or the current time is before the item's `earliest_run` |
| `disabled` | item has `enabled=False` |
| `already-satisfied` | pipeline already succeeded on the run date |
| `blocked` | a declared upstream is stale or missing |

```python
from tools.orchestration import Orchestrator

result = orchestrator.plan("/data", run_date=dt.date(2026, 6, 23))
print(result)
```

```
2026-06-23  claims  claims_ingest         ready              schedule daily is due; due by 09:00 (inherited from claims_reporting)
2026-06-23  claims  claims_reporting      blocked            upstream claims_ingest is stale: ...
2026-06-23  claims  claims_month_open     already-satisfied  already succeeded on 2026-06-23
2026-06-23  claims  claims_quality_check  skipped            schedule monday,wednesday is not due on tuesday
```

Rows are in the order the pass would attempt them, and a `ready` item's reason
carries the deadline in force — including which dependent it was inherited from.

`str(result)` renders an aligned table using only stdlib; columns are sized to
the widest value so the output stays readable regardless of pipeline name length.

> **`already-satisfied` is a projection `run_due_once` does not honour.** The
> plan reads run history and reports a pipeline that already succeeded on the run
> date; a `--once` pass does not — its "already ran" guard is local to the single
> pass, so the next `--once` **will re-run** that pipeline. For an idempotent
> feed that is harmless and is exactly what makes repeated same-day operation
> safe; the divergence between the two is tracked in issue #404, which **remains
> open**. Run ordering does not narrow it: the pass reads run history to decide
> whether a deadline still presses, and for nothing else. "Has it run
> today" never gates execution.

The **order** of the rows above is not a separate promise to keep — the plan and
the pass read one derivation. Both iterate the sequence
`order_run_candidates` returns for each set, so a preview cannot claim an order
the pass would not follow. Which items are eligible this pass (`earliest_run`)
comes from that same call, so a gated item reads identically in both.

A `blocked` reason here is produced by the *same* freshness rule the run itself
applies — `evaluate_requirement` in `framework.run.freshness`, of which the
runner's `FreshnessGuard` is the side-effecting wrapper. The preview used to
carry its own copy, which had already drifted (it omitted the `for <pipeline>`
that the guard's message ends with), so the same condition read differently
depending on which command you ran. A `blocked` item's *wording* now matches what
the run would say by construction rather than by discipline. That is a promise
about freshness reasons specifically — not about the whole plan, which still
diverges on `already-satisfied` (see the note above).

For per-file source artifact planning (catch-up scenarios where a backlog of
files needs processing), use the standalone `plan_for_each()` helper:

```python
from tools.orchestration import plan_for_each

items = plan_for_each(
    source_files=["share/claims_20260601.csv", "share/claims_20260602.csv"],
    pipeline="claims_ingest",
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
python -m cli status [--base-dir DIR] [--env ENV] [--subject cases] [--pipeline ingest]
```

With no filter, prints the most recent run summary for **every** pipeline.
`--pipeline` shows a single pipeline's latest run by its run-history label — the
leaf name a path-addressed pipeline records under. `--subject` narrows to
labels carrying a `subject/` prefix (legacy subject-qualified runs); path-addressed
runs use bare leaf names, so filter those with `--pipeline`.

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

The `data_locations` field — the file(s) or table(s) a read or write step
actually touched — is in the JSONL but is deliberately not rendered on these
lines: a glob read carries one entry per matched file. Read the log file itself,
or the run registry, to answer "which file produced this run?".

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
| Missing calendar file (`orchestrate --calendar`) | `no calendar file at '/etc/holidays.yml'` |
| Malformed calendar file (`orchestrate --calendar`) | `calendar file '/etc/holidays.yml': holidays[0] must be a YYYY-MM-DD date, got 'not-a-date'` |

The same `except PipelineError` / `format_failure` pair is what a scaffolded
feed's `main()` uses, so running a feed directly (`python -m pipelines.<feed>.pipeline`)
reports a failed check the same way.

For the full operator loop from one of these failures back to a green run —
investigate, diagnose, resolve, and re-drive idempotently — see
[resolving-a-failed-run.md](resolving-a-failed-run.md).
