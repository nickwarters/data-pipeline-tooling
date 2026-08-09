# 49. `#/team-stats` renders the team Report Feed; `#/my-team` keeps the live present

Date: 2026-08-09

## Status

Accepted. The consumer side of the data pipeline's
[ADR-0019](../../../docs/adr/0019-team-report-feed-attributed-by-the-staff-hierarchy.md),
and the manager-side twin of
[ADR-0048](./0048-my-stats-renders-a-report-feed-with-a-live-tail.md). Corrects
one sentence of [ADR-0038](./0038-manager-fields-split-reporting-snapshot-vs-live-access-role.md)'s
reporting half by naming the Staff Hierarchy, not the User Profile Service, as
the intended writer of `assignedReviewerManager`.

## Context

CONTEXT.md promised a Reviewer Manager a report at `#/reports/reviewer-team`
carrying "their team's completed-Case volumes (7- and 30-day) **and** current
assigned-Case queue health (outstanding, overdue)". That route never existed —
there is no `#/reports/` namespace in `setup/register-routes.js` — and the
sentence bundled two things ADR-0048 had already prised apart: settled history,
which Python owns and publishes as a file, and the live present, which the
browser reads from the Case lists. `#/my-team` had meanwhile shipped the second
half on its own.

So the question was never "build the promised page". It was which of the two
halves is missing, and where it goes.

## Decision

**The manager gets two pages, split by which half of the question they answer.**
`#/my-team` keeps the live present — Current Workload and Voided Cases, both
list reads. `#/team-stats` is new and renders history: the `teams/{manager}.txt`
Report Feed, with a live tail for the days the file cannot yet cover. The
phantom `#/reports/reviewer-team` is struck from CONTEXT.md rather than kept as
an aspiration.

### The tail is filtered by `AssignedReviewerManager`

The tail mirrors `#/my-team`'s existing fetch — `AssignedReviewerManagerId eq
me`, one bounded `$filter` per Case Type list, reusing `team-cases-fetcher.js`
untouched — rather than by an `anyOf` over a roster carried in the file.

This is the decision that most needs its reasoning preserved, because it is
**unsound on its own** and sound only in combination. The solid bars are
attributed by the Staff Hierarchy; the hollow bars by the Case row. Two
org-chart sources drawn adjacent would make a recent mover appear in one and not
the other, and would spend ADR-0048's rule 2 — *"solid versus hollow encodes
provenance, and nothing else"* — on a second, unstated meaning.

What makes it sound is that **the Case row's `assignedReviewerManager` converges
on the Staff Hierarchy**, in two steps that are worth keeping distinct. The
allocation surface stamps it from the **User Profile Service** in the same PATCH
that names the Reviewer — the lookup a browser can actually perform. A daily
reconciliation then rewrites any row whose manager disagrees with
`current_hierarchy`, which is the authority.

So drift is **bounded, not eliminated**, and the bound is the reconciliation
interval. Where AD and the hierarchy disagree about one Reviewer, that
Reviewer's Cases can be attributed one way in the hollow bars and another in the
solid ones for at most a day. That is a stated inaccuracy of the same species as
ADR-0048's working-day average — consistent for everyone, exact for nobody — and
it is a different thing entirely from the unbounded version, where a Case
allocated under one manager keeps that attribution until it is Reportable.

Neither step is in this decision's scope and neither is built. Until the stamp
exists the hollow bars are empty while the solid ones are not, which on this
page looks like a team that stopped working on Friday. The page is therefore not
shippable before the stamp, and this ADR is the record of why — a future reader
finding the two-source split and "fixing" it by re-attributing the tail would be
undoing the thing that holds the chart together.

The rejected alternative — carry the roster in the envelope and tail with
`anyOf` over it — needs no unbuilt write and keeps one definition of team by
construction. It was not chosen; recorded because it is the obvious fallback if
the write slips.

### The chart is a distribution, not a ranking

Bars group by **Reviewer**, ordered by name and never by volume, with Case Type
proportion bars and a `Reviewer × Case Type` breakdown table beneath, as on
`#/my-stats`. `#448`'s chart takes a data interface, so this is a different
series rather than a different component.

Grouping by Reviewer is the information a manager opens the page for; ordering
by volume would make it a league table of named colleagues, and volume is not
performance. Case Types differ in effort, complexity varies within them, and
leave is invisible to every figure on this page. The ordering is the whole
safeguard — the same bars sorted descending assert a comparison the data cannot
support.

### Measures follow ADR-0048 exactly

Non-working days draw as ordinary bars at day grain, so weekend work is visible
because the bar sits on a Saturday — no distinct fill, which would put a second
meaning beside solid/hollow. The average is **per working day** for the team as
a whole, with the same denominator and the same stated inaccuracy as
`#/my-stats`, and **Active reviewer-days** beside it as the roster-immune
figure.

Per-*head* rate was rejected despite being the more useful number. It needs a
headcount, and attribution by current hierarchy applies today's roster to 13
months of history — so it is wrong for any range spanning a joiner or leaver,
which is exactly when a manager would reach for it.

Display names resolve at render through `resolveUsers`, as
`cora-my-team.js` already does via `withReviewerDisplayNames`, degrading to bare
account ids when the lookup fails. Names stay out of the artifact.

## Consequences

- **The page is blocked on a write in another layer.** Not on its own
  rendering, and not on the pipeline: on `assignedReviewerManager` being
  written from the Staff Hierarchy. Shipping before that yields a chart whose
  recent days are permanently empty.
- **Two manager pages will invite consolidation.** They answer different
  questions from different sources on different cadences, and merging them
  recreates the bundled sentence this decision unbundled.
- **A team's history moves when the org chart does.** Attribution is by the
  hierarchy as it stands today, so the page states its figures are "as this team
  stands today". A manager comparing a screenshot to the same range next quarter
  may see different numbers, and the label is the only thing that explains it.
- **The manager's file holds named individuals' volumes at a guessable URL.**
  Inherited from ADR-0048's position that these files are not a security
  boundary and the library ACL is — but the payload is other people's data now,
  not the reader's own, which raises the ACL from a formality to a requirement
  on the Forwarder (the data pipeline's delivery process — see its `CONTEXT.md`).
