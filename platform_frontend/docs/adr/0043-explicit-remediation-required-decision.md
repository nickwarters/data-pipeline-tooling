# 43. Remediation Required is an explicit per-Answer decision

Date: 2026-07-30

## Status

Accepted — extends
[ADR-0037](./0037-question-level-remediation-resolution.md) by adding the
_pre-send_ half of the content gate that ADR-0037 established for the close, and
narrows the illustrative `showWhen` example in
[ADR-0020](./0020-unified-issue-capture-engine.md) (see "Why not an Issue
Capture Field" below).

## Context

Attaching **Remediation Actions** to a failed **Answer** was implicitly
optional. A failed Answer with no actions and no free-form text was
indistinguishable from a failed Answer the **Reviewer** had not looked at:
"I have decided none is needed" and "I have not got to this one" were the same
state, an empty list.

That made the pre-send transition unsafe in a way nothing could detect. A Case
whose failures were all skipped completed straight to `Completed` with
`hadRemediation: false`, exactly as a Case whose failures had all been
considered and cleared. There was no gate to hold, because there was nothing to
read: the absence of remediation _was_ the answer.

The close path had already been through this. ADR-0037 gave every remediation
row a resolution the Reviewer must record, and split the gate in two — the
**permission** half in `CaseMachine`, the **content** half computed from the
live catalogue and Answers. What was missing was the same shape one step
earlier.

## Decision

A failed Answer carries an explicit decision, `remediationRequired`, with three
states: `'yes'`, `'no'`, and **absent** — undecided.

`remediationDecided(catalogue, answers)` in
`src/evaluators/remediation-status.js` is the predicate. Over the _active,
applicable, failed_ Questions — the same three filters the Remediation tab's
rows use, so the gate can never demand a decision on a Question no Reviewer can
see — it requires that every one of them is decided, and that every `'yes'`
carries remediation `answerRemediation` recognises. Whitespace-only free-form
text is not remediation, here as everywhere else.

It folds into `completionControl` and `completionPatch` as the **content** half
of the pre-send gate. The permission half stays in `CaseMachine`, untouched;
this ADR adds no lifecycle capability and moves no Outcome. `remediationRequired`
never reaches outcome, failure or applicability logic — an Answer fails because
of its value, and nothing else.

On the Issues Section the decision renders as a per-Question radio pair reading
"Is remediation required?", and the Remediation Actions and free-form box render
only under `'yes'`. A read-only viewer sees a line only for `'no'`: a `'yes'` is
already evidenced by the actions listed beneath it, and an undecided failure has
nothing to show.

### Why not a boolean

Absence has to stay distinguishable from "no". Once the Answers map is
serialised into the Case row's JSON blob, a `false` that was written and a field
that was never there read identically, and the whole point of the field is that
those two are different: one satisfies the gate and one blocks it. A string
union keeps the three states three.

### Why `'no'` clears the remediation

Setting `'no'` drops `remediationActions` and `freeFormRemediation` from the
Answer. There is **one** definition of "this Case carries remediation" and it
reads the Answer, so an action persisted under a control the Reviewer can no
longer see would be reporting a commitment nobody intends to keep — and would
still fork the Case down the actions path for someone to resolve.

This is the lifecycle rule `materializeRemediationActions` already enforces at
the other end: metadata that exists only because of a state does not outlive the
state. That function now strips `remediationRequired` too, for the reason it
strips `remediationStatus` — a decision left behind would silently satisfy the
gate the moment the Answer failed again.

### Why `'no'` needs no justification

A settled product decision. The Reviewer has already recorded the failure, its
Answer Justification and whatever Issue Capture the Case Type asks for; a second
free-text box for "why nothing is needed" buys evidence nobody reads at the cost
of friction on the most common decision.

### The unsatisfiable Question

A Question Definition may configure no Remediation Actions _and_ set
`disallowFreeFormRemediation`. There, `'yes'` could never be satisfied: the
button would be disabled for ever, with a reason pointing at controls that never
render. The rule is that when a Question offers no way to record remediation at
all, the decision alone satisfies the gate.

### Why not an Issue Capture Field

ADR-0020 uses `remediationRequired === 'Yes'` as its illustrative intra-group
`showWhen`, and CONTEXT.md describes the Remediation Action set as an Issue
Capture Field. This is deliberately not that. Intra-group `showWhen` is
documented but **not built** — there is no `showWhen` handling in
`capture-engine.js` — so declaring the decision as capture config would gate
nothing today. More fundamentally, this is a framework-wide completion gate,
not per-Case-Type configuration: every Case Type must not be able to opt out of
it, and `completionControl` cannot read a key whose name each Case Type
chooses. ADR-0020's example stays valid as an example of what the capture
engine would express; the decision itself is a first-class Answer field.

## Consequences

- The button label still follows `hasTrackableRemediation`, so an undecided
  Case reads **"Complete Case" disabled**, not "Send Actions" disabled. Sourcing
  the label from `remediationRequired` instead would be a second, non-catalogue-
  aware reading of "this Case carries remediation" — the exact split ADR-0037
  closed. The reason under the disabled button says what to do.
- **No migration.** There are no live Cases. Nothing infers a decision from an
  Answer that happens to carry remediation, and absent simply blocks. The only
  data catch-up is the dev fixtures and the test fixtures.
- A Case cannot leave `In-progress` with a failure nobody has considered — which
  is the whole point, and is also a new way for a Case to be stuck. The gate is
  visible from every Section, disabled with its reason, rather than only from
  the Issues tab.
