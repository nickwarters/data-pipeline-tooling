# 48. my-stats renders a Report Feed, and computes only the tail the feed cannot cover

Date: 2026-08-09

## Status

Accepted. Consumes the Report Feed defined by the data pipeline's
[ADR-0018](../../../docs/adr/0018-report-feeds-published-locally-delivered-outside-the-framework.md),
with the shared envelope captured by the canonical
[`123456.txt`](../../dev/fixtures/my-stats/123456.txt) fixture.

## Context

Historic MI is processed outside SharePoint, in Python, and published as JSON in
a `.txt` artifact; the front end renders it. That policy exists because
recomputing management figures in a browser, from list queries, is how a
reporting layer becomes unreviewable and slow.

The my-stats page shows a Reviewer their own reportable-Case counts over four
ranges, broken down by day or month and by Case Type. Every figure it needs is
in the Report Feed — except the most recent days, and for a structural reason:
the producing pipeline runs Mon–Fri and covers dates up to and including the
previous day. On a Monday morning the freshest artifact was written on Friday
and is complete through Thursday. A page that rendered only the file would show
Friday, Saturday and Sunday as **zero**, and a Reviewer would read that as "I
did nothing", not as "not yet counted".

Zero and not-yet-known are different values, and a bar chart draws them
identically unless something is done about it.

## Decision

**The page renders the Report Feed. For dates after the feed's
`complete_through`, it reads the Case lists directly and computes the same
measure itself.**

Three rules keep that from becoming a second, competing reporting layer:

1. **The file always wins for any day it covers.** The browser never recomputes
   a date at or before `complete_through`, even though it easily could. This is
   the invariant that stops the two paths from ever disagreeing about the same
   day.
2. **Solid versus hollow encodes provenance, and nothing else.** Solid = from
   the file. Hollow = computed live. It does _not_ mean "excluded".
3. **Totals and the average exclude today only**, hollow or not, carried by an
   asterisk (`Total: 47 *` / `* excludes today`). Days that are complete but not
   yet in the file are real work and count.

Rules 2 and 3 are separate on purpose. A day that is finished but unpublished
and a day still in progress are both hollow, and only one of them is excluded —
one visual state meaning both would make the page lie about one of them.

A fourth rule was added when the tail was built, and it is the one that keeps
the other three affordable:

4. **The tail is bounded by the calendar, not by the file.** `complete_through`
   says where the tail should start; a small fixed window says how far back it
   is ever allowed to start. Without the second half, a Reviewer whose file is
   missing or stale asks for every Case they have ever finished, one full page
   at a time — which is the reporting-by-list-query this decision exists to
   avoid, arrived at by accident. And **with no file at all, no tail is read**:
   there is no boundary to compute from, and "nobody has published a report for
   you" is a different sentence from "you did nothing", exactly as zero and
   not-yet-known are different values for a single day. The page says the
   former, and issues no list read at all.

The page owns four fixed browser-calendar windows. Each includes complete
previous period(s) and the current partial period so every selection has a
comparison:

| Range     | Window                                                          | Grain |
| --------- | --------------------------------------------------------------- | ----- |
| Week      | previous complete Monday–Sunday plus current Monday–today       | day   |
| Month     | previous complete calendar month plus current month–today       | day   |
| 3 months  | three complete months before this month plus the current month  | month |
| 12 months | twelve complete months before this month plus the current month | month |

The browser snapshots its local calendar date when the route slice is created.
In every descriptor, `end` is browser-local yesterday and is the inclusive
totals cutoff; `today` is the inclusive display endpoint. The final daily or
monthly bucket therefore extends through today even though totals stop at
yesterday. Previous monthly buckets end on their calendar month end, while the
current monthly bucket ends today. Day keys are `YYYY-MM-DD`, month keys are
`YYYY-MM`, and the current labels state `(today)` or `(current month)`.

The selected range drives the same `StatsReport` used by the chart. The report
preserves the date × Case Type dimension from feed rows and typed live-tail
rows, applies the settled/provisional boundary once, and derives each bucket's
total, Case Type counts, and percentages together. It exposes one deterministic
global Case Type column list, so a type absent from a bucket is represented by a
zero cell. Display names come from the frontend Case Type manifest, and unknown
slugs are humanized for presentation without adding a manifest entry.

The page renders those buckets in a full-width accessible table immediately
beneath the headline figures. The table uses the range bucket labels verbatim:
Week and Month are daily, while 3 months and 12 months are monthly, including
the `(today)` and `(current month)` suffixes. Its row totals are the same totals
shown by the chart. The former selected-range feed-only Case Type panel and its
now-dead proportional-bars component were removed.

The chart, the figures beneath it, and the breakdown table are three readings
of **one** derivation. The page merges the file and the typed tail into one
count per calendar day and Case Type, once, and hands that report to all three;
a second derivation would be a second chance for them to disagree, over numbers
a Reviewer can see side by side. The figures are the
total (excluding today), the average per working day, the count of active days,
and the busiest day with its count. The page renders a labelled control group
for the four descriptors. Selecting a button dispatches
`my-stats/range-selected`; the selected button exposes its state with
`aria-pressed`, and the chart and figures derive from that range.

### Why the live read is affordable

- `AssignedReviewer` and `ReportableAt` are both **indexed** on every
  `Cases-{slug}` list, so the filter is server-side and safe against the List
  View Threshold.
- It is **one request per Case Type**, not per day: fetch the tail rows once and
  bucket them in the browser. This is the fan-out `services/across-sources.js`
  already performs.
- It is bounded **because the page bounds it**, which is the part that has to be
  written down. "A few days of one Reviewer's own work" is what a healthy file
  makes it; it is not what an absent or stale file makes it. A missing artifact
  is an expected empty read rather than an error, so with no file there is no
  `complete_through` — and a tail that fell back to the range start would ask
  for thirteen months of Cases, unpaged, with the full `$select=*` projection
  and five person expands on every row. The reviewer activity Reporting
  pipeline now produces the local file, complete through the last full local
  day before its snapshot; external delivery remains separate.
  Hence the clamp, and hence no read at all without a file.

  The clamp is ten calendar days counting today, derived from how stale a
  _healthy_ file can honestly be. The pipeline runs Monday to Friday covering
  through the previous day, so the structural worst case is Friday's artifact
  still being freshest on Monday — complete through Thursday, four days to
  compute. A bank holiday either side of a weekend stretches that to six (the
  Easter pattern: Good Friday and Easter Monday both non-running). Ten leaves
  slack for a failed run without the window ever growing with the size of the
  backlog.

  Beyond ten days the tail is deliberately **short rather than large**, and the
  page says so in a line under the figures. An unbounded read is the failure
  this decision was written to prevent; an admitted gap is not.

## Consequences

- **This is a bend in the MI policy, and it is deliberate.** The split becomes
  "Python owns settled history, the browser owns the unsettled tail" rather than
  "the browser only renders". Recorded here precisely so a future reader does
  not find a list query on a reporting page and assume it was an accident.
- **A day's number can change when it moves from hollow to solid.** The live
  read and the pipeline read the same source field on the same current row, so
  they should agree — but a Case reassigned or re-stamped between the two reads
  will shift. The provenance encoding is what makes that legible instead of
  mysterious.
- **`listCases` over-fetches for this use.** Its projection is fixed (`*` plus
  the person expands), so the tail read drags back every column including the
  `answers` and `conversation` blobs. Acceptable only because the clamp caps the
  window at ten days of one person's Cases — it is that projection which makes
  an unbounded window expensive rather than merely long. A narrow projection is
  the fix if it bites.
- **The live tail is a separate slice and the page must work without it.** If
  the list read fails, the page still renders the file rather than failing the
  route — an aborted read is navigation, never a route error. It does say so,
  quietly: a failed tail, or a file too stale for the clamp to reach, puts one
  muted line under the figures. Silence there would leave a Reviewer reading an
  understated week with no way to tell. The line never replaces or hides the
  settled half, which is the whole point of keeping the two halves separate.
- **The counts are browser-local, and that conversion is the fragile part.**
  `ReportableAt` is an instant; "which day did I finish it" is a calendar
  question, and the calendar is the Reviewer's own. The conversion lives in one
  place, the date filter's bounds are the local start of each day so the query
  and the bucketing agree, and its tests pin their own zones rather than
  inheriting the machine's — a conversion that is only wrong for part of the
  day, in some zones, otherwise passes by luck.
- The reviewer activity Reporting pipeline publishes the local Report Feed to
  `deliverables/cora_report_feeds/my-stats/{account}.txt`. The page still treats
  a missing file as an expected no-report state, because local publication and
  external delivery are separate boundaries.
- **The page is UX-gated on `isReviewer`; the library ACL is the boundary.**
  Per-Reviewer files are not a security boundary: anyone who can read one can
  read another by guessing an account id, which is trivial when it is a staff
  number. That is accepted, and is the same client-side-checks-are-UX-only
  position the rest of the app takes.
- **The average is per _working day_, with a stated inaccuracy.** The numerator
  counts every day in the range including weekends; the denominator counts
  Mon–Fri minus `ENGLAND_WALES_HOLIDAYS`. Leave is invisible to it. So the
  figure is consistent for everyone and exact for nobody, which is the right
  trade for "roughly how am I doing" — and it is labelled "avg per working day",
  not "avg/day", because the two differ by about a third and the short label
  invites the wrong comparison. **Active days** sits beside it as the
  leave-immune figure.
