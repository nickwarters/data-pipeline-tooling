# 38. The two manager fields split: `assignedReviewerManager` is an allocation cache, `responsiblePartyManager` is resolved live

Date: 2026-07-26

## Status

Accepted — amends [ADR-0011](./0011-section-level-role-based-access.md) and
[ADR-0037](./0037-question-level-remediation-resolution.md) (how the
`responsiblePartyManager` and `reviewerManager` Roles are resolved in
`resolveRoles`), and narrows one sentence of
[ADR-0022](./0022-two-axis-role-model.md)'s amendment (Responsible
Party Manager reads are not, in fact, query-filtered by the Case row field
today). [ADR-0012](./0012-outcome-snapshot-at-completion-for-reporting.md)'s
freeze rationale remains applicable to the Outcome/reporting columns; this ADR
does not extend it to the allocation cache.

This ADR is a decision about **semantics and mechanism**. The allocation-time
Reviewer-manager stamp is now implemented; repair-on-touch, reconciliation and
any Reportable freeze remain conditional future work, not behavior promised by
this ADR.

## Context

Two manager relationships are denormalised onto every Case row
(`CaseRow` in `src/sharepoint-client.js`):

- **`assignedReviewerManager`** — "Reviewer X is managed by Reviewer Manager Y"
- **`responsiblePartyManager`** — "Responsible Party X is managed by Responsible
  Party Manager Y"

Both are copies of a **mutable** fact — an org-chart edge — living on an
**append-mostly** row. Nothing keeps the copies honest. People move between
managers constantly: reorganisations, leavers, secondments, and new starters
mis-assigned on day one.

### What each field is actually used for today

They look symmetric. They are not, and the asymmetry is the whole decision.

**`assignedReviewerManager` is a query key.** It is the only manager field with
a predicate: `ListCasesFilter` declares `assignedReviewerManager`, and
`buildFilterExpr` in `src/services/http-sharepoint-client.js` emits
`AssignedReviewerManager eq '…'`. `fetchTeamCases` and `fetchTeamWorkloadCases`
(`src/services/team-cases-fetcher.js`) both pass it into
`listCasesAcrossSources`, so `#/team-cases` and `#/my-team` are one server-side
`$filter` per Case Type list. That is exactly what the denormalisation bought,
and it is real: the alternative for a manager's whole team is an unbounded
reverse lookup ("every user whose manager is me"), which the SharePoint reads
available to this app cannot do cheaply and which
[ADR-0031](./0031-scaling-against-the-list-view-threshold.md) rules out at
list-view-threshold scale.

**`responsiblePartyManager` is not a query key at all.** There is no
`responsiblePartyManager` in `ListCasesFilter`, no `ResponsiblePartyManager`
condition in `buildFilterExpr`, and no predicate in
`MockSharePointClient`'s filter loop. `#/my-cases` — the only responsible-party
surface that exists — filters on `responsibleParty: currentUserId`, i.e. the
Adviser's own Cases. **No Responsible Party Manager report has been built.**
`capabilities.isResponsiblePartyManager` is resolved in
`src/services/permissions.js` and then gates nothing except the derivation of
`isVisitor`.

The field's one live reader is `resolveRoles` in
`src/services/section-access.js`:

```js
if (caseRow.responsiblePartyManager === userId) {
  roles.push('responsiblePartyManager');
}
```

Since #500 / ADR-0037 that Role carries `read-only` on **Remediation** and
**`edit` on Conversation** (`postsWhenAllowed`). So the field is, today, a
**pure access-control input** paying no query-cost dividend whatsoever. A stale
row means a _former_ manager keeps posting rights on a live thread and the
current one has none. That is categorically different from a wrong report row,
and it is new — before ADR-0037 the Role was read-only everywhere it appeared.

### Allocation records an operational cache

This is not only an HR-reorg problem. The self-allocation claim in
`src/pages/cora-dashboard.js` now resolves the current Reviewer's manager and
PATCHes both fields together:

```js
{
  assignedReviewer: tools.context.chrome.currentUser.id,
  assignedReviewerManager: resolvedManagerOrNull
}
```

The lookup is an allocation-time operational cache for the bounded live team
query and the row-scoped Reviewer Manager Role. A failed or unusable lookup
writes explicit `null`, so stale candidate data is never carried into a claim.
The cache is not the authority for settled history: the Staff Hierarchy remains
the source for the planned Report Feed.

### No detection

There is no repair-on-touch or reconciliation pass, no drift report, and no
signal anywhere in the app. Existing rows can therefore remain empty or stale;
the allocation stamp fixes the app's own claim path but does not rewrite the
long tail.

### The plan of record, and why it needs writing down

The standing plan was an off-platform processing job rewriting both fields on a
schedule. Its costs, which #501 asks be recorded before committing: an
out-of-band writer touching Case rows must reason about ETag concurrency against
`SaveQueue` (ADR-0008); it lands changes at an interval rather than at the event;
it is a second deployable with its own auth, schedule and failure modes; and it
puts an access-control-relevant field under a process the app can neither see nor
explain to the user whose access it decides.

## Considered options

1. **Off-platform sync job for both fields** (plan of record). Cheapest to
   reason about and requires no frontend change. Costs as above. Its worst
   property is not the deployable — it is that the interval is a _permission_
   interval: between reorg and next run, the wrong person can post. It also has
   to win an ETag race with `SaveQueue` on rows a Reviewer is actively
   auto-saving. If chosen it should at minimum emit a drift count, which is the
   one part of it worth keeping regardless.
2. **Resolve both at read time** from the group or user profile. Correct by
   construction, no second deployable, no schedule. But it costs precisely what
   the denormalisation bought: the report query degrades from one bounded
   `$filter` per list to "enumerate my team, then filter by an `in`-list of
   reviewers" — with no roster endpoint in the client, an unbounded team size,
   and an OData expression whose length grows with headcount. For the _case
   page_ the same idea is free (see Decision); for the _reports_ it is the thing
   ADR-0031 exists to prevent.
3. **A `user → manager` mapping list in SharePoint**, Maintainer-maintained,
   joined by reports. On-platform, auditable, one place to fix. But joining it
   server-side is not possible across lists, so reports would fetch the mapping
   and re-express the filter as an `in`-list — option 2's cost with an extra
   list to provision, plus a new hand-maintained artifact that drifts from the
   directory exactly as the Case row does. It moves the staleness rather than
   removing it.
4. **Hybrid: denormalise, with future repair on touch.** Keep the field for
   query speed and treat it as a cache. A future change could refresh it when
   the app already writes the row and, if measured drift justifies it,
   reconcile the long tail on a schedule. That is not current behavior. On its
   own it is weak for the access-control field: a Case nobody touches is exactly
   the Case where a stale posting right survives longest, and "touch" is a
   Reviewer-side event while the drifting relationship is frontline-side.
5. **Split the two relationships** and give each the mechanism its tolerance
   justifies. More concepts to hold, and the two fields stop looking alike in a
   codebase where they currently sit adjacent in every list. Accepted anyway,
   because they _are not alike_, and one mechanism for both is what made this
   hard: it forces the reporting field's staleness tolerance onto a permission,
   or the permission's freshness requirement onto a query the platform cannot
   afford.

Option 5 is adopted as the frame, resolved as a combination of 4 (for the
reporting field) and 2 (for the access-control field).

## Decision

### The two fields are different species and stop sharing a mechanism

|               | `assignedReviewerManager`                                             | `responsiblePartyManager`                           |
| ------------- | --------------------------------------------------------------------- | --------------------------------------------------- |
| Purpose       | Reporting / query key                                                 | Section access Role                                 |
| Semantics     | **Operational**: allocation-time cache/query input                   | **Current**: always resolved live                   |
| Authority     | Case row for live queries; Staff Hierarchy for settled history        | The directory, at page load                         |
| Mechanism     | Allocation-time lookup and same-PATCH stamp                           | Read-time resolution                                |
| Stored column | Operational input, not a frozen reporting snapshot                   | Retained as a written record, **not** authoritative |

### `assignedReviewerManager` — an allocation-time cache, with future repair conditional

The column stays, the `$filter` stays, and `#/team-cases` / `#/my-team` keep
their one-query-per-list shape. What changes is that the field acquires a
defined operational meaning, and the allocation surface becomes its writer:

- **At allocation, the field means "the manager resolved for the Assigned
  Reviewer at claim time".** The app writes it in the same PATCH that writes
  `assignedReviewer`, starting with the self-allocation claim in
  `cora-dashboard.js`. The lookup is one per allocation request, reused across
  candidate attempts; a missing, rejected or unusable result writes explicit
  `null`, and a manager-side write failure can fall back to the same null write.
- **There is no Reportable freeze.** The field remains an operational cache for
  bounded live queries and the row-scoped Reviewer Manager Role. Settled history
  and the planned Report Feed remain Staff Hierarchy authoritative; the Case row
  is not a historical reporting snapshot.
- **Repair-on-touch and reconciliation are future, conditional work.** Existing
  rows, rows allocated before this stamp, and rows whose lookup failed may be
  empty or stale. A future repair or reconciliation policy would require a
  separate decision based on observed drift; none is built or implied here.

### `responsiblePartyManager` — the Role is resolved live; the column is a record

`resolveRoles` stops treating `caseRow.responsiblePartyManager` as the authority
for the `responsiblePartyManager` Role. Instead the role is resolved from the
**currently resolved manager of the Case's Responsible Party**, obtained at Case
load in the same directory read the page already performs.

Three things make this cheap here and not in the reports:

- **The direction is forward and single-valued.** The question on the Case page
  is "is _this viewer_ the manager of _this Case's_ Responsible Party?" — one
  profile read for one user, compared to one id. The report's question is the
  reverse ("every Case whose reviewer I manage"), which is the unbounded one.
- **The read already happens.** `resolveUsers` / `GetPropertiesFor` is already on
  the Case page's load path for display-name resolution; the manager edge is
  another property of a profile the app is already fetching.
- **The Responsible Party itself is fixed.** CONTEXT.md: the Assigned Reviewer
  sets it before Send Actions and it cannot change after. So the identity whose
  manager we resolve is stable; only the manager edge moves.

The stored column is **retained as a record** and may be written by a future
Responsible Party assignment or repair policy, because it is the audit record of
who was recorded as manager and could be the query key a future Responsible
Party Manager report needs. No repair-on-touch policy is current behavior. The
column simply stops deciding access. If that report is built, its semantics need
their own decision rather than being inferred from this access-control rule.

Consistent with [ADR-0010](./0010-auth-and-permissions.md), none of this is a
security boundary: SharePoint list ACLs are. Live resolution makes the UI _honest_
about who may post; it does not authorise anything.

`assignedReviewerManager` continues to resolve the `reviewerManager` Role from
the row, as ADR-0037 decided. That Role is `read-only` everywhere it appears,
so the allocation cache is a bounded live-query/access input; it does not turn
the row into settled reporting history. The Staff Hierarchy remains the
authority for that history.

### Question 1 — historical or current? Different answers per field

**This is the crux, and the two fields genuinely differ.**

**`assignedReviewerManager`: operational, populated at allocation.** The row
records the manager resolved when the Reviewer claimed the Case so bounded live
team queries and the row-scoped Reviewer Manager Role have a usable input. It is
not frozen at **Reportable**, and it is not the authority for settled history:
the Staff Hierarchy owns that attribution. Reconciliation or other repair is a
future, conditional choice rather than current behavior.

**`responsiblePartyManager`: current, always, with no historical form.** A
permission is a claim about the present tense. A frozen permission is a former
manager retaining posting rights on a live thread — the defect, not a feature.
There is no reading under which "who managed this Adviser in March" should decide
who may post in July. The historical form of this relationship is not absent, it
is simply not a permission: it lives in the retained column and in the
Conversation's own message authorship, which records who actually spoke.

### Question 2 — in-flight Conversations when a Responsible Party Manager changes

- **The outgoing manager loses posting rights immediately** — concretely, at the
  next Case load, because `resolveRoles` runs at mount and the Conversation cell
  is `postsWhenAllowed`. A manager mid-session keeps a resolved Role until they
  navigate; that window is a UX artefact, and the write is refused by the list
  ACL, not by us (ADR-0010). There is **no grace period and no read-only
  wind-down**: a manager who has handed over their team has handed over the
  thread. They do keep whatever read access their other Roles give them, which is
  usually none.
- **Their existing messages stay, attributed to them.** A Message is
  `{ author, timestamp, body }` appended to a JSON blob on the Case row
  (ADR-0007); nothing rewrites authorship, and this ADR introduces nothing that
  does. The Conversation is the record of what was said, not a roster of who may
  speak. Deleting or re-attributing the outgoing manager's messages would destroy
  the remediation trail that the thread exists to be.
- **The incoming manager gains `edit` at the same moment** and reads the entire
  prior thread, including their predecessor's messages. That is the handover: the
  thread is self-describing.
- **No system-authored handover message is generated.** The model has exactly one
  Message species — a person, a time, a body — and a synthetic author would be a
  second one, visible to every existing reader and to the JSON blob's every
  future consumer, for a fact the thread already makes evident.

### Question 3 — should reconciliation machinery check "never both"?

CONTEXT.md records a Maintainer convention that a user is either a Reviewer
Manager _or_ a Responsible Party Manager, never both, enforced by convention and
not by code. **No.**

- ADR-0037 already established that **nothing depends on it**: both Roles are
  resolved per Case, they compose through the most-permissive rule in
  `evaluateAccess`, and `remediationAudience` resolves reviewer-side-wins. A user
  holding both gets a defined, safe result.
- Under this ADR the two relationships no longer share a mechanism at all, so
  "both" stops being a single coherent anomaly class: one side is an
  allocation-time cache column on a Case row, the other is a live directory
  edge.
- The app has no roster to check it against. `isReviewerManager` comes from
  membership of the `Reviewer Managers` SharePoint group (`permissions.js`);
  checking the invariant means crawling group membership for every user named in
  a manager field — real machinery, for an invariant with no dependent.

If it ever becomes load-bearing, it belongs in the permissions layer as an
assertion about groups (ADR-0022's Axis 1), not in a pass over Case rows. What
reconciliation _should_ surface, if it is ever built, is drift itself: the count
of Cases whose stored manager differs from the resolved one.

## Consequences

**Positive**

- The access-control field becomes correct by construction. A stale row can no
  longer grant a former manager posting rights, and no scheduled process stands
  between a reorg and the permission it changes.
- The allocation field keeps its one-`$filter`-per-list query shape; ADR-0031's
  bounded-query model is untouched, while settled reporting remains hierarchy-
  attributed.
- Both fields acquire a stated meaning. "Who is this Case's reviewer manager?"
  has an operational allocation value for live reads, while the settled-history
  answer comes from the Staff Hierarchy.
- No second deployable, no new SharePoint list, no new auth surface, no ETag race
  against `SaveQueue`.

**Negative**

- Two fields that look alike now behave differently. The names do not say so;
  the code comments and CONTEXT.md must, and a reader who assumes symmetry will
  be wrong.
- The Case page acquires a directory dependency on its load path for a
  _permission_. It must degrade honestly: if the manager lookup fails, the Role
  is not granted (fail closed) rather than falling back to the stale column,
  which would reintroduce exactly the defect being fixed.
- A future repair-on-touch would write the Case row for a reason unrelated to the
  Reviewer's work, so an opened-and-abandoned Case could produce a version-history
  entry. That trade-off is not chosen by this change.
- The long tail of untouched or previously allocated Cases can remain empty or
  stale. Reconciliation is conditional future work, not a scheduled writer the
  current app promises.

**Implied follow-up work** (to be raised as separate tickets; not done here)

1. ~~**Write the reviewer's manager alongside the reviewer.**~~ The
   self-allocation claim now resolves the manager once per allocation request
   and writes `assignedReviewerManager` in the same PATCH, failing closed to
   explicit `null`; any future reassignment surface carries the same obligation.
2. ~~**Add manager resolution to the `SharePointClient` interface** — a
   `resolveManagers(accountNames)` alongside `resolveUsers`, reading the User
   Profile `Manager` property from the `GetPropertiesFor` call used for profile
   resolution; mirrored in `MockSharePointClient` with a manager edge in
   `dev/fixtures/people.js`.~~ Done in #489.
3. **Consider repair-on-touch or reconciliation, conditionally.** Measure
   whether the allocation cache's empty/stale tail warrants a future repair
   policy. Do not stamp `assignedReviewerManager` in
   `CaseMachine._reportableSnapshot`: settled reporting remains Staff Hierarchy
   authoritative.
4. **Switch `resolveRoles` to live resolution** for the
   `responsiblePartyManager` Role, with explicit fail-closed behaviour when the
   lookup fails, and tests covering the reorg case (former manager loses
   Conversation `edit`, incoming manager gains it, messages unchanged).
5. **If a Responsible Party Manager report is built**, it needs a
   `responsiblePartyManager` predicate in `ListCasesFilter` and a
   `ResponsiblePartyManager eq '…'` condition in `buildFilterExpr` — neither
   exists today — and would need its own explicit reporting semantics rather
   than inheriting either this cache or the live-resolution rule.
6. **Decide what `capabilities.isResponsiblePartyManager` is for.** It currently
   affects only the derivation of `isVisitor`. Once the Role resolves live it may
   be purely an Axis-2 list-access grant (ADR-0022) rather than a capability.
7. **Drift visibility, if the residual proves material.** A future comparison of
   the allocation cache with the Staff Hierarchy could count drift, but it is a
   separate, conditional piece of work rather than a current reconciliation
   signal.
