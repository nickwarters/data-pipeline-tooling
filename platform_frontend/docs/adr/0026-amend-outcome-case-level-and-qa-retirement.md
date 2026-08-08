# 26. Amend Outcome as a case-level, Controls-authored record; retire QA Check and Answer Override

Date: 2026-07-01

## Status

Accepted (**supersedes [ADR-0018]**; resolves the parked #145; amends [ADR-0011],
[ADR-0016], [ADR-0019], [ADR-0021]; retires the QA Reviewer role from [ADR-0022])

## Context

[ADR-0018] modelled post-completion corrections as **Answer Overrides**: per-Answer,
additive records authored by a **QA Reviewer**, with the **Current Outcome** _re-derived_
by `computeOutcome` over the **Effective Answers** — deliberately never a hand-set
verdict (CONTEXT.md avoid-lists "Outcome Override"). That machinery (QA Check `qa-{slug}`
Case Types, the embedded cross-row override editor, ADR-0019's effective-outcome columns,
ADR-0021's per-Case freeze) is heavy, and pre-go-live the business has **not** settled how
QA should actually work.

Two grill decisions change direction:

- **D6/D8** — shelve QA Check and Answer-level Override entirely; the **QA Reviewer** role
  is retired and **Controls** takes over post-completion outcome changes. QA will be
  _re-designed_ later when its requirements are known.
- **D7** — the correction surface is the **Amend Outcome** tab, and it operates at the
  **Case level**: Controls picks the new Outcome **explicitly** with a justification —
  a _hand-set verdict_, not a re-derivation. This is exactly what #145 asked for and what
  [ADR-0018] deliberately refused; with QA/Override shelved, that refusal no longer binds.

## Decision

### Amended Outcome record

A post-completion outcome change is a **single case-level record** on the Case row:

```js
/** @typedef {{
 * outcome: string, // the new Outcome, chosen explicitly by Controls
 * justification: string, // mandatory rationale
 * amendedBy: string, // login name — captured for audit, not from version history
 * amendedAt: string // ISO timestamp
 * }} AmendedOutcome */
// stored as `amendedOutcome: AmendedOutcome | null` on the Case row
```

- **Explicit, hand-set verdict.** Controls selects the Outcome value directly. This
  overturns [ADR-0006]/[ADR-0018]'s "Outcome is always derived, never hand-edited" — for
  an _amended_ Case only. The frozen `outcomeAtCompletion` is never mutated; the amendment
  is a separate, additive field ([ADR-0007] field-level PATCH, ETag-guarded).
- **Audit is captured on the record, not mined from history.** `amendedBy` + `amendedAt`
  are stored explicitly (D7) — we do **not** rely on SharePoint item version history
  (consistent with [ADR-0016]'s "no version-history mining").
- **Current Outcome** = `amendedOutcome?.outcome ?? outcomeAtCompletion`. Where no
  amendment exists it equals the snapshot; where one exists it takes precedence.

### Reporting bridge

[ADR-0019]'s columns survive, now driven by the amendment instead of overrides:

- `effectiveOutcome` / `effectiveHadRemediation` initialise equal to
  `outcomeAtCompletion` / `hadRemediation` at the reportable milestone ([ADR-0023]).
- The **same ETag-guarded write** that sets `amendedOutcome` re-stamps `effectiveOutcome`
  = `amendedOutcome.outcome`, sets `outcomeOverridden = true`, and updates
  `effectiveHadRemediation`. `outcomeAtCompletion` stays frozen (the reviewer's record);
  `effectiveOutcome` carries the corrected result. The reviewer-team report reads the
  frozen column; the responsible-party-team report reads the effective column — [ADR-0019]'s
  dual-audience contract is preserved with a simpler source.

### Access ([ADR-0011])

- **`amendOutcome` Section** — `edit` for **Controls** on a `Completed` Case; `hidden`
  otherwise (nothing to amend before completion). **Controls is the only role that sees
  this tab** — every other role is `hidden`. Observers do not need it: the result of an
  amendment surfaces as the **Current Outcome** in the read-only Summary. Typically
  reached after an Appeal is agreed ([ADR-0027]), but an amendment does **not** require
  an Appeal.

> _Refined post-acceptance:_ the Section was initially `read-only` for the Assigned
> Reviewer, Case Type Owner and Journey Owner so they could see that an amendment had
> happened; this was narrowed to **Controls-only**. Those roles read the amended
> Current Outcome through the Summary instead of a dedicated tab.

> _Refined post-acceptance:_ the Controls gate widened from `Completed` to the
> **reportable** milestone (`Actions In Progress` or `Completed`) — `hidden` before.
> The "nothing to amend before completion" rationale above is retracted: the Outcome
> snapshot and the Answers behind it freeze at the reportable milestone, not at
> completion, so there _is_ something to amend while remediation is in flight and a
> wrong verdict need not wait for the Case to complete. Controls remains the only
> role that sees the tab, at every status.

> _Refined post-acceptance:_ the amendment record gains an optional `reason` key
> alongside the mandatory justification, chosen from a shared vocabulary of three
> (_QA Check_, _TM Check_, _Appeal_) that a Case Type may **extend** via
> `extraAmendmentReasons`. It is optional because pre-existing amendments and
> appeal-derived ones carry none.

### What is removed

- The **`qaReviewer`** capability and `QA-Reviewers` group ([ADR-0022] already omits it).
- The **`override`** access Mode and its `RANK` entry ([ADR-0011]) — modes are back to
  `edit | read-only | hidden`.
- `overrides[]` storage, the embedded override editor (`cora-override-editor.js`), and the
  QA Check Case Types (`qa-*`, e.g. `qa-example-review.js`).
- CONTEXT.md's **Answer Override**, **Effective Answers**, and **QA Reviewer** entries are
  superseded (see the CONTEXT.md revision); **Current Outcome** is redefined against
  `amendedOutcome`.

QA is **not** being redesigned here — it is removed cleanly so a future QA ADR starts from
a known-good baseline rather than half-built override plumbing.

## Considered options

- **Keep [ADR-0018] Answer Override, just swap QA Reviewer → Controls** — rejected (D7):
  the business wants a case-level verdict decision, not per-Answer edits; and keeping the
  heavy QA/override machinery for a role that is itself being redesigned is waste.
- **Amend at Answer level and re-derive (status quo)** — rejected: contradicts the stated
  requirement and reintroduces the complexity we're shelving.
- **Leave QA machinery dormant rather than remove it** — rejected (D8): dead override
  plumbing complicates the section matrix and storage during a large refactor; a clean
  removal is easier to reason about and reverse from git if QA returns.

## Consequences

**Positive**

- Much simpler correction model: one case-level record, one tab, one role (Controls).
- Reporting keeps working via the existing `effectiveOutcome` column with a simpler feed.
- The codebase sheds a large, unproven subsystem (QA Check, overrides) before go-live.

**Negative**

- **Outcome is now hand-settable at the case level** — a real reversal of a core
  principle. Mitigated by: it is additive (frozen snapshot preserved), mandatory
  justification, explicit `amendedBy`/`amendedAt` audit, and Controls-only access.
- **Deletion of shipped code** (QA Check types, override editor, `overrides[]`): any
  existing override data is abandoned. Acceptable pre-go-live (no production data);
  the removal ADR is the record if it must be revived.
- A future QA design must re-establish its own correction/QA-check model rather than
  extending [ADR-0018].

[ADR-0006]: ./0006-applicability-graph-and-outcome-function.md
[ADR-0007]: ./0007-case-storage-shape.md
[ADR-0011]: ./0011-section-level-role-based-access.md
[ADR-0016]: ./0016-summary-section-replaces-outcome-tab.md
[ADR-0018]: ./0018-answer-override-post-completion-correction.md
[ADR-0019]: ./0019-effective-outcome-column-for-corrected-reporting.md
[ADR-0021]: ./0021-versioned-question-bank-snapshots-for-completed-cases.md
[ADR-0022]: ./0022-two-axis-role-model.md
[ADR-0023]: ./0023-case-lifecycle-and-reportable-milestone.md
[ADR-0027]: ./0027-appeal-flow-journeyowner-controls.md
