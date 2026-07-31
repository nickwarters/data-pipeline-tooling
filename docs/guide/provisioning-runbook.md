# Maintainer provisioning runbook

What a Maintainer must provision in SharePoint to stand up a Case Type, and the
recurring maintenance the framework depends on.

Provisioning a new Case Type is **config + wiring only**: one module, one
Question Bank, and the lists and groups below. No framework change per type.
~8 Case Types are live for September (Example Review, Complaints, and ~6 more
structurally like Complaints).

---

## 1. Per-Case-Type Cases list — `Cases-{CaseTypeSlug}`

One SharePoint list per Case Type holds its Cases, one Case per row.
The list name is the Case Type's required `listName`; there is no default Case
list. Before enabling the Case Type, grant read access on this list to the
configured Controls, Reviewer-Manager, Adviser, Responsible-Party-Manager and
Maintainer groups. The app fans broad-role reads across every Case Type list and
treats a 403 as a provisioning fault rather than silently showing partial data.
The column **internal names** below are
authoritative: they are exactly what `HttpSharePointClient`
(`src/services/http-sharepoint-client.js`, `rowFromItem` / `itemFromRow`) reads
and writes. Display names are free to differ.

For UAT, provision the matching `uat_`-prefixed list and include it in the ACL
persona matrix described in the [testing guide](testing.md#selective-security-assurance).
The pre-release smoke gate must demonstrate that the list exists for an allowed
reader, is hidden from an unrelated persona, and denies write permissions to a
read-only persona.

### Columns

| Internal name             | SharePoint type                | Purpose                                                                                                                                                                                                   |
| ------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Title`                   | Single line of text            | Case title.                                                                                                                                                                                               |
| `CaseType`                | Single line of text            | Case Type slug (`example-review`).                                                                                                                                                                        |
| `Status`                  | Choice                         | Lifecycle state — **`In-progress`, `Actions In Progress`, `Completed`**. The middle value is new; existing lists must have the choice added.                                                              |
| `AssignedReviewerId`      | Person or Group                | Current Reviewer. Reassignment history comes from list version history.                                                                                                                                   |
| `ResponsiblePartyId`      | Person or Group                | Responsible Party — **written in-app by the Reviewer before Send Actions**.                                                                                                                               |
| `AssignedReviewerManager` | Single line of text            | Reviewer's manager (bare account), for the Reviewer-Manager report.                                                                                                                                       |
| `ResponsiblePartyManager` | Single line of text            | Responsible Party's manager (bare account).                                                                                                                                                               |
| `Answers`                 | Multiple lines of text (plain) | JSON blob of `{ Qid: Answer }`. A **Remediation Action** inside it is `{ id, text, status, cancelReason? }`; legacy bare strings are coerced on read.                                                     |
| `Conversation`            | Multiple lines of text (plain) | JSON array of `{ author, timestamp, body }`.                                                                                                                                                              |
| `Details`                 | Multiple lines of text (plain) | JSON blob of read-only Case Details fields.                                                                                                                                                               |
| `Notes`                   | Multiple lines of text (plain) | Free-form reviewer notes.                                                                                                                                                                                 |
| `CaseJustification`       | Multiple lines of text (plain) | Case-level justification.                                                                                                                                                                                 |
| `ReportableAt`            | Date and Time                  | **New.** Stamped at the reportable milestone (Send Actions, or Complete on the no-actions path) — the freeze/snapshot moment. On the actions path it precedes `CompletedAt`.                              |
| `RemediationDueDate`      | Date and Time                  | **New.** Case-level remediation SLA, computed **once** at Send Actions (+10 working days) and never recomputed on read.                                                                                   |
| `CompletedAt`             | Date and Time                  | Stamped only at the final `Completed` transition.                                                                                                                                                         |
| `Outcome`                 | Single line of text            | Working/current outcome value.                                                                                                                                                                            |
| `OutcomeAtCompletion`     | Single line of text            | Frozen Outcome snapshot for reporting.                                                                                                                                                                    |
| `QuestionBankVersion`     | Single line of text            | Content hash of the as-reviewed Question Bank export.                                                                                                                                                     |
| `HadRemediation`          | Yes/No                         | Whether the frozen Case carried remediation.                                                                                                                                                              |
| `EffectiveOutcome`        | Single line of text            | Corrected result for the Responsible-Party-team report. **Index this column** — reports `$filter` on it. Re-fed from `AmendedOutcome`.                                                                    |
| `EffectiveHadRemediation` | Yes/No                         | Corrected remediation flag.                                                                                                                                                                               |
| `OutcomeOverridden`       | Yes/No                         | Whether the effective result differs from the frozen one. **Index this column.**                                                                                                                          |
| `AmendedOutcome`          | Multiple lines of text (plain) | **New.** JSON `{ outcome, justification, amendedBy, amendedAt, fromAppealId? }` or empty. Controls' post-completion verdict; feeds the `Effective*` columns. Replaces the **removed** `overrides[]` blob. |
| `Appeals`                 | Multiple lines of text (plain) | JSON array of Appeals.                                                                                                                                                                                    |
| `DueDate`                 | Date and Time                  | Review due date (drives `Overdue`).                                                                                                                                                                       |
| `RelatedDate`             | Date and Time                  | Case-relevant date (e.g. interaction date).                                                                                                                                                               |
| `OnHold`                  | Yes/No (indexed)               | Reviewer-controlled hold state and allocation-capacity predicate, available only while the Case is `In-progress`.                                                                                         |
| `PlacedOnHoldAt`          | Date and Time                  | Timestamp set when `OnHold` is applied; cleared automatically when the Case leaves `In-progress`.                                                                                                         |

`Created` is the SharePoint system column. **Removed:** the `Overrides` /
`overrides[]` blob — do not provision it; corrected reporting now flows from
`AmendedOutcome` into the `Effective*` columns.

Before enabling a Case Type's `maxInProgressCases` limit on an existing list,
backfill every unset `OnHold` value to **No**. SharePoint's allocation filter is
`OnHold eq 0`; legacy null values do not match it and would otherwise be omitted
from the Reviewer's active-Case count. Ensure `OnHold` is indexed before enabling
the limit.

---

## 2. Roadmap list

Provision one site-wide `Roadmap` list for the read-only Roadmap page. UAT
requires a matching `uat_Roadmap` list; application code applies the environment
prefix centrally (ADR-0033).

| Internal name | SharePoint type            | Notes                                                     |
| ------------- | -------------------------- | --------------------------------------------------------- |
| `Title`       | Single line of text        | Card title.                                               |
| `Description` | Multiple lines, plain text | Card description. Rich text is not rendered by the app.   |
| `Theme`       | Single line of text        | Short grouping phrase, usually a couple of words.         |
| `Labels`      | Multiple lines, plain text | Free-form values, one per line, such as `Q12027` or `P1`. |
| `Status`      | Choice                     | Exactly `LIVE`, `IN PROGRESS`, or `UPCOMING`.             |

Grant read access to the same users who can open CORA. Items are maintained
directly in SharePoint; this application slice does not create or edit them.
Cards are displayed in SharePoint creation order (`Id` ascending); this slice
does not provide manual ordering.

## 3. Question Bank artifacts

Do **not** provision a `QuestionDefinitions` list. Each Case Type owns a
`case-types/banks/{slug}.txt` file containing JSON text. `deploy_to_sharepoint.py`
uploads every file under `case-types/banks/` to the SharePoint Style Library
alongside the Case Type module (a scoped exception to its normal suffix
allowlist, since `.txt` elsewhere in the tree is still excluded), and
`case-types/load-bank.js` loads it as part of the config. Keep the `.txt`
extension: SharePoint SE can block or mis-serve `.json` files.

Everything under `case-types/banks/` is production-deployable runtime content.
Keep synthetic benchmark banks under `tests/fixtures/` (or another directory
outside the deploy roots) so they cannot ship to production or UAT.

The Question Bank editor compiles the same artifact. Publish immutable versioned
exports as described by ADR-0021 so reportable Cases can resolve their
as-reviewed question catalogue.

---

## 4. Groups per Case Type

SharePoint groups fall on two orthogonal axes. For a Case Type whose
display name is `X` (e.g. `Example Review`, **not** the slug), provision:

### Per-type list-access group (the real ACL boundary)

| Group           | Grants                                                                             |
| --------------- | ---------------------------------------------------------------------------------- |
| `Reviewers - X` | Access to the `Cases-{Slug}` list. Membership implies the `isReviewer` capability. |

### Per-type elevated capability groups

| Group               | Capability                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `CaseTypeOwner - X` | Elevated **reviewing** role — edits this type's Question Bank.                                                                  |
| `JourneyOwner - X`  | Elevated **frontline** role — sees every Case's Summary and raises Appeals where the type configures it. Not a Case Type Owner. |

Group **display names** use the Case Type display name; code composes them from
`slug → displayName` (declared on the Case Type module), so a new type needs one
name, not three hand-written strings.

### Site-wide functional groups (provision once, not per type)

`Reviewers` (base reviewing), `Advisers` (base frontline — eligible Responsible
Party), `Controls` (resolves Appeals, authors Amended Outcomes — replaces the
retired QA Reviewer).

---

## 5. Recurring maintenance — the working-day holiday list

The remediation SLA is **10 working days** after Send Actions, which excludes
weekends **and** public holidays. The holiday source is an **in-code array**,
`ENGLAND_WALES_HOLIDAYS` in
[`src/config/working-days.js`](../../src/config/working-days.js) — England &
Wales public holidays as ISO `YYYY-MM-DD` dates.

**This list is a maintenance burden the Maintainer owns.** Refresh it **annually**
(or whenever holidays change): a stale list silently produces **early** due
dates. Because `RemediationDueDate` is computed once at Send Actions and never
recomputed, refreshing the list only affects Cases sent afterwards — it never
retroactively moves an already-set due date.

Switching the source to a maintainable SharePoint list later is a boot-time
wiring change, not a logic change (`addWorkingDays` takes `holidays` as a
parameter).

> **Notifications are out of scope for this frontend.** Send-Actions / SLA
> reminders are handled by a separate Python pipeline in existing infra that
> reads `ReportableAt` / `RemediationDueDate`. This runbook only ensures those
> columns are provisioned and stamped.
