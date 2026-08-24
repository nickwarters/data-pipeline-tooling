# 37. Remediation resolution is question-level, and the tab renders per audience

Date: 2026-07-25

## Status

Accepted — amends [ADR-0024](./0024-remediation-tracking-tab.md)
(per-action completion, Responsible Party `hidden`) and
[ADR-0011](./0011-section-level-role-based-access.md) (the Role set and the
Conversation's participants). Itself amended by
[ADR-0038](./0038-manager-fields-split-reporting-snapshot-vs-live-access-role.md):
because this ADR gave the **Responsible Party Manager** Role `edit` on the
Conversation, the Role is no longer resolved from the denormalised
`responsiblePartyManager` field but live from the directory. `reviewerManager`
is unaffected and keeps resolving from the allocation-time
`assignedReviewerManager` cache/query input. That field is not frozen into a
Reportable or planned reporting snapshot; settled history remains Staff
Hierarchy authoritative. The two-Section split,
the single case-level `remediationDueDate` and the reportable-freeze lifecycle
that ADR-0024 established are unchanged. Extended by
[ADR-0043](./0043-explicit-remediation-required-decision.md), which applies the
same permission/content split to the _pre-send_ transition: the Reviewer must
decide, per failure, whether remediation is required at all.

> **Update (#555):** the module this ADR was recorded against,
> `lib/case-review-view-model.js`, has since been renamed to
> `lib/case-loader.js`; the reference below uses the current name. The rename
> carried no behavioural change.

## Context

ADR-0024 defined the **Remediation** tab as per-**Remediation Action** tracking,
reading and writing each action's `status` inside an `actions`-typed Issue
Capture Field on the failed Answer (`Answer.capture[fieldKey]`).

Two things turned out to be wrong with that in practice.

**The tab never rendered.** No Case Type declares an `actions`-typed Issue
Capture Field — `complaints.js` has none — and the Reviewer's real selections are
written by the Issues tab to `answer.remediationActions` (plus
`answer.freeFormRemediation`). Every `remediation` cell in the access matrix
gated on the capture store, so the Section resolved `hidden` for every role on
every real Case, and the final-complete gate in `CaseMachine` was vacuously true.
The feature was unreachable rather than wrong-but-working.

**The unit of resolution is the Question, not the action.** A Reviewer chases
"has the remediation on this failure been done?", not the state of each
individual action; and the answer is often "partly". The two-value
`complete` / `cancelled` vocabulary had no way to say so.

Separately, the people who actually _do_ the remediation — the Responsible Party
(frontline adviser), their Manager, and the Journey Owner — could not see what
was outstanding at all (`hidden`, ADR-0024 D10). They need the breakdown; what
they must not have is the Reviewer's record-of-truth fields.

## Decision

### Resolution is recorded per Question

One row per **applicable, failed Question that carries remediation** — i.e. the
Answer has ≥1 selected Remediation Action or non-empty free-form remediation.
Failed Questions with no remediation attached never appear: attaching actions is
optional.

Each row resolves to one of three values, stored on the Answer:

```js
/** @typedef {'complete' | 'partial' | 'cancelled'} RemediationStatusValue
 *  @typedef {{ status: RemediationStatusValue, details?: string }} RemediationStatus */
```

`partial` requires **details**; `cancelled` requires a **justification**. Both
live in the same `details` field — the label differs, the storage does not.
`complete` carries no text.

The store is `answer.remediationStatus`, alongside the `remediationActions` the
row is derived from — the same Answer JSON blob on the Case row (ADR-0007), no
new list and no new column. `evaluators/remediation-status.js` is its only
reader/writer.

### The status is stored before it is valid

Picking `partial` writes `{ status: 'partial', details: '' }` immediately; the
Reviewer types afterwards. Validation is **not** a write-time throw (as the
ADR-0024 `cancelReason` rule was) but the _completion gate_: a row is
**resolved** only when it is `complete`, or `partial`/`cancelled` with non-empty
text. This keeps the select and its text box independently editable under
auto-save.

### Completion gate

An `Actions In Progress` Case closes to `Completed` only when **every** row is
resolved. The gate splits in two:

- **Permission** — `CaseMachine.mayResolveRemediation`: the Assigned Reviewer,
  `edit` on the Section, status `Actions In Progress`.
- **Content** — `readyToClose` in `completion-actions.js`, computed from the
  store's **live** catalogue and Answers.

CaseMachine holds a load-time snapshot of the Case, so leaving the content half
there (as ADR-0024 did) meant resolving the last row could not enable the button
without a reload. Vacuously true when the Case carries no remediation, so the
no-actions path is unaffected.

The getter is named `mayResolveRemediation`, not `canComplete…`, precisely
because it is only the permission half; both call sites re-wrap it in
`readyToClose`, and a name that sounded like the whole gate is the mistake this
ADR exists to correct.

While the content half is unmet the Assigned Reviewer sees the completion button
**disabled, with its reason underneath** rather than absent. Hiding it left the
gate legible only on the Remediation tab; from anywhere else the Case simply
looked uncloseable for no stated reason. A viewer without the permission half
still sees no button — the disabled control is the Reviewer's gate, not a notice
board.

The resolution shares the failure lifecycle of the remediation it resolves:
`materializeRemediationActions` strips `remediationStatus` when an Answer stops
failing, alongside `remediationActions` and `freeFormRemediation`. Left behind, a
re-failed Answer would render pre-resolved and the gate would count it as done.

### Two audiences, one breakdown

The Section's visibility gate becomes "the Case is reportable **and** the Case
carries remediation" — where the second half is the tab's own row count, not a
separate reading of the Answers blob (Amendment 2). Both audiences see the same
rows; `remediationAudience()`
(in `services/section-access.js`, derived from the viewer's roles) selects the
rendering:

| Audience           | Roles                                                                               | Sees                                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reviewer`         | Assigned Reviewer, other Reviewers, **Reviewer Manager**, Case Type Owner, Controls | The breakdown; the Assigned Reviewer additionally gets the resolution select and its details/justification box                                                     |
| `responsibleParty` | Responsible Party, Responsible Party Manager, Journey Owner                         | The breakdown and each row's status — **none** of the Reviewer's fields, and not the details text behind them — plus a call to action opening the **Conversation** |

The Conversation stays the Responsible Party side's only interface for
discussing remediation and reporting it done (ADR-0024 D10 is preserved in
substance: they still never edit the record). What changes is that they can now
_read_ what is outstanding instead of inferring it from the thread.

Because that call to action must lead somewhere, the **Responsible Party
Manager** becomes a Conversation participant: `edit`, subject to the same Case
Type `allowMessagesWhen` status gate as the Assigned Reviewer and the
Responsible Party. ADR-0011 excluded them on the grounds that the thread is
between the Reviewer and the Case's Responsible Party; in practice the Manager
is the one who chases outstanding remediation, and sending them to a Section
they cannot open would make the prompt a dead end. The Journey Owner keeps
`read-only` — they observe the thread, they do not work the remediation.

Reviewer-side wins when a viewer holds roles on both sides, mirroring the
most-permissive rule in `evaluateAccess`.

### `reviewerManager` becomes a Section-access Role, scoped to the Case

`capabilities.isReviewerManager` already existed (the `Reviewer Managers` group)
but had no cell in the access matrix. It is added as a Role — read-only wherever
a non-assigned Reviewer is read-only, including the Remediation breakdown — and
composes with whatever else the viewer is on the Case.

It is resolved **from the Case row**, `assignedReviewerManager === userId`,
exactly as `responsiblePartyManager` is, and _not_ from the platform-wide
`Reviewer Managers` group. That field already exists on every Case row and is the
allocation-time operational cache/query input for the live team reads and this
scoped Role, while settled `#/team-stats` history remains Staff Hierarchy
authoritative. It is not a planned Reportable snapshot, and no
`#/reports/reviewer-team` route ever existed, so scoping costs nothing and keeps
the Role in line with every other non-assigned role in `resolveRoles`:
each is scoped by something Case-specific. Resolving it from the group would have
made a Reviewer Manager a platform-wide reader of every Case of every Case Type —
a second unscoped Role beside `controls`, which ADR-0022 decided deliberately and
in its own right. Nothing here justified that, and it would have handed tabs to
users whose SharePoint list ACLs may not permit the underlying read (a 403 on
fetch is a worse failure than the access-denied panel they got before).

A consequence worth stating: **Reviewer Manager and Responsible Party Manager now
compose safely.** CONTEXT.md records a Maintainer convention that a user is one or
the other, never both; with both Roles resolved per Case and
`remediationAudience` resolving reviewer-side-wins, no code depends on that
convention any more. ADR-0038 revisits the resolution sources — the Roles no
longer share one — and decides that reconciliation machinery should not police
the convention either.

## Amendment 1 (2026-07, #502) — "carries remediation" has one definition, and free-form counts

This ADR defined a remediation row as an Answer with "≥1 selected Remediation
Action **or** non-empty free-form remediation", and `answerRemediation`
implements exactly that. The **Send Actions** fork did not.
`hasRemediationActions` in `completion-actions.js` counted only
`remediationActions`, and `CaseMachine._reportableSnapshot` stamped
`hadRemediation` the same narrow way.

The consequence was a Case whose only remediation was free-form text going
**straight to `Completed`**: never reportable-with-actions, never stamped with a
`remediationDueDate`, and the Responsible Party never asked to do the thing the
Reviewer had written down for them — while the Remediation tab, had it been
reachable, would have listed that very row.

**Decision. Free-form remediation counts as remediation, and there is one
predicate.** The two rival copies are **deleted**: `hasRemediationActions` is
gone from `completion-actions.js`, and `CaseMachine` no longer spells the check
out for itself. Adding the free-form check in a second place would have
recreated the split it was meant to close.

(The predicate this amendment first landed on — `hasRemediation(answers)`, over
the Answers blob alone — turned out to be a _different_ fact from the one the
tab renders. See Amendment 2 below, which replaces it.)

The alternative — narrowing `answerRemediation` so free-form did _not_ count —
was rejected: it would silently drop rows the Remediation tab renders today,
and it contradicts what a Reviewer typing into the box plainly means.

**This changes lifecycle behaviour, deliberately.** A Case whose only
remediation is free-form used to close in one click; it now goes to
`Actions In Progress`, acquires the case-level `remediationDueDate` (+10 working
days) and its SLA, and closes only once the Reviewer resolves the row on the
Remediation tab. That is the intended effect, not a side effect: such a Case
always _had_ outstanding remediation, and the old fork simply did not see it.
`hadRemediation` / `effectiveHadRemediation` widen with it, so reporting counts
these Cases as having had remediation from now on. Cases already `Completed` are
frozen and are not revisited.

## Amendment 2 (2026-07, #502) — "carries remediation" is a question about the _rows_, so it is catalogue-aware

Amendment 1 made one predicate out of two. It picked the wrong one.

`hasRemediation(answers)` read the Answers blob alone. `remediationRows` — the
tab, and therefore `remediationComplete` and the completion gate — additionally
requires the Question to be **in the loaded catalogue, applicable and failing**.
`hasRemediation` was a strict **superset**, so a superset predicate decided the
lifecycle while a subset predicate decided resolvability. That is the same split
Amendment 1 set out to close, relocated.

The gap is reachable through **sanctioned operations only**. A Reviewer fails a
Question and types free-form remediation; a Case Type Owner then marks that
Question `deprecated` — the operation CLAUDE.md _mandates_ instead of deletion —
or republishes the bank with different `optionOutcomes` or `showWhen`. Either
way `case-loader.js` drops it from the catalogue, or it stops being
applicable, or it stops failing. The Answer keeps its remediation; the tab has no
row for it. The Reviewer reopened the Case to a **Send Actions** button, a
transition to `Actions In Progress`, a stamped `remediationDueDate` and
`hadRemediation: true`, and a visible Remediation tab reading "No remediation
actions sent." beside that SLA date — with an **Overdue** badge ten working days
later. `remediationComplete` was vacuously true over the empty row set, so the
Case closed; and the Responsible Party's `#/my-cases` "Outstanding remediation"
table then listed it **permanently**, because `remediationStatus` had never been
written and could never be — its only writer is a row the tab does not render.

**Decision. "This Case carries remediation" means "the Remediation tab has ≥1
row", and nothing else.** `hasTrackableRemediation(catalogue, answers)` in
`evaluators/remediation-status.js` _is_ `remediationRows(...).length > 0`, and it
is what the **Send Actions** fork, `CaseMachine`'s `hadRemediation` stamp and the
Section's visibility gate all read. `hasRemediation(answers)` is **deleted**:
there is no longer an Answers-blob-only reading of the question to drift back to.
`answerRemediation` survives, because "what remediation is written against _one_
Answer" genuinely is answerable from the blob.

**What happens when a Question carrying remediation leaves the catalogue: the
remediation is _orphaned_, not outstanding.** This is the substantive choice, and
the alternative — widening the tab so an out-of-catalogue Answer still gets a
resolvable row — was rejected. The app already holds this rule:
`materializeRemediationActions` strips `remediationActions`,
`freeFormRemediation` and `remediationStatus` the moment an Answer stops failing,
precisely so a stale instruction cannot outlive the finding it was attached to.
Deprecation and republication are the same event; the strip cannot reach them
only because the Question is no longer there to iterate over. Rendering a row for
a Question the Reviewer can no longer see, read or re-answer would ask them to
resolve an instruction whose basis the Case no longer contains — and would make
the Remediation tab the one surface where a retired Question Definition lives on.

The Reviewer still cannot get stuck: `remediationComplete` remains vacuously true
over an empty row set, so every path to `Completed` stays satisfiable.

Three call sites had to acquire the resolved catalogue — the live bank while
`In-progress`, the stamped versioned export once reportable (ADR-0021):
`CaseMachine` takes it as a constructor option and hands it to `evaluateAccess`,
which passes it to the Remediation cells. A CaseMachine built without one sees no
Questions, so Remediation resolves `hidden` and a transition stamps
`hadRemediation: false` — which was correct for `cora-conversation-view.js`, the
one caller that built a machine for the Conversation cell alone. That page was
removed in #790 as a second, ungated route to a Case's Conversation, so
`CaseLoader` is now the only production caller and it always supplies the
catalogue. The catalogue-less default stands as the safe reading, not as a shape
the app still exercises.

The fourth surface, the **Responsible Party dashboard**, cannot have a catalogue:
it lists Cases across every Case Type and loading a bank per row is exactly the
unbounded read ADR-0031 exists to prevent. It keeps reading the blob and is
instead scoped to `Actions In Progress` — see ADR-0024's #497 amendment for why
that bounds the superset rather than merely making it rarer.

Bounded is not eliminated, and the difference is worth stating. The scoping holds
at _entry_ (a Case reaches `Actions In Progress` only with ≥1 real row) and at
_exit_ (it cannot leave until every row is resolved), so no work shown there is
permanently unresolvable — which is the defect this amendment fixes. It is not a
continuous invariant: deprecate a Question mid-Case and the dashboard lists an
orphaned instruction the tab no longer renders, until the Reviewer resolves the
remaining rows and the Case closes. That window is transient and self-clearing,
and it is the accepted residue of not loading a bank per dashboard row.

**Reporting note.** `hadRemediation` / `effectiveHadRemediation` narrow slightly
against Amendment 1: a Case whose only remediation is orphaned is now stamped
`false`. That is the honest value — no remediation was ever sent, and no SLA
started. Cases already stamped are frozen and are not revisited.

**There is therefore a reporting discontinuity at the deployment boundary, and
anyone reading a had-remediation trend needs to know it exists.** Because stamped
rows are frozen (ADR-0012) and deliberately not migrated, a report spanning the
deploy mixes two definitions of the same column:

| Stamped            | `hadRemediation: true` means                                                             |
| ------------------ | ---------------------------------------------------------------------------------------- |
| Before Amendment 1 | The Reviewer ticked ≥1 configured Remediation Action                                     |
| Amendment 1 onward | …or typed free-form text (a widening)                                                    |
| Amendment 2 onward | …and the Question is still in the catalogue, applicable and failing (a slight narrowing) |

The **Responsible Party Manager report** (12 months, broken down by
had-remediation) is exactly such a report, so expect a step **up** in the
had-remediation share at the deploy date — free-form-only Cases start counting,
and they are the larger of the two effects. That step is a definition change, not
a change in how Reviewers work and not a data bug. Migrating the old rows was
rejected: the pre-Amendment-1 stamp is a faithful record of what the app decided
at the time, and ADR-0012 freezes reportable rows precisely so a later rule
cannot rewrite history.

## Considered options

- **Keep per-action resolution and add an `actions`-typed capture field to every
  Case Type** — rejected: it fixes the invisibility but not the vocabulary, and
  it makes every Case Type carry configuration for a field the Issues tab does
  not author.
- **Roll `partial` up from per-action states** (some complete, some cancelled ⇒
  partial) — rejected: the Reviewer's judgement about _the remediation as a
  whole_ is not mechanically derivable from action states, and the required
  details would have nowhere to live.
- **Throw on `partial`/`cancelled` without text**, as ADR-0024 did for
  `cancelReason` — rejected: under a debounced auto-save the Reviewer picks the
  status before typing, so the write must be allowed to land unfinished. The
  gate refuses the _Case_, not the keystroke.
- **Give the Responsible Party side the resolution controls** — rejected, as in
  ADR-0024: the Reviewer owns the record of truth.
- **A second messaging surface on the Remediation tab** — rejected: the
  Conversation exists; the tab links to it.

## Consequences

**Positive**

- The Remediation tab renders on real Cases for the first time.
- The completion gate is live: a Case with unresolved remediation cannot close,
  the reason is stated on the button itself, and it enables the moment the last
  row is resolved.
- The people doing the work can see what is outstanding.

**Negative**

- The per-action `status` / `cancelReason` machinery from ADR-0024
  (`evaluators/remediation-actions.js`) is no longer read by the Remediation tab
  or the access matrix. It remains in use by `summary-model.js` and its Summary
  block, which still reports capture-field actions — a store no Case Type
  populates, which is the same blind spot that made the Remediation tab
  invisible. The concrete symptom is a Reviewer seeing a full breakdown on
  **Remediation** and an empty remediation block on **Summary**. Out of scope
  here; tracked as the remaining half of
  [#497](https://github.com/nickwarters/case-review-frontend-framework/issues/497),
  which this ADR closes only the tracking side of.
- `remediationRows` caches its last result against the _identity_ of the
  catalogue and Answers it was given, because both the tab and the completion
  gate ask for it on every render. That is safe only while Answers maps are
  replaced rather than mutated in place — which is how every writer in the app
  behaves, but it is now load-bearing.
- Adding a Role widens the access matrix by a column: every Section now declares
  a `reviewerManager` cell.
- The Conversation gains a third participant. Threads on Cases with a
  Responsible Party Manager may now carry messages from someone ADR-0011's
  participant list did not anticipate; nothing reads that list programmatically,
  but reporting or export work that assumes a two-party thread should not.

## Amendment 1 (2026-07, #597) — the resolution _offer_ is per Case Type

The three resolutions above are the framework's, and they remain so. What is now
per Case Type is which of them a Reviewer is **offered**: a Case Type may declare
`remediationStatuses` (e.g. Complaints' `['complete', 'cancelled']`) to narrow
the select. It _selects_ from the vocabulary and never invents a value, and
`complete` may not be dropped — without it no row could ever be resolved and no
Case could ever complete. `scripts/verify-config.js` fails both an empty list
and one omitting `complete`; `tsc` already rejects an unknown value at the
declaration site.

This is a legitimate descriptor under
[ADR-0035](./0035-case-type-descriptors-express-variation-behaviour-stays-in-code.md): it selects
from a fixed set of stable keys and changes no behaviour. Everything decided
here is unchanged — the store (`remediationStatus: { status, details? }`), the
free-text requirement on `partial` / `cancelled`, and the completion gate all
still validate against the **full** framework vocabulary. The narrowing is
display-only, deliberately: gating the write on the Case Type's set would strand
a row resolved before the Case Type narrowed its offer. For the same reason the
Remediation tab keeps a stored-but-no-longer-offered value as an option on that
row's select, because a browser drops a `<select>` value with no matching
`<option>` and the row would otherwise read as unresolved with no way to restore
it.
