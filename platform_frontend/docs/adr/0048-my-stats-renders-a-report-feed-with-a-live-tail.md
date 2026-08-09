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

### Why the live read is affordable

- `AssignedReviewer` and `ReportableAt` are both **indexed** on every
  `Cases-{slug}` list, so the filter is server-side and safe against the List
  View Threshold.
- It is **one request per Case Type**, not per day: fetch the tail rows once and
  bucket them in the browser. This is the fan-out `services/across-sources.js`
  already performs.
- It is bounded by construction — a few days of one Reviewer's own work.

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
  `answers` and `conversation` blobs. Bounded and acceptable at a few days of
  one person's Cases; a narrow projection is the fix if it bites.
- **The live tail is a separate slice and the page must work without it.** If
  the list read fails, the page still renders the file rather than failing the
  route — an aborted read is navigation, never a route error.
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
