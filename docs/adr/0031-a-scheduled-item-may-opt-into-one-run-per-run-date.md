---
status: accepted
---

# A scheduled item may opt into one run per run date

A `ScheduledPipeline` declares `allow_multiple_runs`, **true by default**. When it
is false, a due-work pass **skips the item on a run date it has already succeeded
on**, recording `skipped` with the reason, unless the pass is forced
(`run_due_once(force=True)`, `orchestrate --force`). An overrides file may set the
flag per item. `plan()` reports such an item `already-satisfied`, and that status
now means exactly that: the pass will not run it.

"Already succeeded on the run date" is the fact the pass already reads for
deadline pressure (ADR-0017): a successful whole-pipeline `run` record whose local
calendar date is the run date. A failed or blocked attempt does not count, so a
retry later the same day still runs.

## Why

- **An hourly external trigger re-ran everything due that day.** The pass's only
  "already ran" guard was local to one invocation, so each `--once` re-ran every
  daily item. That is right for a polling feed, whose watermark makes a repeat
  cheap and convergent, and wrong for a pipeline that should publish once.
  The pipeline knows which it is, so the choice belongs on its schedule.
- **True by default keeps today's behaviour.** No existing schedule changes
  meaning, and a polling feed needs no new declaration.
- **The plan stopped promising something the pass did not do** (issue #404).
  `already-satisfied` was reported for every same-day success, yet the next pass
  re-ran the item. Now an item that may run again plans `ready`, with
  "already succeeded on …, runs again" in its reason, and `already-satisfied` is
  reserved for an item the pass will skip.
- **Force is per pass, not per item.** `python -m cli run pipelines/<name>`
  already re-runs one pipeline outside the schedule; `--force` is for re-driving
  the whole pass, for example after a fix.

## Consequences

- **This amends ADR-0017's "never whether the item executes".** The ordering
  derivation is unchanged and still reads run history for deadline pressure only.
  The opt-in skip is a separate check in the pass's decision, after the schedule
  and `earliest_run` and before dependencies, mirrored by `plan()`.
- **The period is the run date, judged by when the success was recorded.** A
  backfill with `--run-date` in the past looks for a success recorded on that
  past day, so it runs unless one exists. Every schedule today is day-level, so a
  run date is the whole period; a sub-daily schedule would need a finer rule.
- **Freshness is untouched.** Whether an item may run at all is still the
  freshness rule's question; this flag only stops a repeat.
