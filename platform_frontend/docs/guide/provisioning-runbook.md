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
list. Before enabling the Case Type, grant its `Cases - X Read` and
`Cases - X Write` groups (§6) on this list, along with `CORA All Cases Read`,
`CORA All Cases Write` and `CORA Owner Delegates`. The app fans broad-role reads
across every Case Type list and treats a 403 as a provisioning fault rather than
silently showing partial data.

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

| Internal name  | SharePoint type            | Indexed | Notes                                                                            |
| -------------- | -------------------------- | ------- | -------------------------------------------------------------------------------- |
| `Title`        | Single line of text        | Yes     | The login name of the person whose access changed.                               |
| `TargetName`   | Single line of text        |         | Their display name when the change was made.                                     |
| `AccessAction` | Single line of text        |         | Exactly `grant` or `revoke`.                                                     |
| `AccessRole`   | Single line of text        |         | The role's id, e.g. `reviewer` or `case-type-owner`.                             |
| `CaseType`     | Single line of text        |         | The Case Type slug for a per-Case-Type role; empty for a site-wide one.          |
| `Reason`       | Multiple lines, plain text |         | The Maintainer's reason. Required by the app.                                    |
| `Changes`      | Multiple lines, plain text |         | JSON list of `{ field, before, after }`, one per group or role entry it changed. |
| `Outcome`      | Single line of text        |         | Exactly `recorded`, `not-applied` or `partly-applied`.                           |
| `RelatesTo`    | Single line of text        |         | On a `not-applied` or `partly-applied` entry, the id of the entry it follows.    |

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

## 6. Roles and Case list groups

Groups say who can open a Case list; one `CoraUserRoles` row per person says
what they may do in CORA
([ADR-0059](../adr/0059-roles-live-in-a-list-groups-only-open-lists.md)). The
one role still held in a group is the Maintainer, `CORA Owner Delegates`. For a
Case Type whose display name is `X` (e.g. `Complaints`, **not** the slug
`complaints`), provision the following.

### `CoraUserRoles` list

One site-wide list, **not** environment-prefixed, for the same reason as
`CoraAccessLog`.

| Column (internal name)    | Type                                    | Indexed | Notes                                                                       |
| ------------------------- | --------------------------------------- | :-----: | --------------------------------------------------------------------------- |
| `Title`                   | Single line of text                     |  **✓**  | The person's bare account; every read filters on it. Enforce unique values. |
| `Person`                  | Person, single value                    |  **✓**  | The same person, for the SharePoint UI. Enforce unique values.              |
| `Adviser`                 | Yes/No                                  |         | Default No.                                                                 |
| `Controls`                | Yes/No                                  |         | Default No.                                                                 |
| `ReviewerManager`         | Yes/No                                  |         | Default No.                                                                 |
| `ResponsiblePartyManager` | Yes/No                                  |         | Default No.                                                                 |
| `Reviewer`                | Yes/No                                  |         | A Reviewer who holds no Case Type. Default No.                              |
| `CanSearchCases`          | Yes/No                                  |         | Permission: search every Case Type, without being Controls. Default No.     |
| `CanChangeOutcome`        | Yes/No                                  |         | Permission: amend a reportable Outcome, without being Controls. Default No. |
| `Reviews`                 | Choice, allow multiple, Case Type slugs |         | One choice per Case Type slug (`complaints`), not its display name.         |
| `OwnsCaseTypes`           | Choice, allow multiple, Case Type slugs |         | As `Reviews`.                                                               |
| `JourneyOwnerOf`          | Choice, allow multiple, Case Type slugs |         | As `Reviews`.                                                               |

Create both indexes **while the list is empty**. Break permission inheritance:
`CORA Owner Delegates` get Contribute, every CORA user gets Read, and versioning
stays on so each change to a row has a history. Onboarding a Case Type adds its
slug as a choice on the three multi-choice columns.

### Case list groups

Per Case Type, granted on its `Cases-{Slug}` list in **every** environment:

| Group             | Permission level              |
| ----------------- | ----------------------------- |
| `Cases - X Read`  | Read                          |
| `Cases - X Write` | `CORA Contribute (no delete)` |

Once, granted on every Case list in every environment: `CORA All Cases Read`
(Read) and `CORA All Cases Write` (`CORA Contribute (no delete)`). Make `CORA
Owner Delegates` the owner of each, as for every other CORA group.

### Group owner: `CORA Owner Delegates`

Make `CORA Owner Delegates` the **owner** of every CORA group except itself. A
group's owner can always read and change its membership, so Maintainers can
manage access from the Access page without being site collection
administrators.

### The group each role needs

The Access page gives a role its row entry plus the group it needs, if any:

| Role                                              | Group given            |
| ------------------------------------------------- | ---------------------- |
| Reviewer, Case Type Owner or Journey Owner of `X` | `Cases - X Write`      |
| Reviewer Manager, RP Manager                      | `CORA All Cases Read`  |
| Controls                                          | `CORA All Cases Write` |
| Search all Cases (permission)                     | `CORA All Cases Read`  |
| Change an Outcome (permission)                    | `CORA All Cases Write` |
| Adviser, Reviewer of no Case Type                 | none                   |

Removing a role keeps any group another of the person's roles needs, and an
Adviser keeps every `Cases - X Write` group. A failed read of `CoraUserRoles`
stops the app at its error panel.

### Advisers open only the lists they are added to

An Adviser's `#/my-cases` reads only the Case lists their groups open:
`Cases - X Read` or `Cases - X Write`, or either all-lists group. They are added
to `Cases - X Write` as they are named on a Case of that type. The
`notifications` pipeline asks for it: it emits an
`add_user_group_priviledges_<stamp>.json` Deliverable naming each frontline
notification recipient's login and the `Cases - X Write` groups they need, into
the `cora_user_group_privileges` outbox, so a Responsible Party can be granted
access to the Case in the same pass that tells them about it. **It is a request,
not an application:** the pipeline writes the file to a local outbox and stops
there, and the **Forwarder** that would deliver it is designed but not yet
built, so acting on the file is currently a manual step. See the data
pipeline's
[`docs/data-dictionary-notifications.md`](../../../docs/data-dictionary-notifications.md).

Add Advisers to the group **directly**. The app reads only a person's direct
SharePoint group memberships, so an Adviser reached through an AD group nested
inside `Cases - X Write` can open the list but sees none of its Cases on
`#/my-cases`. Every other role is read from the row and is unaffected.

### Retiring the old groups

ADR-0059's phase 5 removes the groups the app read before the roles list. Once
it is deployed and the UAT ACL smoke passes with the
[persona matrix](testing.md#selective-security-assurance):

1. Remove the site-wide `Frontline` group's Read from every Case list, in every
   environment. Until this step any Adviser can read every Case of every type
   through REST.
2. Remove each remaining old group's permissions from every Case list, then
   delete the group: `Reviewers`, `Frontline`, `Controls`, `Reviewer Managers`,
   `ResponsibleParty-Managers`, and per Case Type `Reviewers - X`,
   `Frontline - X`, `CaseTypeOwner - X` and `JourneyOwner - X`.
3. Run the UAT ACL smoke again. Somebody who loses access here was never moved:
   give them their role from the Access page.

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
