# Case Type onboarding checklist

Maintainer-facing runbook for provisioning a new Case Type end to end. It
extends the scaffolding contract with the SharePoint list-provisioning steps and
the **index-at-creation** requirement the List View Threshold imposes.

The point of this doc is that provisioning a list is a **doc-driven task, not a
code-reading exercise**: the required columns and which of them are indexed live
here, not reverse-engineered from the `CaseRow` typedef in
`src/sharepoint-client.js`.

## ⚠️ The one irreversible step: index at creation

**A SharePoint column index cannot be added once a list has grown past the List
View Threshold (LVT, default 5,000 rows).** Every `Cases-{slug}` list must
therefore be provisioned with its indexed columns created **while the list is
still empty**, before any Cases are ingested.

Miss this on a high-volume Case Type — the upcoming ~900-Cases/day type crosses
5,000 rows in ~17 days — and the list becomes unqueryable with **no fix short of
rebuilding the list**. There is no automation tier to re-provision it,
so getting it right up front is the whole game.

- **Index these columns on the empty list, up front.** See
  [Indexed columns](#indexed-columns) below.
- **Max 20 indexes per list.** We currently index 14, so there is headroom, but
  the ceiling is real — do not index blindly.
- **Compound (two-column) indexes** are available if a future live query needs a
  two-column narrowing; they count against the same 20-index budget.

## Checklist

### 1. Scaffold the application config

```sh
python3 scripts/scaffold_case_type.py --slug widget-review --display "Widget Review"
```

This creates the Case Type module, manifest entry, permissions entry, mock
personas, mock Cases, and a test file. Work through the generated
`TODO(case-type)` markers (Question Bank, Outcome vocabulary, appeal raiser, Case
Details fields, SLA hours), then `npm run check && node --test`.

For the manual, code-only path — every file the scaffold touches, what each
edit does, and a full dev-harness verification tour — see
[docs/guide/case-type-onboarding-code.md](guide/case-type-onboarding-code.md).

### 2. Provision the SharePoint list

- [ ] Create the `Cases-{slug}` list.
- [ ] Add every column in the [column schema](#cases-slug-column-schema) below
      (shared lifecycle/flag/date/blob columns **and** this Case Type's typed
      detail columns, if any are promoted out of the `Details` blob).
- [ ] **On the still-empty list**, add an index to each column marked **Indexed**
      in the schema. This is the irreversible step above — do it before ingesting
      any Cases.
- [ ] Confirm the index count is ≤ 20.
- [ ] **On every existing `Cases-{slug}` list, in both prod and UAT**: add `Void`
      to the `Status` choice column, and add the `VoidedAt`, `VoidReason` and
      `VoidedBy` columns. Without the choice value, voiding a Case fails on the
      PATCH; without `VoidedAt` indexed, the manager's void report reads the
      whole list. `VoidedAt` can only be indexed on an empty list, so on a list
      already past the threshold the report is served unindexed.
- [ ] Before enabling `maxInProgressCases` on a list that already contains
      Cases, backfill every unset `OnHold` value to **No**. The allocation count
      filters on `OnHold = No`, so legacy null values would otherwise be omitted.
- [ ] Set the Case Type module's `listName` to the new list once list-backed
      reads are wired in (until then the scaffold runs mock-only via `?mock=1`).

### 3. Provision groups and permissions

- [ ] Create the per-Case-Type SharePoint groups derived from the permissions
      entry (`Reviewers - {display}`, `CaseTypeOwner - {display}`,
      `JourneyOwner - {display}`) and set the list ACLs — list permissions are
      the real security boundary.

## `Cases-{slug}` column schema

Every `Cases-{slug}` list carries the same shared columns; only the typed detail
columns vary by Case Type. Column names below are the SharePoint **internal
names** (what OData `$filter`/`$select` use); People columns expose an
`…Id` field, which is the name to index and filter on.

**Provenance** notes which columns the **app writes** as part of a lifecycle
transition — in particular the Action Centre reason flag/clock pairs, hoisted
onto queryable columns rather than mined from the JSON blobs so live reads can
lead with an indexed predicate.

### Shared columns

| Column (internal name)                                  | Type                                                                  | Indexed | Provenance / notes                                                                                                                                                                                                                 |
| ------------------------------------------------------- | --------------------------------------------------------------------- | :-----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Id`                                                    | Counter                                                               |  (PK)   | SharePoint built-in item id.                                                                                                                                                                                                       |
| `Title`                                                 | Single line of text                                                   |  **✓**  | The Case Reference; searched by anchored prefix, so it must be index-served.                                                                                                                                                       |
| `CaseType`                                              | Single line of text                                                   |         | Slug; constant per list, so not worth indexing.                                                                                                                                                                                    |
| `Status`                                                | Choice (`In-progress` / `Actions In Progress` / `Completed` / `Void`) |  **✓**  | Lifecycle state; leading predicate for most live reads. **`Void` must be added to the choice list on every existing Case Type list, in both environments** — SharePoint rejects a PATCH writing a value the column does not offer. |
| `AssignedReviewer` (`AssignedReviewerId`)               | Person                                                                |  **✓**  | The Reviewer the Case is assigned to.                                                                                                                                                                                              |
| `AssignedAt`                                            | Date and Time                                                         |         | When the Case was last handed to its Reviewer; client-written with `AssignedReviewer`.                                                                                                                                             |
| `ResponsibleParty` (`ResponsiblePartyId`)               | Person                                                                |  **✓**  | The Responsible Party.                                                                                                                                                                                                             |
| `AssignedReviewerManager` (`AssignedReviewerManagerId`) | Person                                                                |  **✓**  | Reviewer's manager; Reviewer-Manager team reads lead with it.                                                                                                                                                                      |
| `ResponsiblePartyManager` (`ResponsiblePartyManagerId`) | Person                                                                |  **✓**  | Responsible Party's manager.                                                                                                                                                                                                       |
| `DueDate`                                               | Date and Time                                                         |  **✓**  | Working-day SLA due date for the review; app-written at the allocation claim.                                                                                                                                                      |
| `CompletedAt`                                           | Date and Time                                                         |  **✓**  | Stamped at the final `Completed` transition; app-written.                                                                                                                                                                          |
| `ReportableAt`                                          | Date and Time                                                         |  **✓**  | Stamped at the reportable milestone; app-written. Leads the Case search date window.                                                                                                                                               |
| `RemediationDueDate`                                    | Date and Time                                                         |         | Remediation SLA; app-written.                                                                                                                                                                                                      |
| `RelatedDate`                                           | Date and Time                                                         |         | Case Type–specific reference date.                                                                                                                                                                                                 |
| `Created`                                               | Date and Time                                                         |         | SharePoint built-in.                                                                                                                                                                                                               |
| `Modified`                                              | Date and Time                                                         |  **✓**  | SharePoint built-in. Indexed for the data pipeline, which polls the list incrementally on `Modified gt <watermark>`; nothing in the browser application reads it.                                                                  |
| `HasOpenAppeal`                                         | Yes/No                                                                |  **✓**  | Action Centre reason flag; app-written with the `Appeals` blob.                                                                                                                                                                    |
| `AppealRaisedAt`                                        | Date and Time                                                         |         | Clock paired with `HasOpenAppeal`; app-written.                                                                                                                                                                                    |
| `AwaitingResponsibleParty`                              | Yes/No                                                                |  **✓**  | Action Centre reason flag; app-written on Conversation posts and at Send Actions, cleared on close and void.                                                                                                                       |
| `AwaitingSince`                                         | Date and Time                                                         |         | Clock paired with `AwaitingResponsibleParty`; app-written.                                                                                                                                                                         |
| `ReviewRequired`                                        | Yes/No                                                                |         | Retired Action Centre reason flag (issue #515); no longer read or written by the app, kept only because live rows still carry stored values.                                                                                       |
| `OnHold`                                                | Yes/No                                                                |  **✓**  | Reviewer hold state; indexed for allocation capacity counts.                                                                                                                                                                       |
| `PlacedOnHoldAt`                                        | Date and Time                                                         |         | Cleared automatically when leaving `In-progress`.                                                                                                                                                                                  |
| `VoidedAt`                                              | Date and Time                                                         |  **✓**  | Stamped when a Case is voided; app-written. Leads the void report's date window, so it must be indexed on the empty list.                                                                                                          |
| `VoidReason`                                            | Single line of text                                                   |         | Void Reason key from the framework vocabulary; app-written. Grouped client-side, never queried.                                                                                                                                    |
| `VoidedBy` (`VoidedById`)                               | Person                                                                |         | Whoever voided the Case; app-written, resolved to a numeric id the same way as the other Person columns — see ADR-0046.                                                                                                            |
| `Outcome`                                               | Single line of text                                                   |         | Live working Outcome.                                                                                                                                                                                                              |
| `OutcomeAtCompletion`                                   | Single line of text                                                   |         | Frozen Outcome snapshot taken at reportable; app-written.                                                                                                                                                                          |
| `HadRemediation`                                        | Yes/No                                                                |         | Frozen at reportable; app-written.                                                                                                                                                                                                 |
| `EffectiveOutcome`                                      | Single line of text                                                   |         | Corrected Outcome for RP-team reporting; app-written.                                                                                                                                                                              |
| `EffectiveHadRemediation`                               | Yes/No                                                                |         | Corrected remediation flag; app-written.                                                                                                                                                                                           |
| `OutcomeOverridden`                                     | Yes/No                                                                |         | Set when an Amended Outcome diverges from the snapshot.                                                                                                                                                                            |
| `QuestionBankVersion`                                   | Single line of text                                                   |         | Question-bank snapshot version for the Case; app-written.                                                                                                                                                                          |
| `CaseJustification`                                     | Multiple lines of text                                                |         | Case-level justification.                                                                                                                                                                                                          |
| `Notes`                                                 | Multiple lines of text (plain)                                        |         | Free-text notes; never `innerHTML`.                                                                                                                                                                                                |
| `Answers`                                               | Multiple lines of text (JSON blob)                                    |         | All Answers; field-level PATCH only.                                                                                                                                                                                               |
| `Conversation`                                          | Multiple lines of text (JSON blob)                                    |         | Conversation messages.                                                                                                                                                                                                             |
| `Appeals`                                               | Multiple lines of text (JSON blob)                                    |         | Appeal records; additive, never mutates the frozen Case.                                                                                                                                                                           |
| `AmendedOutcome`                                        | Multiple lines of text (JSON blob)                                    |         | Case-level Amended Outcome record.                                                                                                                                                                                                 |
| `Details`                                               | Multiple lines of text (JSON blob)                                    |         | Case Details values keyed by the Case Type's `detailFields[].key`; read-only.                                                                                                                                                      |

The JSON-blob columns (`Answers`, `Conversation`, `Appeals`, `AmendedOutcome`,
`Details`) are **deliberately not indexed and never queried** — reason-defining
data is hoisted onto the flag/date columns above precisely so live reads never
have to scan a blob.

The corrected-reporting columns (`EffectiveOutcome`, `EffectiveHadRemediation`,
`OutcomeOverridden`) are **not** indexed either. The client can filter on the
first and third, but nothing in the app passes those filters today — every
reporting read reaches its rows through the lifecycle and reason columns and
narrows on the effective result client-side. Index them only when a live read
actually leads with one, and only within the 20-index budget.

### Per-Case-Type detail columns

A Case Type declares its Case Details fields via `detailFields` in
`case-types/{slug}.js` (`CaseDetailField` = `{ key, label }`). Their **values**
live in the shared `Details` JSON blob keyed by `key` and are read-only
everywhere, so **by default a Case Type adds no new physical columns**
for its details.

If a future Case Type ever needs to **query or report on a detail field**
(filter/sort/count on it), promote that one field out of the `Details` blob into
its own typed, top-level column — and, if a live read will lead with it, index it.
That promoted column is subject to the same index-at-creation trap: **create and
index it on the empty list**, because it cannot be indexed retroactively once the
list is past the threshold.

## Indexed columns

The 14 columns to index on the empty `Cases-{slug}` list — the
lifecycle/date columns, the Action Centre reason flags that live reads lead
with, the two columns Case search leads with, and the one the data pipeline
polls on:

`Status`, `DueDate`, `CompletedAt`, `AssignedReviewer`, `ResponsibleParty`,
`AssignedReviewerManager`, `ResponsiblePartyManager`, `HasOpenAppeal`,
`AwaitingResponsibleParty`, `OnHold`, `Title`,
`ReportableAt`, `VoidedAt`, `Modified`.

14 of a maximum 20 indexes per list. Add any promoted detail column (above) to
this set only if a live query will lead with it, and keep the total ≤ 20.

`Modified` is a SharePoint built-in, so it needs no creating — but it does need
indexing, and it is the one entry here no part of the browser application asks
for. The data pipeline ingests each list incrementally by polling
`Modified gt <watermark>`, so every poll leads with that predicate. Unindexed, it
reads the whole list and stops working altogether once the list passes the List
View Threshold — the same irreversible trap as `VoidedAt`, and easy to miss
because nothing in the front end degrades when it is skipped.

`VoidedAt` joined this set with the Void status, and it is the same trap again:
the manager's void report leads with its date window, so a `Cases-{slug}` list
already past the threshold cannot be given the index that makes that report
cheap.

`Title` and `ReportableAt` joined this set when Case search was added, and the
index-at-creation trap applies to them exactly as it does to a promoted detail
column: a `Cases-{slug}` list already past 5,000 items **cannot** have an index
added afterwards. Indexing them is therefore a provisioning precondition for
search on an existing list, not a follow-up — a list past the threshold has to
be re-provisioned to gain them.
