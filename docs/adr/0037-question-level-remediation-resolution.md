# 37. Remediation resolution is question-level, and the tab renders per audience

Date: 2026-07-25

## Status

Accepted — amends [ADR-0024](./0024-remediation-tracking-tab.md)
(per-action completion, Responsible Party `hidden`) and
[ADR-0011](./0011-section-level-role-based-access.md) (the Role set and the
Conversation's participants). The two-Section split,
the single case-level `remediationDueDate` and the reportable-freeze lifecycle
that ADR-0024 established are unchanged.

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

The Section's visibility gate becomes "the Case is reportable **and** ≥1 Answer
carries remediation". Both audiences see the same rows; `remediationAudience()`
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
`Reviewer Managers` group. That field already exists on every Case row and
already drives the `#/reports/reviewer-team` report, so scoping costs nothing and
keeps the Role in line with every other non-assigned role in `resolveRoles`:
each is scoped by something Case-specific. Resolving it from the group would have
made a Reviewer Manager a platform-wide reader of every Case of every Case Type —
a second unscoped Role beside `controls`, which ADR-0022 decided deliberately and
in its own right. Nothing here justified that, and it would have handed tabs to
users whose SharePoint list ACLs may not permit the underlying read (a 403 on
fetch is a worse failure than the access-denied panel they got before).

A consequence worth stating: **Reviewer Manager and Responsible Party Manager now
compose safely.** CONTEXT.md records a Maintainer convention that a user is one or
the other, never both; with both Roles resolved from Case row fields and
`remediationAudience` resolving reviewer-side-wins, no code depends on that
convention any more.

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
