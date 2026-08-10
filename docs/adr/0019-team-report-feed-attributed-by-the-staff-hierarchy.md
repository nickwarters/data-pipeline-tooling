---
status: accepted
---

# A different question earns a different Report Feed, attributed by the Staff Hierarchy

A **Reviewer Manager**'s view is not a wider **Reviewer** view. It gets its own
**Report Feed** — `teams/{manager}.txt` beside `my-stats/{account}.txt` —
grained at `date × case_type × reviewer_account`, reduced from the *same* gold
aggregate as the per-Reviewer files, and attributed to a manager through the
**Staff Hierarchy** rather than through the Case row's allocation-time
`assigned_reviewer_manager` cache.

Extends [ADR-0018](0018-report-feeds-published-locally-delivered-outside-the-framework.md),
which defined the Report Feed envelope and its local-publication rule; the
consumer side is
[ADR-0049](../../platform_frontend/docs/adr/0049-team-stats-renders-the-team-report-feed.md).
It deliberately departs from the reporting half of the review platform's
[ADR-0038](../../platform_frontend/docs/adr/0038-manager-fields-split-reporting-snapshot-vs-live-access-role.md);
that departure is the substance of the second half of this decision. The
platform may stamp an allocation-time `assignedReviewerManager` cache for its
bounded live tail, but that row value is not the authority for settled history.

## Why a second artifact rather than a column

"How is my team doing" and "how am I doing" are different questions, and the
alternative — widening the per-Reviewer artifact — fails on its own terms. A
manager's file needs a per-Reviewer breakdown and the roster that goes with it;
adding either to `my-stats/{account}.txt` would put a Reviewer's colleagues'
figures in a file addressed to that Reviewer, to be filtered back out by the
page. The artifact would then be shaped by who *may* read it rather than by what
it is for.

Two artifacts raise the obvious objection — the same count now exists in two
places and could disagree. It cannot, because both are reduced from the one
`reviewer_activity_daily` aggregate by one publishing pipeline. Two files, one
measure. That is the property to preserve if either file changes.

The manager's file is also a genuine disclosure step-up over the Reviewer's: it
holds named individuals' historical volumes at a URL whose only key is a staff
number. ADR-0018 accepted that per-Reviewer files are not a security boundary
and the library ACL is; that acceptance is *reused* here rather than re-derived,
and it makes the `cora_report_feeds` ACL a real question for the **Forwarder**
rather than a formality.

## Attribution: the Staff Hierarchy, not the Case row

The **Staff Hierarchy** (`current_hierarchy`) is the only source in this system
of the edge "person X is managed by person Y". Nothing else has one: the review
platform cannot ask "every user whose manager is me" — ADR-0038 rejected that
reverse lookup as unbounded — and the Sync store lands only what the Case list
holds. So the choice is between that table and the Case row's
`assigned_reviewer_manager_name`, and the row loses on two counts.

It is **not the authority for this report**. The review platform now writes an
allocation-time `assignedReviewerManager` cache from its User Profile manager
lookup when a Reviewer claims a Case, but that cache is operational input for
bounded live queries. It can be explicitly `null` when the lookup is absent or
fails, and it is not frozen into a Reportable or planned reporting snapshot.
Settled history continues to join through the Staff Hierarchy.

The Case row is therefore **not a historical fallback**. A Case already
Reportable, or one whose allocation lookup failed, remains attributable here
only when the Staff Hierarchy supplies the relevant relationship; the cache's
empty value does not become an `(unassigned)` history bucket.

Joining costs nothing: `login_name` is already the canonical Reviewer key from
`CONTEXT.md` — the lower-cased bare account — so the join is a case-fold, not a
mapping. And because the hierarchy is complete by construction, an unmatched
Reviewer is a **breach of a stated invariant**, not a reporting gap: those rows
are quarantined and counted
([ADR-0007](0007-row-level-quarantine.md)) rather than absorbed into
`(unassigned)`. The run still publishes and the total still reconciles, but a
broken extract cannot masquerade as a quiet week — which is precisely what
silent absorption would let it do.

### What this costs, stated plainly

**Completed history is re-attributed on every reorg.** A Report Feed is
rewritten whole over 13 months on every run, so moving a Reviewer between
managers on Tuesday moves a year of their already-completed work on Tuesday
night. This is the shape ADR-0012's freeze-at-Reportable rationale exists to
prevent, reached through a side door, and it is accepted rather than solved.

Two things make it tolerable and one makes it temporary. The page states that
its figures are "as this team stands today" rather than "as it stood then", so
the number is not lying about what it is. Leavers retain their last real
manager in the hierarchy, so the common case — someone leaves — moves nothing.
And the Staff Hierarchy is **Reference Data** that is currently read directly
instead of ingested through its own medallion, contrary to this repository's own
rule; landing it properly is the intended destination, and accumulated silver
*is* the org-chart history that as-at-`reportable_date` attribution would need.
Until then that history is not being kept, so the period before the change can
never be attributed correctly in retrospect. `CONTEXT.md` carries this as a
flagged exception with that destination attached.

## Consequences

- **Selection and Reporting must read one hierarchy, not two.** The glossary's
  "Adviser hierarchy" and this Staff Hierarchy were the same table under a
  narrower name written when Selection was the only consumer. Collapsed to one
  term for one reason: two org-chart sources in one system drift, and a reader
  who assumes they agree will be wrong.
- **The Case row's manager field is a live-tail cache, not a second history
  authority.** The allocation surface writes a point-in-time User Profile
  manager so the browser can serve the bounded live tail. The settled bars
  still come from this Staff Hierarchy, and any future reconciliation of the
  cache is conditional work rather than part of this feed decision.
- **The envelope gains no roster array.** An earlier design carried the team
  roster in the file so the page could tail without the Case row field; the
  consumer decision went the other way, so the envelope stays as ADR-0018
  defines it, with rows and the two stamps.
- **Display names stay out of the artifact.** `CONTEXT.md`'s "this is a key,
  not display copy" holds: the feed carries accounts, and the page resolves
  names against the directory as `#/my-team` already does.
