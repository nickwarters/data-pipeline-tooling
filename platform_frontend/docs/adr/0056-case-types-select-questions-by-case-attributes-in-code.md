# 56. Case Types select their questions by Case attributes, in code

Date: 2026-10-05

## Status

Accepted. Settled with the owner on
[#630](https://github.com/nickwarters/data-pipeline-tooling/issues/630).

Extends [ADR-0006](./0006-applicability-graph-and-outcome-function.md) without
changing it: `showWhen` stays the answer-driven applicability graph, exactly as
written. Applies the rule of
[ADR-0035](./0035-case-type-descriptors-express-variation-behaviour-stays-in-code.md)
(predicates are code, not descriptors) and the module shape of
[ADR-0004](./0004-case-type-config-as-js-modules.md).

## Context

Which questions a **Reviewer** sees could only depend on **Answers** already
given. `evaluate(catalogue, answers)` walks each Question Definition's
`showWhen` against the Answer map and nothing else. A Case's own attributes —
the `details` blob a Case Type declares as `detailFields` and shows on **Case
Details** — never reached applicability.

The request was for those attributes to choose the questions: a Case with
`product = Mortgage` gets the mortgage checks, any other Case does not. A Case
Type may carry thirty details, and selection typically reads one or two of
them.

The owner asked for the smallest change with the fewest moving parts. Reporting
is deliberately out of scope: N/A and absent Answers already carry most of what
a report needs. Authoring and simulating the rule on `#/question-bank` is a
separate ticket
([#994](https://github.com/nickwarters/data-pipeline-tooling/issues/994)).

## Decision

**A Case Type may declare `selectQuestions(questions, details)` beside
`computeOutcome`.** It is handed the bank's active Question Definitions and the
Case's `details` (an empty object when the Case has none), and returns the ones
to keep for that Case.

- **One call site.** `CaseLoader.load()` applies it once the catalogue is
  resolved (live bank or frozen as-reviewed export) and before anything is
  derived from it. Every evaluator on the Case Review page reads the loader's
  catalogue, so applicability, Question Group progress, the Summary,
  Remediation, Group Outcomes, completion gating and the lifecycle view all
  follow the selection without knowing it exists.
- **Narrowing only.** The loader keeps the bank's questions whose ids the
  function returned, in bank order. A returned question that is not in the bank
  is ignored, and the function cannot reorder or rewrite a question.
- **Deselected means hidden, not N/A.** A question the function drops is
  treated like one whose `showWhen` is false: not shown, not counted, not
  gating completion. Writing N/A on load was considered and rejected (below).
- **Answers to deselected questions are dropped on load.** Each Case Type's
  `computeOutcome` walks its whole bank, so an Answer left over from before an
  attribute changed would still score the Outcome. A selected question whose
  `showWhen` names a deselected one would also stay applicable off an Answer
  nobody can see. The loader drops those Answers in memory. As with `showWhen`
  pruning, the stored Case loses them on the next Answer write. Keys outside the
  bank (General Questions, retired questions) pass through.
- **Re-derived on every load until the Case freezes.** Attributes can change up
  to Reportable, on the SharePoint list item or through the UI. The selection
  re-runs whenever the Case is opened. A frozen (reportable) catalogue is
  narrowed too; otherwise questions the Reviewer never saw would reappear on it
  unanswered. Attributes are expected to stop changing at Reportable.
- **No declared attribute set.** The function reads whatever keys it needs.
  There is no condition syntax, so `showWhen`, `detectCycles` and the bank
  artifact are untouched, and an attribute can never become a node in the
  applicability graph.
- `npm run verify` refuses a `selectQuestions` that is declared but is not a
  function.

## Consequences

- A page already open does not re-select when an attribute changes under it.
  The `SaveQueue` re-reads a Case on a 412 and retries silently when its
  Answers are unchanged, without re-running the loader. The change is picked up
  on the next open. Re-selecting live would be a follow-up if it is ever needed.
- If the next Answer write never comes, for example on a Case completed with no
  further edit after an attribute change, a dropped Answer can stay in the stored
  blob. Only reporting can see it, and reporting is out of scope here.
- The selection is opaque code, so the bank editor and its impact simulator
  cannot see it. Until
  [#994](https://github.com/nickwarters/data-pipeline-tooling/issues/994) lands,
  the simulator replays sample Cases as though every question were selected.
- Nothing is superseded: the change is additive, and no Case Type had a
  workaround to remove.

## Considered alternatives

- **Extend `showWhen` with namespaced attribute keys (`case:product`).** Small
  in the evaluator, but it grows the condition language ADR-0006 asks to keep
  minimal. It would also push the cost into the bank editor, the simulator,
  `detectCycles` and the export schema, where a key now means one of two
  things.
- **Mark deselected questions N/A and disable them.** This needs a write on
  load, including by viewers who cannot edit, and every open would churn the
  ETag. It needs a new disabled card state. When the attribute flips back, a
  system-written N/A has to be told apart from one a Reviewer chose.
- **Split the Case Type per attribute value.** This multiplies lists, groups,
  banks and permissions for what is one review with a varying slice of
  questions.
