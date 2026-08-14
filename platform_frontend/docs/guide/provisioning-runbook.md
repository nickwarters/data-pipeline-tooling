# Maintainer provisioning runbook

What a Maintainer must provision in SharePoint to stand up a Case Type, and the
recurring maintenance the framework depends on.

Provisioning a new Case Type is **config + wiring only**: one module, one
Question Bank, and the lists and groups below. No framework change per type.

This runbook covers the lists, groups and recurring maintenance. The
`Cases-{slug}` **column schema and which columns are indexed** live in one place
only — the [Case Type onboarding checklist](../case-type-onboarding.md) — because
two copies of that table is exactly how one of them goes stale.

---

## 1. Per-Case-Type Cases list — `Cases-{CaseTypeSlug}`

One SharePoint list per Case Type holds its Cases, one Case per row.
The list name is the Case Type's required `listName`; there is no default Case
list. Before enabling the Case Type, grant read access on this list to the
configured Controls, Reviewer-Manager, Adviser, Responsible-Party-Manager and
Maintainer groups. The app fans broad-role reads across every Case Type list and
treats a 403 as a provisioning fault rather than silently showing partial data.

For UAT, provision the matching `uat_`-prefixed list and include it in the ACL
persona matrix described in the [testing guide](testing.md#selective-security-assurance).
The pre-release smoke gate must demonstrate that the list exists for an allowed
reader, is hidden from an unrelated persona, and denies write permissions to a
read-only persona.

### Columns

**The column schema is the [`Cases-{slug}` column
schema](../case-type-onboarding.md#cases-slug-column-schema) in the onboarding
checklist** — every column, its SharePoint type, whether it is indexed, and
which of them the app writes. Those internal names are authoritative: they are
exactly what `HttpSharePointClient` (`src/services/http-sharepoint-client.js`,
`rowFromItem` / `itemFromRow`) reads and writes. Display names are free to
differ.

Three things about that schema are provisioning-critical enough to repeat here:

- **Index at creation, or not at all.** A SharePoint column index cannot be
  added once the list is past the List View Threshold. Every indexed column in
  the schema must be created and indexed **while the list is still empty** —
  see "The one irreversible step" in the
  [onboarding checklist](../case-type-onboarding.md).
- **All four people are Person columns** — `AssignedReviewer`,
  `ResponsibleParty`, `AssignedReviewerManager` and `ResponsiblePartyManager`
  alike. The read expands each and takes the claims login off it, and the write
  path resolves the account to the numeric id the `…Id` twin holds. A manager
  column provisioned as text will fail both. Rows speak bare account names;
  columns are Person.
- **The whole schema must exist before the frontend is deployed.** Reads
  tolerate a missing column — the Case read is `$select=*`, so the list simply
  answers without it — but a **write** naming a column the list lacks gets a
  **400** from SharePoint, which fails the action outright rather than
  degrading. `AssignedAt` is the sharpest case: the client stamps it on every
  write that sets the Assigned Reviewer, and the allocation claim behind
  "Request next Case" is exactly such a write.

`Created` is the SharePoint system column. **Do not provision** the `Overrides`
/ `overrides[]` blob — it is gone; corrected reporting flows from
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
display name is `X` (e.g. `Complaints`, **not** the slug `complaints`), provision:

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

The same list also drives the **review** SLA — `DueDate`, stamped when a
Reviewer claims a Case through allocation — so a stale list produces early dates
for two SLAs, not just `RemediationDueDate`.

**This list is a maintenance burden the Maintainer owns.** Refresh it **annually**
(or whenever holidays change): a stale list silently produces **early** due
dates. Both dates are computed once — `DueDate` at the allocation claim,
`RemediationDueDate` at Send Actions — and neither is ever recomputed. So
refreshing the list only affects Cases claimed or sent afterwards; it never
retroactively moves an already-set due date.

Switching the source to a maintainable SharePoint list later is a boot-time
wiring change, not a logic change (`addWorkingDays` takes `holidays` as a
parameter).

> **Notifications are out of scope for this frontend.** Send-Actions / SLA
> reminders are handled by a separate Python pipeline in existing infra that
> reads `ReportableAt` / `RemediationDueDate`. This runbook only ensures those
> columns are provisioned and stamped.
