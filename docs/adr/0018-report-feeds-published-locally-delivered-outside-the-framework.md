---
status: accepted
---

# Report Feeds are published locally; delivery happens outside the framework

A **Reporting** pipeline that produces a **Deliverable** writes it to a local
**deliverables root** — `<base_dir>/deliverables/<destination>/…` — and stops.
It does not upload, push, or otherwise deliver anything. Moving an artifact to
where it is consumed (a SharePoint document library, a SharePoint list, a SAS
environment) is **delivery**, and belongs to a configurable batch job outside
this framework that watches those directories.

The first artifact of this shape is a **Report Feed**: a Deliverable whose
consumer is a report, or a UI that renders one. Its concrete form here is the
per-Reviewer `my-stats` artifact behind the review platform's my-stats page.

## Why

**A pipeline that delivers carries things it has no other business carrying.**
Credentials for a system it never reads, a network failure mode unrelated to its
data, and a retry policy for that failure. Today the only outbound push in the
tree (`SharePointWriter`) is stubbed, so nothing has yet paid that cost — this
decision is made *before* the first real one rather than after four of them.

**Every destination would otherwise grow its own Writer.** SharePoint document
library, SharePoint list, SAS writeback, a share for another team: four Writers,
four auth stories, four sets of tests that cannot run without the real system.
"Move these files there" is **one** mechanism that serves all of them, and it is
not a data-pipeline concern — it is file movement, and it need not use this
framework at all.

**Least privilege.** The delivery job needs read access to a directory of files
to ship. If pipelines delivered, every pipeline box would need write credentials
into every destination.

**It is testable without the destination.** A pipeline's publication step
asserts against a temp directory. Nothing is stubbed because nothing external is
touched.

## The Report Feed envelope

One file per Reviewer, keyed by the lower-cased bare account name (see
**Reviewer** in [`../../CONTEXT.md`](../../CONTEXT.md)), holding **JSON stored in
a `.txt` file** — SharePoint SE is unreliable serving `.json`, the same reason
the review platform's Question Bank artifacts are `.txt`. The canonical shared
mock and contract artifact is
[`123456.txt`](../../platform_frontend/dev/fixtures/my-stats/123456.txt). Its
second `case_type` is a placeholder showing that rows are keyed per date and
Case Type; it does not name a real Case Type.

The envelope below is abridged; the linked fixture carries richer sample rows.

```json
{
  "schema_version": 1,
  "reviewer_account": "123456",
  "generated_at": "2026-08-09T04:15:00+00:00",
  "complete_through": "2026-08-08",
  "rows": [{ "date": "2026-08-07", "case_type": "complaints", "count": 4 }]
}
```

Three properties are load-bearing:

- **`generated_at` is an instant (UTC); `complete_through` is a calendar date
  (local).** They answer different questions — *when was this made* versus *what
  is it complete through* — and only the second protects a number. A consumer
  asked for "last week" against a file written on Friday must be able to tell
  that Friday, Saturday and Sunday are missing rather than zero. Keeping the two
  apart is the rule in `tools/observability/timestamps.py`, applied here.
- **Rows are sparse.** No row means no work that day, which the consumer renders
  as zero while walking its own calendar. A dense file would require the
  producer to know the roster of Reviewers, which it only learns from Cases
  they have already done.
- **The file is rewritten whole every run**, and carries 13 months (the current
  partial month plus twelve complete ones) regardless of what any consumer
  currently displays. Widening a view later is then a consumer change alone.
  Because rows are sparse, that coverage window is not visible in the artifact:
  the earliest activity row does not reveal the earliest date covered.

## Consequences

- **The my-stats feature is not deliverable end-to-end by this framework.** Its
  acceptance stops at "the deliverables root contains the correct files"; an
  interim manual copy carries them to SharePoint until the delivery job exists.
  Accepted as not-ideal rather than blocking, with the delivery job ticketed
  from day one so the workaround does not become load-bearing by default.
- **`SharePointWriter`'s list push predates this and is not migrated.** Whether
  Selection's Deliverable moves onto the delivery job is that job's decision,
  not this one's.
- **Mirror versus drain is deliberately left open.** A producer that rewrites
  its files whole supports either. They differ in retry behaviour and in what an
  operator sees mid-flight, and that is the delivery job's design problem.
  Draining the *local* directory does not conflict with keeping a stale Report
  Feed: that rule is about the artifact at its **destination**, which is only
  ever overwritten, never removed — an old file states the date it is complete
  through and so tells the truth about itself, where an absent one only says
  "broken".
- **The deliverables root is a fourth category in a base directory**, beside the
  rows the `StoreRegistry` lays out, the runs the **Run store** records, and the
  source checkpoints. It gets an owner for the same reason those did: a layout
  with no owner drifts. `tools/deliverables.py` is that owner;
  `shared.constants` declares the dev/prod roots while
  `tools.environments` applies the environment-variable-over-default
  precedence and warns when production uses its committed fallback, and
  `REPORT_FEEDS_DESTINATION` is the canonical
  `"cora_report_feeds"` destination rather than a spelling repeated in a
  pipeline, a delivery job and a runbook.
- **A Report Feed is not deployed code**, which is what keeps it clear of the
  review platform's "deployed bytes are source bytes" rule. It must never be
  written under the front end's deployed tree (`Style Library/CODE/CORA`): that
  deploy **deletes any remote file with no counterpart in the repository**, so
  an artifact written there would vanish at the next release.
