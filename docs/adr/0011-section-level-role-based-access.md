# Section-level role-based access on the case page

> **Superseded in part by ADR-0016.** The **Outcome** Section is removed; a read-only **Summary** Section replaces it and inherits the function-valued _Outcome × Responsible Party_ cell described below (hidden from the Responsible Party while In-progress). Summary is never `edit` — only `read-only`/`hidden`. The `sections` _allow-list_ mentioned here grows into a per-Section config object (membership + a `showInSummary` flag). The evaluator, role derivation, most-permissive resolution, and the rest of this ADR are unchanged.

> **Amended by the Jul 2026 workflow changes ([ADR-0022]/[ADR-0023]/[ADR-0024]/[ADR-0026]/[ADR-0027]).**
> The evaluator, role derivation, and most-permissive resolution are unchanged; the
> **Section set, Role set, Modes, and matrix cells** change.
>
> **Modes** drop `override` (QA retired, [ADR-0026]) — back to `edit | read-only | hidden`.
>
> **Sections** (the old single `remediation` splits into `issues` capture + `remediation`
> tracking, [ADR-0024]; three appeal/amend Sections added):
> `details · questions (UI "Review") · issues · summary · remediation · notes ·
> conversation (overlay) · appealRequest · appealReview · amendOutcome`.
>
> **Roles** add `journeyOwner` and `controls`; `responsibleParty` = the **Adviser** named
> on the Case; `qaReviewer` is removed. Cross-cutting predicate: **`reportable`** =
> `status ∈ { 'Actions In Progress', 'Completed' }` ([ADR-0023]) — the point past which
> reviewer-edit Sections go `read-only`.
>
> **New/changed matrix** (function-valued cells noted; blank = `hidden`):
>
> | Section \ Role | assignedReviewer | responsibleParty (Adviser) | responsiblePartyManager | caseTypeOwner | journeyOwner | controls |
> | --- | --- | --- | --- | --- | --- | --- |
> | details | read-only | — *(folded into Summary)* | — | read-only | read-only | read-only |
> | questions (Review) | `reportable ? read-only : edit` | — | — | read-only | read-only | read-only |
> | issues | `reportable ? read-only : edit` | — | — | read-only | read-only | read-only |
> | summary | read-only | `reportable ? read-only : hidden` | `Completed ? read-only : hidden` | read-only | read-only | read-only |
> | remediation | `ActionsInProgress ? edit : read-only` *(hidden if no actions)* | — | — | read-only | read-only | read-only |
> | notes | `Completed ? read-only : edit` | — | — | read-only | — | — |
> | conversation | edit *(allowMessagesWhen)* | edit *(allowMessagesWhen)* | — | read-only | read-only | read-only |
> | appealRequest | read-only | — | `config.raisedBy==='responsiblePartyManager' && Completed ? edit : hidden` | read-only | `config.raisedBy==='journeyOwner' && Completed ? edit : read-only` | read-only |
> | appealReview | read-only | — | read-only | read-only | read-only | `Completed && openAppeal ? edit : read-only` |
> | amendOutcome | read-only | — | — | read-only | read-only | `Completed ? edit : hidden` |
>
> Default tab stays **details**; fallback = first visible tab. `showInSummary`:
> details/questions/issues/remediation `true`, notes `false`; conversation/appeal*/amendOutcome
> are not Summary blocks. **Journey Owner's "all cases of type" Summary reach** is a
> cross-case list capability beyond this per-Case matrix ([ADR-0027]).
>
> [ADR-0022]: ./0022-two-axis-role-model.md
> [ADR-0023]: ./0023-case-lifecycle-and-reportable-milestone.md
> [ADR-0024]: ./0024-remediation-tracking-tab.md
> [ADR-0026]: ./0026-amend-outcome-case-level-and-qa-retirement.md
> [ADR-0027]: ./0027-appeal-flow-journeyowner-controls.md

The case page renders five sections — **Questions**, **Conversation**, **Notes**, **Remediation**, **Outcome** — and a user's access to each is resolved by a global evaluator `(section, role, case) → 'edit' | 'read-only' | 'hidden'`. Roles are derived from the user's relationship to _this specific_ Case — **Assigned Reviewer**, **Other Reviewer** (in the Reviewers group but not assigned), **Responsible Party**, **Case Type Owner**, or **None** — not from group membership alone. The default access matrix is a single platform-level constant; Case Type modules opt sections out via an optional `sections` allow-list, but do not override individual cells. Multi-role users get the most-permissive mode across their roles (`edit > read-only > hidden`); a user with no applicable role renders a dedicated access-denied panel rather than an empty section layout.

## Considered alternatives

- **Per-Question-Definition access rules.** Rejected: Question Definitions are shared cross-catalogue (see `CONTEXT.md`), so any access rule on a QD would apply identically in every Case Type that uses it. The actual need is per-section, not per-question.
- **Group-membership roles** (anyone in the Reviewers group counts as "Reviewer" for any Case). Rejected: the **Conversation** is, by definition, the thread between the Assigned Reviewer and the Responsible Party of _that_ Case. Letting unrelated Reviewers post breaks the audit trail and inflates the participant list.
- **Per-Case-Type matrix overrides** (each Case Type module restates or tweaks individual cells). Rejected: role policy is a platform decision that should be uniform across Case Types. Keeping the matrix global prevents drift; Case Types still control which sections exist for them via the `sections` allow-list, which is a different question.
- **Ranked role precedence** (one effective role per case via a fixed ordering — e.g. Assigned Reviewer > RP > Owner > Other Reviewer). Rejected: any ordering is arbitrary, and "most-permissive" fails safe — if a user happens to hold two roles, the more capable one wins rather than being silently dropped.
- **Flat string matrix with components doing their own state-dependent checks** (e.g. `cr-outcome` self-hides when in-progress and viewer is RP). Rejected: it splits policy across the matrix and the components, which is exactly the trap. The matrix supports function-valued cells — `(case) => mode` — so one source of truth remains. Most cells stay constants; only Outcome × Responsible Party currently needs the function form.

## Constraints

Per **ADR-0010**, client-side access checks are **UX-only** — SharePoint list ACLs remain the real security boundary. This ADR defines what UI to render _before_ the server's 403, and does not authorize anything. The framework assumes a misbehaving client cannot use these rules to access data the server would deny.

## Consequences

- New `src/section-access.js` module owns the matrix and the evaluator. Every section component takes a resolved `access` prop and consumes it; no section re-derives policy.
- The Case page (`src/cr-case-review.js`) computes the viewer's role(s) once on mount from the loaded Case row + the user's group membership (already resolved in `src/permissions.js`), then calls the evaluator per section.
- Adding a new section requires a row in the matrix and an opt-in by each Case Type (or accept the default of "all sections enabled"). Adding a new role requires a column.
- The "Complete Case" action is _not_ a section — its enablement is a separate capability check (`canCompleteCase`) gated on Assigned Reviewer + status + applicability completeness. Keeping it out of the matrix keeps the section vocabulary honest.
