# Resolving a failed run — investigate, fix, re-drive

A run fails **loudly and cleanly**: `.run()` is fail-fast and atomic, so a
validation breach (or a coercion failure, or a stale upstream) aborts the run and
rolls back the failing writer's single SQLite transaction — **no layer is left
half-written** ([ADR-0007](adr/0007-fail-fast-atomic-runs-jsonl-observability.md)).
The failure is recorded in the RunLog / RunRegistry with the failing step and
message, and at a run boundary it surfaces as a short
`framework.core.format_failure` block rather than a traceback. This guide is the
operator loop from *that block* back to a green run.

> **Committed artifacts are not rolled back.** Atomicity is per writer, per layer
> DB — it does not span a run's writers. If the run already wrote a **quarantine**
> reject table, an **explain/trace**, or a **checkpoint** before it failed, those
> artifacts are **independently committed evidence** and stay on disk
> ([ADR-0007 amd 03](adr/0007-amendment-03-independent-artifact-commits.md)). The
> run log's `committed` markers list exactly what landed — read them before you
> re-drive so you know which evidence is already present (re-driving replaces an
> artifact's rows under the same logical run id, so there is nothing to clean up).

The worked example below is a **validation failure** (the common case), but the
same loop applies to any expected `PipelineError`.

## 1. See it — `status` / `runs` / `log`

The failure is already on screen if you ran the pipeline directly:

```
Pipeline run failed [ValidationError, data]
  cases ingest pre-validate failed: missing required column(s): case_id
```

The bracket carries the **kind** and its **triage category** — `data`,
`operational`, or `config` (see [§2](#2-diagnose--read-the-message-not-the-traceback)).
The category is also stamped on the failing step's run-log record (`error_category`)
and the run summary, so you can triage from the log without reading every message.

If it failed under `orchestrate`, or you're picking up someone else's run, read
it back from the run store ([operator-cli.md](operator-cli.md)):

```sh
python -m cli status /data                       # latest run per pipeline
python -m cli runs   /data --pipeline ingest --status error
python -m cli log    /data ingest --run-id 5f8ff8c7   # the failing run's steps
```

`log` prints one line per step and ends with a summary, so you can see **which
step** failed (`pre-validate`, `process`, `post-validate`, `write`) and its
message. A `ValidationError` names the column and the rule it broke; a
`CoercionError` names the column and the unparseable value
([schema-enforcement.md](schema-enforcement.md)).

## 2. Diagnose — read the message, not the traceback

The expected failures are self-describing. Map the message to a cause:

| Message shape | What broke | Where to look |
|---------------|-----------|---------------|
| `missing required column(s): …` | the source didn't carry an expected column | the feed file / source export |
| `… expected date but found object` | a dtype the coercer couldn't repair | the source values for that column |
| `column '…' violates pattern …` / `outside {…}` / `has duplicate value(s)` | a **value rule** failed on real data | the offending rows (the message samples up to five) |
| `column '…' contains null value(s)` | a `NonNull()` field arrived empty | the source / upstream join |
| `upstream ingest is stale: …` | a declared upstream hasn't run recently enough | run the upstream, or relax the window |

Each expected failure also carries a **triage category** (`framework.core.ErrorCategory`)
that tells you *whose problem it is* before you read the message:

| Category | Means | Failures | The fix is in… |
|----------|-------|----------|----------------|
| `data` | the feed broke a declared data expectation | `ValidationError`, `CoercionError` | the **data** (source/upstream) |
| `operational` | data and code are fine; the run conditions aren't | `FreshnessError`, `ForEachPipelineError` | the **run/environment** |
| `config` | the pipeline is mis-addressed or mis-wired | `UnknownPipelineError` | the **wiring** |

A genuine bug (not a `PipelineError`) keeps its traceback **and has no category**
(`error_category` is null in the log) — that's a code defect to fix, not an
operator-resolvable data problem. The deliberate non-categories: a source that
won't open, a failed write, and a transform bug all stay raw tracebacks rather
than being dressed up as expected failures (ADR-0007's expected-failure-vs-bug
line).

## 3. Resolve — four legitimate moves

Pick by *why* it failed; they are not interchangeable.

1. **Fix the source and re-pull.** The default for a non-destructive source: the
   export was wrong, so correct it upstream and re-drive. ADR-0007's contract is
   "bad upstream data stops the pipeline; fix the source."
2. **Mark a validator `warn`.** When the condition is *known-tolerable* (a
   reference column that's legitimately sparse, a drift you've accepted),
   `severity="warn"` logs-and-continues instead of aborting. This is the
   sanctioned escape hatch — use it deliberately, not to silence a real problem.
3. **Quarantine the bad rows.** For *value-rule* rejects where the good rows
   should still flow, route the rejects aside and keep the rest
   ([ADR-0007 amd 01](adr/0007-amendment-01-quarantine.md)). The quarantined rows
   are persisted for inspection, not silently dropped.
4. **Amend the contract.** If the data is right and the *rule* was wrong, change
   the schema field / value rule (and its docs) — that's a code change with a
   test, not a re-run.

> **Destructive sources can't be re-pulled.** Where the source is a current-state
> system that overwrites ([ADR-0006](adr/0006-load-idempotency-refresh-upstream-accumulate-downstream.md)
> amendment), option 1 isn't available — you can't re-fetch yesterday. Resolve
> with a **correction batch** (below) against the raw/silver you already
> accumulated, or with options 2–4.

## 4. Re-drive — idempotent by logical run id

Re-running is **safe**: re-execution under the same *logical run id* replaces that
run's rows rather than duplicating them — `Refresh()` truncates and reloads,
`AccumulateByRun` does delete-by-logical-run-then-insert
([ADR-0006](adr/0006-load-idempotency-refresh-upstream-accumulate-downstream.md)).
Because the failed run rolled back, there's nothing to clean up first.

Re-run the same business day — the logical run id defaults to
`<pipeline>:run_date`, so this is already idempotent:

```sh
python -m cli run pipelines/ingest /data --run-date 2026-05-29
```

Re-run a **correction batch** under a stable id, independent of the calendar
date, when you're reprocessing a fix rather than re-running a day:

```sh
python -m cli run pipelines/ingest /data --logical-run-id 2026-05-correction
```

Running it twice replaces the batch's rows both times; the row count stays stable
instead of doubling. Each execution remains individually traceable by its own
`execution_id` in the RunRegistry even though the logical id is shared.

## 5. Confirm — green status, clean log

```sh
python -m cli status /data --pipeline ingest   # latest run now `ok`
python -m cli log    /data ingest --run-id <new-id>   # 0 failed, 0 warned
```

A downstream that was **blocked** by the failure (its upstream was stale) clears
on the next `orchestrate` pass once the upstream has a fresh successful run —
freshness is re-evaluated each pass, so no manual unblock is needed
([operator-cli.md](operator-cli.md)).
