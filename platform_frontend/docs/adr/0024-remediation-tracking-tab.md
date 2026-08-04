# 24. Remediation tracking tab: per-action completion, split from Issue capture

Date: 2026-07-01

## Status

Accepted (resolves the parked #144; amends [ADR-0007], [ADR-0011], [ADR-0016];
builds on [ADR-0020]), partly amended by
[ADR-0037](./0037-question-level-remediation-resolution.md) and, for the
per-action record's write path, by **Amendment (2026-07, #497)** below.

The two-Section split (Issues = capture, Remediation = tracking), the single
case-level `remediationDueDate` and the reportable-freeze lifecycle remain
current. ADR-0037 replaces the _unit_ of tracking (per Question, not per
Remediation Action), its vocabulary (`complete` / `partial` / `cancelled` with
required details or justification), the store it reads
(`answer.remediationStatus` beside `answer.remediationActions`, not the
`actions`-typed capture field), and the Responsible Party's `hidden` cell.
Rendering and event handling follow
[ADR-0034](./0034-store-driven-views-supersede-component-owned-state.md).

## Context

The standalone **Remediation** tab has been parked since the Jun 2026 restructure (#144,
"purpose undefined"). Today the single Section key `remediation` **is** the "Issues" tab
— where a Reviewer captures failed-Answer detail and **Remediation Actions** via the
[ADR-0020] capture engine (CONTEXT.md: "Issues = UI label for the Remediation Section").

Tester feedback defines the Remediation tab's real purpose: after actions are **sent** to
the Responsible Party ([ADR-0023] `Actions In Progress`), the Reviewer tracks each
action to a resolution — **complete**, or **cancelled** with a justification. This is a
_different activity_ from capturing actions, so "Issues" and "Remediation" become **two
Sections**, and a Remediation Action grows from a plain string into a stateful record.

## Decision

### Two Sections

- **`issues`** — _capture_. Failed Answers + their Issue Capture Groups/Fields
  ([ADR-0020]) + the Responsible Party selector (below). Reviewer-editable **until the
  Case is reportable** ([ADR-0023]). This is today's `remediation` Section, **renamed to
  `issues`** to match its UI label; CONTEXT.md's "Issues = the Remediation Section" claim
  is retired.
- **`remediation`** — _tracking_ (the new tab). Lists every **sent** Remediation Action
  across the Case; the Reviewer sets each action's resolution. Meaningful only once
  actions have been sent.

### Remediation Action becomes an object (D9)

A Remediation Action is elevated from `string` to:

```js
/** @typedef {{
 * id: string,
 * text: string,
 * status: 'pending' | 'complete' | 'cancelled',
 * cancelReason?: string // required iff status === 'cancelled'
 * }} RemediationAction */
```

Actions remain stored where [ADR-0020] puts them — the `actions`-typed Issue Capture
Field value on the failed Answer (`Answer.capture[fieldKey]`), now an array of
`RemediationAction` objects instead of strings. No second source of truth; the
Remediation tab reads and writes the same Answer records the Issues tab authored.

### Due date is a single case-level field (D9)

There is **one** `remediationDueDate` on the Case row (not per action), stamped when the
Reviewer clicks **Send Actions** = `reportableAt` + **10 working days** ([ADR-0025] for
the working-day calculation). All sent actions share it.

### Completion gate

- **`status: 'cancelled'` requires a non-empty `cancelReason`** — a hard field
  validation.
- **The Remediation tab is "complete"** when every sent action is `complete` or
  `cancelled(+reason)`. This gates the final **"Complete Case"** button, **but only on
  the actions path** ([ADR-0023]); on the no-actions path there is no Remediation tab
  content and the gate is inert.

### Access & visibility ([ADR-0011])

- **Assigned Reviewer**: `edit` while `status === 'Actions In Progress'`; `read-only`
  once `Completed`; the tab is `hidden` when the Case has no actions at all.
- **Responsible Party (Adviser)**: `hidden`. The RP does the remediation work
  off-system and communicates via the **Conversation**; the Reviewer records the
  outcome (D10). The RP never edits the Remediation tab.
- Other reviewers / Case Type Owner / Journey Owner / Controls: `read-only`.
- **Summary inclusion**: `showInSummary: true` — the Summary's failed-Answer block shows
  each action's `status` (+ `cancelReason`) and the case `remediationDueDate`.

### Lifecycle

Action `status`/`cancelReason` follow the failed-Answer lifecycle ([ADR-0020]/[ADR-0013]):
**stripped** if the Answer stops being a failure (before reportable), **frozen** once the
Case is reportable — except that the resolution fields (`status`, `cancelReason`) are the
_only_ part written **after** reportable, during `Actions In Progress`. They freeze at
final `Completed`.

## Considered options

- **Keep one `remediation` Section, mode-switch by status** — rejected: capture and
  tracking have different fields, different editors, and different access rows; one
  Section with two personalities is harder to reason about than two Sections.
- **Per-action due dates** — rejected (D9): the business tracks a single case-level SLA
  from the send date; per-action dates add storage and UI for no stated need.
- **A parallel `remediationStatus` map keyed by action id on the Answer** — rejected:
  splits an action's identity from its state across two structures; putting `status`
  on the action object keeps one record per action.
- **Let the Responsible Party mark their own actions done** — rejected (D10): the
  Reviewer owns the record of truth; the RP's channel is the Conversation.

## Review tab is questions only; actions live on Issues

The **Review** tab previously rendered an "Actions required" panel directly beneath any
failed **Answer** through its legacy Question renderer, duplicating the configured
**Remediation Action**s that the **Issues** Section already lists per failed Answer.
This muddied the boundary this ADR draws between _answering_ and _capturing_.

**Decision.** The Review tab is **literally just answering questions** — question text
plus response controls, nothing about remediation beneath any Answer. The configured
Remediation Actions for a failed Answer are surfaced **only** on the **Issues** Section
which is their natural home under the issues/remediation
split above.

- **No answer-time failure affordance stays on Review** — not even a subtle "this fails"
  marker. Removing all feedback at answer-time is the deliberate, literal choice
  (open question 1 of #247); failure is surfaced when the Reviewer moves to Issues.
- **Materialization is unchanged.** _When_ configured actions attach to an Answer
  (`materializeRemediationActions`, wired through the Answer write path) is
  untouched; #247 changes only _where_ actions render. This amend is a render-only
  removal on the Review tab.

The legacy panel helper and its call site were removed; the `.cora-remediation-panel`
style is retained solely for the styleguide demo.

> **Update (#555):** the Answer write path named above was
> `CaseReviewViewModel.handleAnswer` when this was recorded. ADR-0034's
> store-driven conversion moved it to `answerEdited` in
> `pages/cora-case-review/answer-actions.js`, which is where
> `materializeRemediationActions` is wired today, and the class itself was later
> renamed to `CaseLoader` (`src/lib/case-loader.js`) and no longer handles
> Answers. _When_ configured actions attach is still unchanged.

## Amendment (2026-07, #497) — the per-action resolution store is read-only; there is one remediation store

ADR-0037 moved the _unit_ of tracking to the Question and its store to
`answer.remediationStatus`. It left the per-action `status` / `cancelReason`
machinery in `evaluators/remediation-actions.js` standing, noting that
`summary-model.js` still read it. What it did not say — and what #497 asks — is
**which store is the real one**.

**Decision. `answer.remediationActions` + `answer.freeFormRemediation` +
`answer.remediationStatus` is the Remediation model. The `actions`-typed Issue
Capture Field store this ADR introduced (D9) is retired to a read-only
compatibility shim.**

Concretely, the write and gate halves of the per-action record are **deleted**:
`setActionStatus`, `validateRemediationAction` (the `cancelled` ⇒ `cancelReason`
throw), `isActionResolved`, `sentActionsForAnswer`, `allSentActions` and
`remediationTrackingComplete`. None had a caller in `src/` after ADR-0037 — the
tab and the access matrix stopped reading them, and the completion gate became
`readyToClose` in `completion-actions.js`. Keeping a _second_ gate that is
vacuously true on every real Case (no Case Type declares an `actions` field, so
`allSentActions` always returned `[]`) beside the live one is worse than having
no second gate: it reads like a safety net and catches nothing.

What was left standing at first was **reading persisted data**, and only that:
`coerceRemediationAction` / `coerceRemediationActions` — including this ADR's
`string` → `{ id, text, status: 'pending' }` migration read — and
`actionFieldKeys`, because `summary-model.js` still rendered capture-field
actions in the Summary's remediation block.

**The Summary now reads the one model too, and the shim is gone.** Its
remediation block used to read the capture store, so on a real Case it showed
"No remediation actions sent." beside a fully populated Remediation tab — one
Case contradicting itself across two tabs, the blind spot ADR-0037 recorded as
#497's remaining half. The block now renders `remediationRows`: one entry per
Question carrying remediation, its Remediation Actions and free-form text, and
its resolution in the Remediation tab's own wording.

It deliberately omits the resolution's **details / justification**. The Summary
has a single rendering for every audience, including the Responsible Party who
reads it once the Case is reportable, and that text is a Reviewer field the
Remediation tab withholds from that side (ADR-0037).

With that call site repointed, `evaluators/remediation-actions.js` had no
reader anywhere in `src/`: no Case Type declares an `actions` field, nothing
writes one, and nothing renders one. The whole module — the coercion shim
included — is **deleted**. The `RemediationAction` typedef stays in
`sharepoint-client.js`, because a persisted blob may still carry such an array
under `capture` and the shape describes what could be read back; what is gone is
the pretence that something reads it.

**One more store nothing wrote: `remediationActions[].completed`.** The
selected-action record carried a `completed` boolean, written `false` on select
and never set `true` anywhere in `src/`. The Responsible Party dashboard counted
`!action.completed` as "outstanding", so that count could never go down however
much remediation the Reviewer resolved — the same family of defect as the
capture store, on a different surface. The dashboard now derives outstanding
work from the model above: an Answer that carries remediation and whose
`remediationStatus` is not yet _resolved_, on a Case **`Actions In Progress`**.
`completed` is **deleted** from the Answer shape, with no coercion: unlike the
`actions` capture field, nothing renders it, so a persisted blob still carrying
the property simply round-trips unread.

**Why that status and not "reportable".** This dashboard lists Cases across
every Case Type and holds no catalogue for any of them, so it reads the Answers
blob — a strict _superset_ of the Remediation tab's rows (ADR-0037's Amendment
2). Scoped to reportable, that superset resurrected the very defect this
paragraph claims to have closed: an Answer stranded on a Question that had left
the catalogue appeared as outstanding work on a **`Completed`** Case forever,
because its `remediationStatus` had never been written and never could be — the
only writer is a row the tab does not render. Scoped to `Actions In Progress` the
superset is harmless, and by construction rather than by luck: a Case only
_enters_ that status with ≥1 real row, and it cannot _leave_ it until every row
is resolved. A `Completed` Case has no outstanding remediation, definitionally.

The completion gate's safety property is now covered end to end: an
`Actions In Progress` Case whose Answer carries Remediation Actions and no
`remediationStatus` cannot reach `Completed`, proven at the flow-runner seam
against a Case Type that declares no `actions` field.

## Consequences

**Positive**

- #144 is resolved with a concrete, testable definition.
- One record per action carries both its text and its resolution; Issues and Remediation
  tabs and the Summary all read the same data.

**Negative**

- **Storage migration**: existing `string[]` actions must be read as `RemediationAction`
  objects. The [ADR-0020] `actions` field shape changes; a compatibility read (coerce
  `string` → `{ id, text, status: 'pending' }`) is needed for any pre-existing data.
- Splitting `remediation` → `issues` + `remediation` touches the Section enum, the
  access matrix, `showInSummary`, `SECTIONS`, and every reference to the old key.

[ADR-0007]: ./0007-case-storage-shape.md
[ADR-0011]: ./0011-section-level-role-based-access.md
[ADR-0013]: ./0013-attributed-party-identity-in-answer-json.md
[ADR-0016]: ./0016-summary-section-replaces-outcome-tab.md
[ADR-0020]: ./0020-unified-issue-capture-engine.md
[ADR-0023]: ./0023-case-lifecycle-and-reportable-milestone.md
[ADR-0025]: ./0025-working-day-sla-due-dates.md
