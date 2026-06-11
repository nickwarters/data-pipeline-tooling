# 18. Answer Override: post-completion correction as an additive layer, never a mutation

Date: 2026-06-11

## Status

Accepted

## Context

A Completed Case's Outcome sometimes needs to change after the fact — a **QA
Reviewer** finds the original **Assigned Reviewer** answered a question wrong
("check the checker"), or an **Appeal** by the **Responsible Party** is upheld.
The strong domain consensus is that *the original result must remain*: we record
**why** it changed, not silently rewrite history.

This collides with several existing decisions. Per [ADR-0006], Outcome is *code,
not data* — derived by `computeOutcome` over the Case's Answers. Per [ADR-0012],
`outcomeAtCompletion` is a *frozen snapshot* and the Answers themselves are frozen
at completion. Per [ADR-0007], a Case stores `answers` as one JSON blob on the row
with field-level PATCH. Per [ADR-0013], a *failed* Answer's **Attributed Party**
(and per [ADR-0017] its required **Remediation Details**) participate in the
completion gate and are stripped when the Answer is no longer a failure.

We needed a correction mechanism that honours all of these: it must not mutate the
frozen record, must keep Outcome derived rather than hand-edited, and must handle
the awkward cases where a correction changes a failure into a pass (or vice versa)
and therefore changes which **Remediation Actions** apply.

## Decision

Corrections are modelled as **Answer Overrides**: a post-completion, per-Answer
layer that *displaces* the original without mutating it.

- **Additive storage.** Overrides live in a new `overrides[]` JSON-blob field on
  the **original Case row**, written by field-level PATCH ([ADR-0008] SaveQueue,
  ETag-guarded). The frozen fields (`answers`, `outcomeAtCompletion`,
  `completedAt`, `hadRemediation`) are never touched — "immutable" means *those
  fields*; adding a new field is additive. "Read-only original" ([ADR-0006],
  CONTEXT QA Check) is narrowed to "the original *Answers* are read-only."

- **Answer-level only; Outcome stays derived.** There is no verdict-level
  override. An Override replaces a specific Answer's value and, where it changes
  the Answer's failure status, supplies a **complete replacement set** of
  Remediation Actions / Attributed Party / Remediation Details (**replace, never
  merge**). The **Current Outcome** is re-derived by running `computeOutcome` over
  the **Effective Answers** (original with overrides applied). This keeps
  [ADR-0006] intact and avoids reintroducing "Outcome as a stored, editable
  entity" (a CONTEXT.md flagged-and-rejected modelling).

- **The three transitions.** fail→pass: the original's actions/attribution stay in
  the frozen record but vanish from the effective view. fail→still-fail-different:
  the action set is swapped. pass→fail: a new action set is added, and the Override
  must satisfy the same completion gate the Case did ([ADR-0017] required details,
  [ADR-0013] attribution when `attributeFailures`) for the Answers it touches.

- **Provenance and authority.** Each Override carries `{ source: 'qa' | 'appeal',
  sourceCaseId? / sourceAppealId?, author, at, answerKey, value,
  remediationActions?, attributedParty?, remediationDetails?, reasoning }`.
  Reasoning is mandatory. Authoring is restricted to the **QA Reviewers** group
  (UX-gated per [ADR-0010]; the real boundary is list ACLs). Overrides work **with
  or without** a QA Check — an Appeal-sourced or direct QA override needs no
  `qa-{slug}` Case. `sourceCaseId` present ⇒ authored during a formal QA Check;
  absent ⇒ ad-hoc QA correction. Both stay `source: 'qa'` (no third source).

- **One record, one authority, two surfaces.** The Override is a single record in
  `overrides[]` on the original row, governed by the original's `override` Mode
  cell ([ADR-0011], a function-valued cell returning `override` for `qaReviewer`
  when `status === 'Completed'`). The *authoring editor* is one reusable element
  mounted in two hosts: the **original Case page**, and — as a convenience — a
  **QA Check** (`qa-{slug}`) that targets it, so a QA Reviewer need not navigate
  away mid-QA. Storage location and authority do **not** move with the surface:
  the QA Check embeds the editor but the write still targets the original row.
  Two consequences follow: (1) from the QA Check the write is **cross-row** —
  it carries the *original's* ETag and reload-retries on conflict ([ADR-0008]),
  even though the QA Check row is the page's primary; (2) the QA Check page
  resolves the `override` capability against the **linked original** row, not its
  own. Authoring on the original page remains fully independent, so Appeal-sourced
  and no-QA overrides are unaffected.

## Considered options

- **Mutate the Answer / re-stamp `outcomeAtCompletion`** — rejected: destroys the
  original result (the reviewer-error signal QA exists to measure) and breaks
  [ADR-0012]'s freeze.
- **Verdict-level override** (hand-edit pass/fail with a reason) — rejected:
  reintroduces stored-Outcome-as-truth ([ADR-0006]) and lets a pass be asserted
  while a failed Answer still carries actions. Answer-level keeps actions and
  outcome consistent by construction.
- **Merge override actions onto the original set** — rejected: produces ambiguous
  half-overridden lists. Replace is unambiguous; the original set is preserved in
  the frozen record for audit.
- **Store overrides on the QA Check Case or a separate list** — rejected: an
  Appeal-sourced override has no QA Check, and every reader of the original would
  have to fan out to find related records. Additive blob on the original row keeps
  "the whole current state of this Case" on one row ([ADR-0007]).

## Consequences

**Positive**

- Original result is preserved verbatim; corrections are auditable (who, when,
  why, from QA or Appeal).
- Outcome remains derived ([ADR-0006]); no new "edit the verdict" surface.
- One row still answers "what is true about this Case now," including corrections.

**Negative**

- A second outcome now exists at runtime (frozen original vs **Current Outcome**);
  every Summary/QA view must show original-vs-override per Answer to avoid
  confusion. Reporting consequences are handled in [ADR-0019].
- The `overrides[]` stored format is hard to change after data exists (a migration
  across every Case Type list), same lock-in noted in [ADR-0013].
- QA Check is no longer a pure read-only observer of the original — it can append
  overrides. CONTEXT.md QA Check updated accordingly.

[ADR-0006]: ./0006-applicability-graph-and-outcome-function.md
[ADR-0007]: ./0007-case-storage-shape.md
[ADR-0008]: ./0008-autosave-and-concurrency.md
[ADR-0010]: ./0010-auth-and-permissions.md
[ADR-0011]: ./0011-section-level-role-based-access.md
[ADR-0012]: ./0012-outcome-snapshot-at-completion-for-reporting.md
[ADR-0013]: ./0013-attributed-party-identity-in-answer-json.md
[ADR-0017]: ./0017-configurable-remediation-details.md
[ADR-0019]: ./0019-effective-outcome-column-for-corrected-reporting.md
