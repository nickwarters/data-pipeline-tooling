---
status: accepted
---

# Sync polls hourly into silver; it publishes gold daily

**Sync** is split into two separately addressed pipelines on two cadences: the
**poll** (source → raw → silver) runs hourly, and the **publish**
(silver → gold) runs daily. Today `pipelines/sharepoint_cases` does both in one
`run()`; this ADR records the shape it is to take, not the shape it has.

The hourly cadence exists for exactly one consumer — **Notification** — and
Notification reads *observations*, not current state.

## Why

**Only one thing needs fresh data.** Selection needs Sync to have run today (void
and completion volumes), Reporting is daily or slower, and the metric aggregates
were explicitly said not to need hourly currency. Notification is the sole
hourly consumer, and its two triggers — a Case becoming Reportable with
remediation, and a new Conversation Message — are both readable from a silver
observation. `case_current` and the three aggregates are current-state artifacts
it never touches.

**The poll is already cheap; the publish is not.** The raw and silver hops are
`O(window)`: silver "normalises the batch just fetched, never the whole raw
history", and `AppendOnly` makes a re-read of an unchanged row a no-op, so a
quiet hour costs almost nothing. `publish_gold` is the whole of the expense —
`case_current_builder` reads the *entire* silver history every time, because "a
Case whose latest version arrived three polls ago is still current". The
aggregates are innocent: they read the in-memory `DatasetReader(current)`, so
silver is read once per publish.

That asymmetry is the decision. Multiplying polls by eight multiplies the
whole-history reduce by eight *while the history itself grows eight times
faster* — the daily cost of publishing rises roughly quadratically in poll
frequency. `gold.py` already concedes the premise: rebuilding is "the price of
`Refresh()` and cheap at this list's size." Splitting the cadences keeps that
true instead of racing it.

## Considered options

- **Poll hourly and publish gold every poll** (what the code does today).
  Simplest, and correct. Rejected on cost alone — it is the quadratic above, paid
  to keep four tables current for consumers that asked for daily.
- **Publish `case_current` incrementally with `UpsertStrategy` keyed on
  `case_id`.** Genuinely viable: the reduce is `max`-by-version per Case and
  SharePoint's version stamp is monotonic per item, so an incremental latest is
  correct. Rejected as unnecessary once Notification left the gold path — it
  buys nothing Selection and Reporting need, and it costs two real things. It
  gives up the self-healing property (a full `Refresh` repairs a corrupted or
  back-filled silver; an upsert cannot), and it breaks the aggregates, which read
  the *window's* rows via `DatasetReader(current)` and would silently start
  describing the last hour rather than the book. Reconsider only if the daily
  publish itself becomes too slow.
- **Prune or archive silver history.** Rejected: silver is the observation
  record, and the reduce needs a Case's latest version however long ago it
  arrived.

## Consequences

- **The watermark's meaning weakens, and that is safe here.** It commits last and
  currently vouches that a window was *published*; after the split it vouches
  only that the window *landed in silver*. Nothing is lost because the daily
  publish reads the **whole** silver history — it has no coverage to protect and
  so needs no watermark of its own. The "commit is last" reasoning in
  `pipelines/sharepoint_cases/pipeline.py` and
  [`sharepoint-rest-ingest.md`](../sharepoint-rest-ingest.md) is written in terms
  of publication and must be restated.
- **Gold's `as_of` stops being the poll window's end.** The daily publish stamps
  its own run instant across all four tables, which is the more honest reading of
  a daily rebuild.
- **Two orchestration entries, not one.** The poll and Notification belong to an
  hourly schedules module; the publish, Selection, Ingest and Reporting to a
  daily one. Selection's `.same_day()` requirement then names the *publish*
  pipeline, and since both are daily and in one `PipelineSet`,
  [ADR-0017](0017-run-order-is-derived-per-pass-not-declared.md)'s
  dependency-dominant ordering runs the publish first without being told to.
- **Cadence lives in the invocation, not in `Schedule`.** `Schedule.is_due` takes
  a *date*; there is no sub-daily schedule and this ADR does not add one. Hourly
  means an hourly external trigger against an hourly schedules module.
- **Anything new that wants intra-day current state must say so.** It will find
  gold up to a day stale, and the answer is to read silver observations as
  Notification does — not to move the publish back into the poll.
