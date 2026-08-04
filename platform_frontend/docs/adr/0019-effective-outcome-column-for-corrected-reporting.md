# 19. A second `effectiveOutcome` column so reports can show corrected results without erasing the reviewer's record

Date: 2026-06-11

## Status

Accepted (extends [ADR-0012]; **feed changed by [ADR-0026]**, Jul 2026)

> **Amendment ([ADR-0026]).** The `effectiveOutcome` / `effectiveHadRemediation` /
> `outcomeOverridden` columns are **retained unchanged in shape and purpose**, but their
> source is no longer **Answer Overrides** (retired). They are now re-stamped from the
> case-level **Amended Outcome** record: the write that sets `amendedOutcome` sets
> `effectiveOutcome = amendedOutcome.outcome` and `outcomeOverridden = true`. The
> dual-audience contract (frozen `outcomeAtCompletion` for reviewer-quality, effective
> column for true-result) stands. Initialisation now happens at the **reportable**
> milestone ([ADR-0023]) rather than at `Completed`.
>
> [ADR-0023]: ./0023-case-lifecycle-and-reportable-milestone.md
> [ADR-0026]: ./0026-amend-outcome-case-level-and-qa-retirement.md

## Context

[ADR-0012] stamps a frozen `outcomeAtCompletion` (plus `hadRemediation`) on each
Case row so management reports can `$filter`/aggregate server-side within a bounded
query. Its freeze rationale was about _accidental drift_ — a Question Definition or
the outcome function changing under a finished Case should not retroactively move
reported numbers.

[ADR-0018] introduces **Answer Overrides**: deliberate, authored post-completion
corrections that change the **Current Outcome**. This is the opposite of drift, and
it splits reporting intent in two:

- **Reviewer-quality** reporting needs the _original_ result. A wrongly-passed Case
  is precisely the reviewer error QA exists to surface; "fixing" it retroactively
  erases the evidence.
- **Responsible-Party / true-result** reporting needs the _corrected_ result — the
  agent's actual performance after the override, not the reviewer's mistaken read.

One column cannot serve both honestly.

## Decision

Keep `outcomeAtCompletion` exactly as [ADR-0012] defines it (the reviewer's frozen
record). **Add a second indexed column `effectiveOutcome`** (plus
`effectiveHadRemediation` and an `outcomeOverridden` boolean) to every Case Type
list:

- Initialised equal to `outcomeAtCompletion` / `hadRemediation` at completion, with
  `outcomeOverridden = false`.
- **Re-stamped whenever overrides change**: the same write that appends to
  `overrides[]` ([ADR-0018]) re-derives `computeOutcome` over the Effective Answers
  and PATCHes `effectiveOutcome` / `effectiveHadRemediation` / `outcomeOverridden`
  (ETag-guarded, [ADR-0008]).
- Indexed, so reports stay server-side and bounded ([ADR-0012] model preserved). No
  full-row fetch, no client-side re-derivation.

Each report chooses its column by intent: the reviewer-team report reads
`outcomeAtCompletion`; the responsible-party-team report reads `effectiveOutcome`;
`outcomeOverridden` lets either flag/segment corrected Cases.

## Considered options

- **One column, overrides don't touch reporting** — rejected: the RP-team report
  would misstate agents' true results.
- **One column, overrides re-stamp `outcomeAtCompletion`** — rejected: destroys the
  reviewer-error signal and breaks [ADR-0012]'s freeze.

## Consequences

**Positive**

- Both audiences are served honestly from one row; [ADR-0012] stands unmodified.
- Reporting stays bounded — `effectiveOutcome` is just another indexed column.

**Negative**

- Every Case Type list now needs three more provisioned columns; Maintainers must
  add them (on top of [ADR-0012]'s two).
- The override write path is now transactional across `overrides[]` and the
  effective-outcome columns; a partial write would desync them. Both are
  field-level PATCHes on the same row under one ETag exchange ([ADR-0008]).

[ADR-0008]: ./0008-autosave-and-concurrency.md
[ADR-0012]: ./0012-outcome-snapshot-at-completion-for-reporting.md
[ADR-0018]: ./0018-answer-override-post-completion-correction.md
