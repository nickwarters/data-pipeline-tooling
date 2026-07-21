# Summary Section replaces the Outcome tab

## Status

Accepted. The Summary/Outcome information architecture remains current; its
view implementation follows
[ADR-0034](./0034-store-driven-views-supersede-component-owned-state.md), and
Section variation follows
[ADR-0035](./0035-case-type-descriptors-express-variation-behaviour-stays-in-code.md).

The case-review tab row is **Case Details · Review · Issues · Summary · Remediation · Notes · Amend Outcome**. "Review" is the UI label for Questions. "Issues" captures failed-Answer detail. "Remediation" tracks sent actions. The standalone **Outcome** tab is removed; the verdict is one block inside the read-only **Summary** Section.

## What Summary is

A first-class **Section** that is **never `edit`** — only `read-only` or `hidden`. It rolls up onto one page: the **Case Details** fields, pass/fail counts per question category, **Remediation Action** counts, each _failed_ **Answer** with its actions, key dates, and the **Current Outcome**. Responsible Parties do not see Summary while the Case is `In-progress`; they see it read-only once the Case is reportable. Case Types may omit it via the Section config.

## Configuration: per-Section `showInSummary`

The `sections` config is a per-Section config object carrying both membership and a **`showInSummary`** boolean. Summary renders one block per included Section; **Notes** defaults `showInSummary: false` (Case Justification and the general note are deliberately excluded). Config lives in the Case Type module; there is no per-individual-Case configuration.

## Derivation is hybrid

- **In-progress:** every block is computed from the current **Answers** and the current per-Case-Type Question Bank artifact.
- **Reportable:** the Outcome block reads the frozen `outcomeAtCompletion`; counts and the failed-Answer list use the Case's frozen Answers and its `questionBankVersion` export (ADR-0021).

This keeps the Summary faithful to the bank version used for the review without duplicating the whole bank on the Case row. **Key dates** show only the lifecycle timestamps already on the Case row (`Created` = selected, `completedAt` = review completed); further milestones get explicit timestamp fields when genuinely needed — we do **not** mine SharePoint version history.

## Considered alternatives

- **Keep Outcome as its own tab alongside Summary.** Rejected: two places showing the same verdict invites divergence and confusion.
- **Summary as a fixed always-on view (not a Section).** Rejected: loses per-role gating, so the Responsible Party would see failed-question detail mid-review unless special-cased anyway.
- **Snapshot the entire Summary at completion** (counts, failed-Answers, dates, outcome stamped onto the row). Rejected for now: perfectly faithful but a sizeable frozen blob extending the architecture decision/0012 with freezing logic to test; the hybrid approach is faithful enough given Answers are frozen.
- **Always-current derivation** (ignore `outcomeAtCompletion` and `questionBankVersion`). Rejected: a reportable Case's summary could change retroactively when the current bank artifact or outcome function is edited — exactly what the architecture decision exists to prevent.

## Consequences

- The **Complete Case** button stays in persistent chrome; Summary carries no action.
- **Conversation** remains a Section but not a tab — still a floating overlay.
- `cora-outcome` survives as a component rendered _inside_ Summary; the Outcome Section/tab and its dedicated matrix row are removed.
- the architecture decision and the architecture decision are amended (see their "superseded in part" notes).
