# Summary Section replaces the Outcome tab

The case-review tab row becomes **Details · Questions · Notes · Issues · Summary**. The **Remediation** Section is surfaced under the UI label **"Issues"** (an *Issue* is just a failed **Answer** — not a new entity); the standalone **Outcome** tab is removed and its verdict becomes one block inside a new read-only **Summary** Section that rolls up the whole Case. This supersedes the tab row in ADR-0014 and the Section list in ADR-0011.

## What Summary is

A first-class **Section** (gets an ADR-0011 access-matrix row) that is **never `edit`** — only `read-only` or `hidden`. It rolls up onto one page: the **Case Details** fields, pass/fail counts per question category, **Remediation Action** counts, each *failed* **Answer** with its actions, key dates, and the computed **Outcome**. It inherits the function-valued *Outcome × Responsible Party* cell that previously governed the Outcome Section: **hidden from the Responsible Party while In-progress, read-only once Completed**. Case Types may omit it via the Section config.

## Configuration: per-Section `showInSummary`

ADR-0011's plain `sections` *allow-list* grows into a per-Section config object carrying both membership and a **`showInSummary`** boolean. Summary renders one block per included Section; **Notes** defaults `showInSummary: false` (Case Justification and the general note are deliberately excluded). Config lives in the Case Type module (ADR-0004); there is no per-individual-Case configuration.

## Derivation is hybrid

- **In-progress:** every block is computed live from the current **Answers** (consistent with live Question Definition edits).
- **Completed:** the Outcome block reads the frozen `outcomeAtCompletion` (ADR-0012); counts and the failed-Answer list recompute from the Case's *frozen* Answers against current Question Definitions.

This is faithful in the common case — a Completed Case's Answers don't change — and only drifts if a shared Question Definition's `failureCriteria`/`category` is edited later, which is rare. No new storage (unlike a full summary snapshot, considered and rejected below). **Key dates** show only the lifecycle timestamps already on the Case row (`Created` = selected, `completedAt` = review completed); further milestones get explicit timestamp fields when genuinely needed — we do **not** mine SharePoint version history.

## Considered alternatives

- **Keep Outcome as its own tab alongside Summary.** Rejected: two places showing the same verdict invites divergence and confusion.
- **Summary as a fixed always-on view (not a Section).** Rejected: loses per-role gating, so the Responsible Party would see failed-question detail mid-review unless special-cased anyway.
- **Snapshot the entire Summary at completion** (counts, failed-Answers, dates, outcome stamped onto the row). Rejected for now: perfectly faithful but a sizeable frozen blob extending ADR-0007/0012 with freezing logic to test; the hybrid approach is faithful enough given Answers are frozen.
- **Always-live derivation** (ignore `outcomeAtCompletion`). Rejected: a Completed Case's summary could change retroactively when shared Question Definitions or the outcome function are edited — exactly what ADR-0012 exists to prevent.

## Consequences

- The **Complete Case** button stays in persistent chrome (ADR-0014 unchanged); Summary carries no action.
- **Conversation** remains a Section but not a tab — still a floating overlay (ADR-0014).
- `cr-outcome` survives as a component rendered *inside* Summary; the Outcome Section/tab and its dedicated matrix row are removed.
- ADR-0011 and ADR-0014 are amended (see their "superseded in part" notes).
