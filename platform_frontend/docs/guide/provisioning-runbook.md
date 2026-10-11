# Maintainer provisioning runbook

What a Maintainer must provision in SharePoint to stand up a Case Type, and the
recurring maintenance the framework depends on. The HR Form lists, which are
not Case Types, are in [section 8](#8-hr-form-type-lists).

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

For every non-production environment (`uat`, `training`, …), provision the
matching `<name>_`-prefixed list and include it in the ACL persona matrix
described in the [testing guide](testing.md#selective-security-assurance); the
per-environment pieces are in [provisioning an environment](provisioning-an-environment.md).
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
- **The whole schema must exist before the frontend is deployed.** `AssignedAt`
  is indexed: the client stamps it whenever a write sets the Assigned Reviewer,
  and the Action Centre orders and ages in-progress Cases from it. If the column
  is absent, assignment writes fail with **400**, and the entire Action Centre
  reason/headline read fails because its filter/order names the missing column.
  Before rollout, use authoritative SharePoint assignment/list version history
  to backfill legacy outstanding allocations; this evidence check is a predeploy
  gate. Do not derive it from or fall back to `Created`. Verify that every
  outstanding row with `AssignedReviewer` has `AssignedAt`; unassigned rows carry
  null. This does not require completed or void rows to carry it. Any unbackfilled
  outstanding allocation is silently excluded from both the worklist and its
  headline count.

`Created` is the SharePoint system column. **Do not provision** the `Overrides`
/ `overrides[]` blob — it is gone; corrected reporting flows from
`AmendedOutcome` into the `Effective*` columns.

Before enabling allocation on an existing list, backfill every unset `OnHold`
value to **No**. The app-wide capacity check totals the Reviewer's
`In-progress` Cases across Case Type lists using `OnHold eq 0`; legacy null
values do not match it and would otherwise be omitted. Ensure `OnHold` is
indexed before enabling allocation.

---

## 2. Roadmap list

Provision one site-wide `Roadmap` list for the read-only Roadmap page. Every
non-production environment requires a matching `<name>_Roadmap` list
(`uat_Roadmap`, `training_Roadmap`); application code applies the environment
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

## 3. Case Support Log list — `CaseSupportLog`

Provision one site-wide `CaseSupportLog` list for the **Support Log** behind the
Case Support page, and a matching `<name>_CaseSupportLog` in every non-production
environment (`uat_CaseSupportLog`). One entry is appended per support action; no
entry is ever edited.

| Internal name   | SharePoint type            | Indexed | Notes                                                     |
| --------------- | -------------------------- | ------- | --------------------------------------------------------- |
| `Title`         | Single line of text        |         | The Case Reference the action was taken on.               |
| `CaseType`      | Single line of text        | Yes     | The Case Type slug, e.g. `complaints`.                    |
| `CaseId`        | Single line of text        | Yes     | The Case's item id in its `Cases-{slug}` list.            |
| `SupportAction` | Single line of text        |         | The action's id, e.g. `reassign`.                         |
| `Reason`        | Multiple lines, plain text |         | The Maintainer's reason. Required by the app.             |
| `Changes`       | Multiple lines, plain text |         | JSON list of `{ field, before, after }`.                  |
| `Outcome`       | Single line of text        |         | Exactly `recorded` or `not-applied`.                      |
| `RelatesTo`     | Single line of text        |         | On a `not-applied` entry, the id of the entry it follows. |

`Created` and `Author` are SharePoint's own and are what the page shows as when
and who. Create both indexes **while the list is empty**: every read filters on
`CaseType` and `CaseId`, and an unindexed filter fails once the list passes the
List View Threshold.

Break permission inheritance and grant `CORA Owner Delegates` a custom
permission level with **Add Items** and **View Items** but not **Edit Items** or
**Delete Items**, so an entry once written stays as written. Grant nobody else
access through the app; the data pipeline's service account needs read.

## 4. CORA Access Log list — `CoraAccessLog`

Provision one site-wide `CoraAccessLog` list for the **Access Log** behind the
Access page. Unlike every other list here it has **no** `<name>_` copy in a
non-production environment: the CORA groups it records changes to are shared by
every environment, so there is one log, and the Access page in every environment
writes to it (see ADR-0057). One entry is appended per change; no entry is ever
edited.

| Internal name  | SharePoint type            | Indexed | Notes                                                                                |
| -------------- | -------------------------- | ------- | ------------------------------------------------------------------------------------ |
| `Title`        | Single line of text        | Yes     | The login name of the person whose access changed.                                   |
| `TargetName`   | Single line of text        |         | Their display name when the change was made.                                         |
| `AccessAction` | Single line of text        |         | Exactly `grant` or `revoke`.                                                         |
| `AccessRole`   | Single line of text        |         | The role's id, e.g. `reviewer` or `case-type-owner`.                                 |
| `CaseType`     | Single line of text        |         | The Case Type slug for a per-Case-Type role; empty for a site-wide one.              |
| `Reason`       | Multiple lines, plain text |         | The Maintainer's reason. Required by the app.                                        |
| `Changes`      | Multiple lines, plain text |         | JSON list of `{ field, before, after }`, one per group, naming the SharePoint group. |
| `Outcome`      | Single line of text        |         | Exactly `recorded`, `not-applied` or `partly-applied`.                               |
| `RelatesTo`    | Single line of text        |         | On a `not-applied` or `partly-applied` entry, the id of the entry it follows.        |

`Created` and `Author` are SharePoint's own and are what the page shows as when
and who. Create the `Title` index **while the list is empty**: every read filters
on it, and an unindexed filter fails once the list passes the List View
Threshold.

Break permission inheritance and grant `CORA Owner Delegates` a custom
permission level with **Add Items** and **View Items** but not **Edit Items** or
**Delete Items**, so an entry once written stays as written. Grant nobody else
access through the app; the data pipeline's service account needs read.

## 5. Question Bank artifacts

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

## 6. Groups per Case Type

SharePoint groups fall on two orthogonal axes. For a Case Type whose
display name is `X` (e.g. `Complaints`, **not** the slug `complaints`), provision:

### Per-type list-access groups (the real ACL boundary)

Two, one per side of the review — the reviewing side and the frontline side.
Both are SharePoint ACLs on the `Cases-{Slug}` list.

| Group           | Grants                                                                                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Reviewers - X` | Access to the `Cases-{Slug}` list. Membership implies the `isReviewer` capability.                                                                             |
| `Frontline - X` | Access to the `Cases-{Slug}` list for the **frontline** side — a **Responsible Party** or their **Manager** on a Case of this type. Implies **no** capability. |

**`Frontline - X` grants list access and nothing else.** Unlike `Reviewers - X`
it is not read by `permissions.js` and composes no capability: what a frontline
user may see and do on a Case is decided by the per-Case roles in
`section-access.js`, which resolve from the Case row's people fields, not from
group membership. The group exists so those roles have a list to read the Case
from at all. It is therefore not in `caseTypeGroupNames()` — that function
composes the three groups the app _reads_.

**Membership is maintained by hand today; the data pipeline now asks for it.**
The `notifications` pipeline emits an `add_user_group_priviledges_<stamp>.json`
Deliverable naming each frontline notification recipient's login and the
`Frontline - X` groups they need, into the `cora_user_group_privileges` outbox —
so a Responsible Party can be granted access to the Case in the same pass that
tells them about it. **It is a request, not an application:** the pipeline
writes the file to a local outbox and stops there, and the **Forwarder** that
would deliver it is designed but not yet built, so acting on the file is
currently a manual step. See the data pipeline's
[`docs/data-dictionary-notifications.md`](../../../docs/data-dictionary-notifications.md).
Provisioning creates the empty group per Case Type either way.

### Per-type elevated capability groups

| Group               | Capability                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `CaseTypeOwner - X` | Elevated **reviewing** role — edits this type's Question Bank.                                                                  |
| `JourneyOwner - X`  | Elevated **frontline** role — sees every Case's Summary and raises Appeals where the type configures it. Not a Case Type Owner. |

Group **display names** use the Case Type display name; code composes them from
`slug → displayName` (declared on the Case Type module), so a new type needs one
name, not three hand-written strings.

### Group owner: `CORA Owner Delegates`

Make `CORA Owner Delegates` the **owner** of every CORA group, the per-type and
site-wide groups alike, except `CORA Owner Delegates` itself. A group's owner
can always read and change its membership, so Maintainers can manage access
without being site collection administrators, and Case Support can read the
groups it needs. Its Reassign lists the members of `Reviewers - <type>` to
choose the new Reviewer from. Add Reviewers to the group directly: members
granted through a nested AD group are not listed.

### Site-wide functional groups (provision once, not per type)

`Reviewers` (base reviewing), `Frontline` (base frontline — eligible Responsible
Party; the capability it grants is `isAdviser` and the domain term is still
**Adviser**), `Controls` (resolves Appeals, authors Amended Outcomes — replaces
the retired QA Reviewer).

`Frontline` and the per-type `Frontline - X` above are **different groups on
different axes** — site-wide capability vs one list's ACL. Every group match in
`permissions.js` is exact equality, so neither grants the other; a user who is a
Responsible Party on a Complaints Case needs **both**. `Frontline` is what puts
their Cases on `#/my-cases`; `Frontline - Complaints` is what lets SharePoint
serve the Case itself, including from a notification's deep link.

---

## 7. Recurring maintenance — the working-day holiday list

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

---

## 8. HR Form Type lists

Each Form Type (1-to-1, coaching form, learning plan) keeps its Forms in one
SharePoint list, named by the definition's `listName`: `OneToOne` in production
and `uat_OneToOne` in UAT, with the environment prefix added as for every other
list. The access model behind every setting below is
[ADR-0059](../adr/0059-hr-forms-are-a-gated-area-with-javascript-enforced-access.md).
Do all of it **before the first real Form goes in**: an index cannot be added
once a list is past the List View Threshold, and a permission or search setting
fixed after the fact has already exposed what was written before it.

### Columns

Generate the columns from the definition rather than copying them:

```sh
node scripts/form-type-columns.js one-to-one              # as a checklist
node scripts/form-type-columns.js one-to-one --markdown   # as this table
```

The 1-to-1 list, which `tests/form-type-columns.test.js` checks against the
definition so it cannot drift:

<!-- form-type-columns: one-to-one -->

| Internal name              | SharePoint type                     | Indexed | Encoded | Choices                                                         |
| -------------------------- | ----------------------------------- | ------- | ------- | --------------------------------------------------------------- |
| `Employee`                 | Person or Group                     | Yes     |         |                                                                 |
| `CurrentFirstLineManager`  | Person or Group                     | Yes     |         |                                                                 |
| `CurrentSecondLineManager` | Person or Group                     | Yes     |         |                                                                 |
| `Status`                   | Choice                              | Yes     |         | Pending; Completed; Void; Cancelled                             |
| `DueDate`                  | Date and Time (date only)           | Yes     |         |                                                                 |
| `ClosedDate`               | Date and Time (date only)           | Yes     |         |                                                                 |
| `ClosedBy`                 | Person or Group                     | Yes     |         |                                                                 |
| `VoidReason`               | Choice                              |         |         | Created in error; Duplicate form; Meeting did not happen; Other |
| `FirstLineManager`         | Person or Group                     |         |         |                                                                 |
| `SecondLineManager`        | Person or Group                     |         |         |                                                                 |
| `MeetingDate`              | Date and Time (date only)           |         |         |                                                                 |
| `CompetencyStage`          | Choice                              |         |         | Stage 1; Stage 2; Stage 3                                       |
| `Location`                 | Choice                              |         |         | In person; Zoom                                                 |
| `VoidReasonNote`           | Multiple lines of text (plain text) |         | Yes     |                                                                 |
| `Tags`                     | Multiple lines of text (plain text) |         | Yes     |                                                                 |
| `Agenda`                   | Multiple lines of text (plain text) |         | Yes     |                                                                 |
| `Wellbeing`                | Multiple lines of text (plain text) |         | Yes     |                                                                 |
| `Performance`              | Multiple lines of text (plain text) |         | Yes     |                                                                 |
| `DevelopmentGrowth`        | Multiple lines of text (plain text) |         | Yes     |                                                                 |
| `OtherNotes`               | Multiple lines of text (plain text) |         | Yes     |                                                                 |
| `IndividualComments`       | Multiple lines of text (plain text) |         | Yes     |                                                                 |
| `LineManagerComments`      | Multiple lines of text (plain text) |         | Yes     |                                                                 |
| `Actions`                  | Multiple lines of text (plain text) |         | Yes     |                                                                 |

<!-- /form-type-columns -->

- **People are plain Person or Group columns**, one person each. The app reads
  each with its login and display name and writes the numeric user id, as for
  the Case people columns.
- **Choice columns offer exactly the values listed**, spelt as listed. Turn off
  "Allow 'Fill-in' choices": a value outside the list reads as a Status no rule
  knows.
- **Encoded columns are multi-line _plain_ text.** Rich text rewrites the
  stored value and breaks the decode, and a single line is too short, because
  encoding adds about a third to the length.
- **Index every column marked Indexed while the list is empty.** Every query
  the Forms pages send and the access rule filter on them.
- `Title`, `Created` and `Modified` are SharePoint's own. **Set `Title` to not
  required**: the app never writes it, and a required `Title` refuses every new
  Form with a 400.

### Settings

| Setting                | Value                                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Permissions            | Break inheritance. Site owner group: Full Control. The `EPF Users` and `EPF Controls` groups: one custom level with **View Items**, **Add Items** and **Edit Items** but not **Delete Items**. Nobody else. |
| Item-level permissions | None. Every grant is on the list; no item ever has its own.                                                                                                                                                 |
| Hidden                 | Set the list's `Hidden` property (PowerShell or REST), and leave it out of the site navigation, so it is not in Site Contents. Site owners still reach it by its URL.                                       |
| Search                 | Advanced settings: "Allow items from this list to appear in search results?" **No**.                                                                                                                        |
| Auditing               | List settings, Information management policy settings: enable auditing of **viewing items** and **editing items**.                                                                                          |
| Versioning             | **On**. Version history keeps every earlier encoded value, readable by anyone who can read the item.                                                                                                        |
| Attachments            | Off. A Form stores nothing outside its columns.                                                                                                                                                             |
| Fill-in choices        | Off on every Choice column.                                                                                                                                                                                 |

**Hiding the list is not a permission boundary, and neither is encoding.**
Every member of the Forms access group can read every Form on the list through
REST, because that is how the app reads and writes for them, and the list name
is in the deployed JavaScript. What stands between them and other people's
Forms in the app is the JavaScript access rule. The owner has accepted that
risk; ADR-0059 section 6 states it in full.

### Groups

| Group          | Who is in it                                                                          | What it gives                                                                                          |
| -------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `EPF Users`    | Everyone who takes part in Forms: employees and their first and second line managers. | The Forms area in the app, and read and write on every Form list.                                      |
| `EPF Controls` | The people who oversee Forms. Members need not also be in `EPF Users`.                | Every Form, read-only, in the app, and starting a Form for someone; read and write on every Form list. |

The control group gets write on the list, not Read, because its members start
Forms for others and may be the employee or a current manager on a Form of
their own. The app keeps them read-only on every other Form; that is the same
JavaScript boundary as everything else on these lists, not a weaker one.

The names are declared in `src/services/permissions.js`; a rename changes them
there and here together. One access group serves every Form list until a Form
Type needs a narrower audience.

### Proving it on UAT

Run both checks against the `uat_` list, with a few test Forms created through
the app, before real Forms go in:

1. **List permissions.** On the list's Check Permissions page, check one member
   of each group and one person in neither: the first two have View, Add and
   Edit but not Delete, and the third has nothing. The ACL smoke check cannot
   take this list, because it requires a read-only persona and a Form list has
   none.
2. **What the app offers each persona.** Copy
   `scripts/uat-forms-access.example.json`, change the Form ids to the test
   Forms, and give each persona a headers file as for the ACL smoke. The check
   reads only, as each persona, through the app's own client and access rule,
   and compares what the dashboard lists and which Forms open and are editable
   against the matrix. `npm run test:security:uat:forms -- <config.json>`.
   The personas are an employee, their first and second line managers, a
   manager who is no longer current, an `EPF Controls` member, an `EPF Users` member on
   none of the Forms, and someone in neither group.
3. **Search.** Search the site for a word written in one of the test Forms.
   Nothing should come back. Encoded text is not searchable as words anyway, so
   also search for the test employee's name, which is stored plain.
4. **Auditing.** Read a test Form's item through REST as an `EPF Users` member, then
   look for that read in the site collection's audit log report. Record in the
   issue whether REST item reads are audited on this farm; ADR-0059 leaves it
   open until someone has looked.

Record each result, with the date and environment, on the provisioning issue.
