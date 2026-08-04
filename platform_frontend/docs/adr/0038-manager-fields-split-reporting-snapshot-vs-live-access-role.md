# 38. The two manager fields split: `assignedReviewerManager` is a reporting snapshot, `responsiblePartyManager` is resolved live

Date: 2026-07-26

## Status

Accepted — amends [ADR-0011](./0011-section-level-role-based-access.md) and
[ADR-0037](./0037-question-level-remediation-resolution.md) (how the
`responsiblePartyManager` and `reviewerManager` Roles are resolved in
`resolveRoles`), and narrows one sentence of
[ADR-0022](./0022-two-axis-role-model.md)'s amendment (Responsible
Party Manager reads are not, in fact, query-filtered by the Case row field
today). [ADR-0012](./0012-outcome-snapshot-at-completion-for-reporting.md)'s
freeze rationale is extended to one more column, unchanged in substance.

This ADR is a decision about **semantics and mechanism**. It changes no code by
itself; the work it implies is listed in Consequences and is deliberately not
done here (#501).

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

### The app manufactures drift on its own

This is not only an HR-reorg problem. The self-allocation claim in
`src/pages/cora-dashboard.js` PATCHes:

```js
{
  assignedReviewer: tools.context.chrome.currentUser.id;
}
```

— the Reviewer and nothing else. The moment a Reviewer picks up an unassigned
Case, the Case's `assignedReviewerManager` is whatever the row was created with,
which for an unallocated Case is nothing meaningful. No writer anywhere in
`src/` sets either manager field. The first drift is introduced by the app on
its own first write, before any org chart moves.

### No detection

There is no reconciliation pass, no drift report, and no signal anywhere in the
app. Each report is internally consistent, so neither the outgoing nor the
incoming manager sees a discrepancy: the Case simply stays in one queue and
never appears in the other.

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
4. **Hybrid: denormalise, but repair on touch.** Keep the field for query speed,
   treat it as a cache, refresh it whenever the app already writes the row,
   reconcile the long tail on a schedule. Strong for the reporting field. On its
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
| Semantics     | **Historical**: current while `In-progress`, frozen at **Reportable** | **Current**: always resolved live                   |
| Authority     | The Case row column                                                   | The directory, at page load                         |
| Mechanism     | Denormalised cache, repaired on touch                                 | Read-time resolution                                |
| Stored column | Authoritative                                                         | Retained as a written record, **not** authoritative |

### `assignedReviewerManager` — a reporting snapshot, repaired on touch

The column stays, the `$filter` stays, and `#/team-cases` / `#/my-team` keep
their one-query-per-list shape. What changes is that the field acquires a
**defined meaning and a defined freeze point**, and the app becomes its writer:

- **While the Case is `In-progress`, the field means "who manages the Assigned
  Reviewer now".** The app writes it in the same PATCH that writes
  `assignedReviewer` — starting with the self-allocation claim in
  `cora-dashboard.js`, which today writes the reviewer alone — and refreshes it
  when the Case is opened and the resolved manager differs from the stored one.
  The resolution is a single forward lookup for one user, on the User Profile
  Service `GetPropertiesFor` call the client already makes in `resolveUsers`
  (`src/services/http-sharepoint-client.js`). It is bounded and it is on a page
  the app is loading anyway.
- **At the Reportable milestone the field freezes**, stamped by
  `CaseMachine._reportableSnapshot` (`src/lib/case-machine.js`) alongside
  `outcomeAtCompletion`, `hadRemediation` and `questionBankVersion`, and is never
  rewritten afterwards.
- **The long tail is accepted, not solved.** A Case that is touched by nobody
  between a reorg and its Reportable milestone freezes with a stale manager. That
  residual is what the scheduled job was buying, and it is a _reporting_ error of
  bounded size on a shrinking window. We do not build the job now. If the
  residual proves material in practice, a bounded reconciliation is a separate
  decision with real numbers behind it rather than a speculative second
  deployable.

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

The stored column is **retained and written** — set when the Responsible Party is
set, refreshed on the same repair-on-touch rule — because it is the audit record
of who was recorded as manager, and because it is the query key a future
Responsible Party Manager report will need. It simply stops deciding access. If
that report is built, the column is governed by the reporting half of this ADR,
not the access-control half.

Consistent with [ADR-0010](./0010-auth-and-permissions.md), none of this is a
security boundary: SharePoint list ACLs are. Live resolution makes the UI _honest_
about who may post; it does not authorise anything.

`assignedReviewerManager` continues to resolve the `reviewerManager` Role from
the row, as ADR-0037 decided. That Role is `read-only` everywhere it appears, so
the snapshot semantics are the correct ones for it too: a manager reads the Cases
their team worked, including the ones their team worked before the reorg.

### Question 1 — historical or current? Different answers per field

**This is the crux, and the two fields genuinely differ.**

**`assignedReviewerManager`: historical, frozen at Reportable.** A completed Case
belongs, permanently, to the manager who owned the Reviewer while the work was
done. Re-attributing it to a new manager would make last month's completed-volume
report change shape this month — precisely the failure ADR-0012 exists to
prevent, and for the same reason: a management report should say what was true at
the time, not the result of replaying today's org chart against yesterday's work.
Freezing at **Reportable** rather than `Completed` follows ADR-0023 and ADR-0012's
amendment, so all of a Case's historical stamps share one milestone. Before that
milestone the field must be _current_, because the live-queue half of the same
report (outstanding, overdue, workload) is a statement about who is accountable
**now**.

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
  "both" stops being a single coherent anomaly class: one side is a frozen column
  on a Case row, the other is a live directory edge.
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
- The reporting field keeps its one-`$filter`-per-list query shape; ADR-0031's
  bounded-query model is untouched.
- Both fields acquire a stated meaning. "Who is this Case's reviewer manager?"
  now has one answer that depends on the Case's status, and it is written down.
- No second deployable, no new SharePoint list, no new auth surface, no ETag race
  against `SaveQueue`.
- Historical reporting gains the same freeze guarantee the Outcome already has,
  at the same milestone.

**Negative**

- Two fields that look alike now behave differently. The names do not say so;
  the code comments and CONTEXT.md must, and a reader who assumes symmetry will
  be wrong.
- The Case page acquires a directory dependency on its load path for a
  _permission_. It must degrade honestly: if the manager lookup fails, the Role
  is not granted (fail closed) rather than falling back to the stale column,
  which would reintroduce exactly the defect being fixed.
- Repair-on-touch means the app writes the Case row for a reason unrelated to the
  Reviewer's work, so an opened-and-abandoned Case can produce a version-history
  entry. Cheap, but not invisible.
- The long tail of untouched Cases is knowingly left stale until Reportable. We
  are choosing a bounded reporting error over a scheduled writer.

**Implied follow-up work** (to be raised as separate tickets; not done here)

1. **Write the reviewer's manager alongside the reviewer.** The self-allocation
   claim in `src/pages/cora-dashboard.js` PATCHes `assignedReviewer` alone; it
   must also set `assignedReviewerManager`. Any future reassignment surface
   carries the same obligation.
2. **Add manager resolution to the `SharePointClient` interface** — a
   `resolveManagers(accountNames)` alongside `resolveUsers`, reading the User
   Profile `Manager` property from the `GetPropertiesFor` call
   `_resolveOneUser` already makes; mirrored in `MockSharePointClient` with a
   manager edge in `dev/fixtures/people.js`.
3. **Implement repair-on-touch and the freeze.** Refresh
   `assignedReviewerManager` (and the recorded `responsiblePartyManager`) while
   the Case is `In-progress` when the resolved value differs; stamp
   `assignedReviewerManager` in `CaseMachine._reportableSnapshot` and never
   rewrite it after.
4. **Switch `resolveRoles` to live resolution** for the
   `responsiblePartyManager` Role, with explicit fail-closed behaviour when the
   lookup fails, and tests covering the reorg case (former manager loses
   Conversation `edit`, incoming manager gains it, messages unchanged).
5. **If a Responsible Party Manager report is built**, it needs a
   `responsiblePartyManager` predicate in `ListCasesFilter` and a
   `ResponsiblePartyManager eq '…'` condition in `buildFilterExpr` — neither
   exists today — and it inherits the reporting-snapshot semantics above, not the
   live-resolution ones.
6. **Decide what `capabilities.isResponsiblePartyManager` is for.** It currently
   affects only the derivation of `isVisitor`. Once the Role resolves live it may
   be purely an Axis-2 list-access grant (ADR-0022) rather than a capability.
7. **Drift visibility, if the residual proves material.** The comparison this ADR
   makes at load — stored value versus resolved value — is exactly a drift
   signal; counting it is a small, separable piece of work, and it is the part of
   the rejected sync job worth keeping.
