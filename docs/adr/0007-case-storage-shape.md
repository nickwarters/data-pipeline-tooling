# Case storage shape: everything on the Case row

> **Amended by the Jul 2026 workflow changes.** The Case row gains fields:
> `status` widens to `'In-progress' | 'Actions In Progress' | 'Completed'` ([ADR-0023]);
> `reportableAt` (freeze/snapshot timestamp) and `remediationDueDate` (case-level SLA,
> [ADR-0023]/[ADR-0024]/[ADR-0025]); `amendedOutcome` (`{ outcome, justification,
> amendedBy, amendedAt } | null`, [ADR-0026]); `responsibleParty` is now Reviewer-set
> in-app before Send Actions ([ADR-0024]). A **Remediation Action** in the `Answers`
> blob is no longer a bare string but `{ id, text, status, cancelReason? }` ([ADR-0024]).
> **Removed:** the `overrides[]` blob ([ADR-0018] retired by [ADR-0026]). `effectiveOutcome`
> / `effectiveHadRemediation` / `outcomeOverridden` ([ADR-0019]) are retained but now fed
> by `amendedOutcome`.
>
> [ADR-0018]: ./0018-answer-override-post-completion-correction.md
> [ADR-0019]: ./0019-effective-outcome-column-for-corrected-reporting.md
> [ADR-0023]: ./0023-case-lifecycle-and-reportable-milestone.md
> [ADR-0024]: ./0024-remediation-tracking-tab.md
> [ADR-0025]: ./0025-working-day-sla-due-dates.md
> [ADR-0026]: ./0026-amend-outcome-case-level-and-qa-retirement.md

A **Case** is one row in a per-Case-Type SharePoint list (`Cases-{CaseTypeSlug}`). The row carries:

- **Typed columns** for case-detail fields (vary per Case Type)
- **`Answers` (Note field, JSON)** — `{ "Q1": {value, justification?, remediationActions?[]}, "Q17": {...} }`
- **`Conversation` (Note field, JSON array)** — `[{author, timestamp, body}, ...]`
- **`Notes` (multi-line text)** — free-form reviewer notes
- **`AssignedReviewer` (User field)** — current Reviewer; reassignment history obtained from SharePoint list version history
- **`ResponsibleParty` (User field)**
- **`Status` (Choice)** — `In-progress | Completed`
- **`CompletedAt` (DateTime)** — set when `Status` transitions to `Completed`

**Question Definitions** remain in a shared SharePoint list (ADR-0004).

### Why one row per Case rather than a separate Answers list

Chosen for **simplicity and atomic loads**: one fetch loads the entire Case. No 500-row-per-case explosion in a shared Answers list. **Remediation Actions** nest naturally inside the Answer object inside the JSON blob.

### Trade-offs deliberately accepted

- **Trend reporting is not a free SharePoint view.** The README's "trends and problem areas" requirement now needs a separate path — either a periodic export job that parses Answer blobs into a reporting store, or in-app aggregation that fetches multiple Cases. Acceptable for now; revisit if reporting becomes heavy.
- **Every Answer save rewrites the whole `Answers` field.** At 500 answers ≈ ~100KB blob, this is fine over the wire (well under SharePoint Note field ~1MB limit) but informs the auto-save debounce strategy.
- **Concurrency must be handled explicitly.** Last-writer-wins on a JSON blob is dangerous if two tabs are open or an admin edits during a review. Mitigation: ETag-based optimistic concurrency on the Case row (see next ADR).

### Field-level PATCH semantics

The framework PATCHes individual fields (`Answers`, `Conversation`, `Notes`, `Status`) — never the whole row. Conversation messages arriving from a polling refresh therefore don't clobber an in-progress Answer save and vice versa.
