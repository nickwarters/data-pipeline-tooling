# Operating the `sharepoint_cases` REST ingest

The operator runbook for the polling feed: how it is scheduled, when to re-drive
it, and what REST polling cannot tell you. It owns the feed's operating and
recovery procedure; the mechanisms underneath it — the window rule, the schema —
are linked from here rather than restated.

## 1. Do not attach this to an external scheduler yet

The feed cannot reach a tenant: `_resolve_client` has no organisational client to
hand back, and the `SITE` and per-`CaseList` `list_id` values in `schema.py` are
placeholders, so every working-day pass ends `failed` today with a
`config`-category `NoClientError`.

What must be wired first, in what order, and how to verify each step is
[sharepoint-cases-going-live.md](sharepoint-cases-going-live.md). Everything
below describes the feed once that is done.

## 2. The daily command

```sh
python -m cli orchestrate --app case_review.schedules --base-dir /data/case-review --once
```

`case_review/schedules.py` puts the feed on `Schedule.daily()` — every working
day, one `PipelineSet` named `case_management`.

**Running it at 09:00, 10:00 and 11:00 on the same working day is intended and
safe.** The two questions are answered in two places: the schedule answers only
*is today a working day?*, and the feed's durable watermark answers *what changed
since the last successful poll?* A pass with nothing new to fetch still polls,
finds no rows, rebuilds gold and advances the watermark — cheap and convergent.
(A pass repeated *inside* the safety lag gets no window at all and stops before
writing anything.) Each pass appends its own decision row to
`<base>/_orchestration/runs.db`, so the audit trail shows every invocation.

`--loop` settles the day's due work and then stops. It is **not** an hourly
daemon, and this project ships no scheduler of its own: an external one (Windows
Task Scheduler, cron) invokes the command.

Weekends and holidays skip. Weekends always; holidays when you seed them, by
passing `--calendar <file>` — a YAML calendar file of `holidays` and `weekend`
([working-day-calendar.md](working-day-calendar.md#from-a-calendar-file--workingdaycalendarfrom_yamlpath)).
Without the flag the calendar is weekends-only. A skipped pass prints its reason
— which names the aspect of the date the schedule judged, so for a daily
schedule that is the weekday name, holiday or not:

```console
2026-08-08  case_management  sharepoint_cases  skipped  schedule daily is not due on saturday
```

## 3. Direct re-drive

```sh
python -m cli run pipelines/sharepoint_cases --base-dir /data/case-review
```

Allowed, and sometimes what you want — but it **bypasses schedule due-ness
entirely**: it will poll on a Sunday. It also writes no `_orchestration/runs.db`
decision, so the day's orchestration audit trail will not show it.

## 4. Recovery — why re-running is safe

The generic loop (see it, diagnose it, resolve it, re-drive it) is
[resolving-a-failed-run.md](resolving-a-failed-run.md). Its §4 rule —
idempotent by *logical run id* — is **not** why this feed is safe. Raw and silver
use `AppendOnly("source_observation_id")`, gold is rebuilt whole with `Refresh()`,
and **every** watermark commits last. The feed polls each list in `CASE_LISTS`,
and each keeps its own watermark, so these shapes are per list. Four of them:

- **Failure above the commit.** Nothing advanced the checkpoint, so the next run
  polls from the same watermark and covers the failed window's ground again.
  Re-run the ordinary command; no cleanup first.
- **The commit itself failed.** The window was published but the watermark did
  not move. The rerun starts from that same watermark — its *end* is a fresh
  `server_now - safety_lag`, so it is a wider window, not the identical one —
  and `AppendOnly` no-ops the observations already landed (the observation id is
  derived from immutable metadata, so a re-read *is* the same observation). Gold
  is then rebuilt whole from the accumulated silver history under the rerun's own
  window end. Both paths converge on the same state.
- **A failure part-way through the lists.** The lists polled before it have
  their observations in raw and silver (append-only, committed per hop), but
  nothing was published to gold and **no** watermark moved. The next run
  re-polls every list from unchanged watermarks, the re-reads no-op, and gold
  rebuilds whole.
- **`AppendOnlyConflictError`.** A `source_observation_id` already seen has
  arrived with a *changed* payload. This is the one failure where "just re-drive"
  is the wrong advice — the same observation cannot legitimately have two
  payloads, so something upstream of the key's assumptions has changed. It needs
  investigation, not a rerun.

The convergence is already proven; see the failure and retry tests in
`tests/pipelines/test_sharepoint_cases.py` rather than re-establishing it by hand.

The window rule itself — `window is None`, first load, overlap, safety lag,
commit-is-last, and where the checkpoint file lives — is at
[adding-a-feed.md](adding-a-feed.md#sharepointcheckpointstorebase_dir--where-the-polling-got-to).

## 5. What REST polling cannot tell you

- **Hard delete is not detected.** A `Modified` window cannot see an item that no
  longer exists, so a deleted Case will sit in the accumulated history forever —
  use a business status as the operational signal and raise reconciliation as
  separate work
  ([the canonical statement](adding-a-feed.md#sharepointmodifiedreadersite-list_name-columns-window)).
- **`Modified` is not an indexed column** and cannot be indexed on a list already
  past the 5,000-row List View Threshold, so this feed works on a small list and
  degrades as the list grows
  ([data-dictionary-sharepoint-cases.md](data-dictionary-sharepoint-cases.md#three-things-to-know-before-this-feed-reaches-a-tenant)).

## 6. Backup and concurrency

- Two places hold system-of-record state, and they must be backed up and restored
  **together**: the whole `<base>/<feed>/` directory (`quarantine.db` alongside
  `{raw,silver,gold}.db` — rejected observations cannot be re-fetched either) and
  `<base>/_checkpoints/sharepoint.db`, which holds **one row per declared list**. Restoring data without the checkpoint, or
  the checkpoint without the data, forks the feed.
- One local process, one operator at a time. There is no distributed lock; a
  second concurrent pass races the same watermark.

## 7. Credentials

Credentials reach the feed through the `CaseListClient` seam that `_resolve_client`
returns — never a `--param` and never a command line.
