# Case Type onboarding checklist

Maintainer-facing runbook for provisioning a new Case Type end to end. It
extends the scaffolding contract ()
with the SharePoint list-provisioning steps and the **index-at-creation**
requirement from.

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
- **Max 20 indexes per list.** We currently index 11, so there is headroom, but
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
- [ ] Set the Case Type module's `listName` to the new list once list-backed
      reads are wired in (until then the scaffold runs mock-only via `?mock=1`,
      the architecture decision).

### 3. Provision groups and permissions

- [ ] Create the per-Case-Type SharePoint groups derived from the permissions
      entry (`Reviewers - {display}`, `CaseTypeOwner - {display}`,
      `JourneyOwner - {display}`, the architecture decision) and set the list ACLs (the architecture decision —
      list permissions are the real security boundary).

## `Cases-{slug}` column schema

Every `Cases-{slug}` list carries the same shared columns; only the typed detail
columns vary by Case Type. Column names below are the SharePoint **internal
names** (what OData `$filter`/`$select` use); People columns expose an
`…Id` field, which is the name to index and filter on.

**Provenance** notes which columns the **app writes** as part of a lifecycle
transition — in particular the the architecture decision flag/clock pairs, hoisted onto queryable
columns rather than mined from the JSON blobs so live reads can lead with an
indexed predicate.

### Shared columns

| Column (internal name)                    | Type                                                         | Indexed | Provenance / notes                                                            |
| ----------------------------------------- | ------------------------------------------------------------ | :-----: | ----------------------------------------------------------------------------- |
| `Id`                                      | Counter                                                      |  (PK)   | SharePoint built-in item id.                                                  |
| `Title`                                   | Single line of text                                          |         | Case title.                                                                   |
| `CaseType`                                | Single line of text                                          |         | Slug; constant per list, so not worth indexing.                               |
| `Status`                                  | Choice (`In-progress` / `Actions In Progress` / `Completed`) |  **✓**  | Lifecycle state; leading predicate for most live reads.                       |
| `AssignedReviewer` (`AssignedReviewerId`) | Person                                                       |  **✓**  | The Reviewer the Case is assigned to.                                         |
| `ResponsibleParty` (`ResponsiblePartyId`) | Person                                                       |  **✓**  | The Responsible Party.                                                        |
| `AssignedReviewerManager`                 | Person                                                       |  **✓**  | Reviewer's manager; Reviewer-Manager team reads lead with it.                 |
| `ResponsiblePartyManager`                 | Person                                                       |  **✓**  | Responsible Party's manager.                                                  |
| `DueDate`                                 | Date and Time                                                |  **✓**  | Working-day SLA due date; app-written on creation.                            |
| `CompletedAt`                             | Date and Time                                                |  **✓**  | Stamped at the final `Completed` transition; app-written.                     |
| `ReportableAt`                            | Date and Time                                                |         | Stamped at the reportable milestone; app-written.                             |
| `RemediationDueDate`                      | Date and Time                                                |         | Remediation SLA; app-written.                                                 |
| `RelatedDate`                             | Date and Time                                                |         | Case Type–specific reference date.                                            |
| `Created`                                 | Date and Time                                                |         | SharePoint built-in.                                                          |
| `HasOpenAppeal`                           | Yes/No                                                       |  **✓**  | Action Centre reason flag; app-written on appeal raise/resolve.               |
| `AppealRaisedAt`                          | Date and Time                                                |         | Clock paired with `HasOpenAppeal`; app-written.                               |
| `AwaitingResponsibleParty`                | Yes/No                                                       |  **✓**  | Action Centre reason flag; app-written.                                       |
| `AwaitingSince`                           | Date and Time                                                |         | Clock paired with `AwaitingResponsibleParty`; app-written.                    |
| `Reopened`                                | Yes/No                                                       |  **✓**  | Action Centre reason flag; app-written.                                       |
| `ReopenedAt`                              | Date and Time                                                |         | Clock paired with `Reopened`; app-written.                                    |
| `ReviewRequired`                          | Yes/No                                                       |  **✓**  | Action Centre reason flag; app-written.                                       |
| `Outcome`                                 | Single line of text                                          |         | Live working Outcome.                                                         |
| `OutcomeAtCompletion`                     | Single line of text                                          |         | Frozen Outcome snapshot taken at reportable; app-written.                     |
| `HadRemediation`                          | Yes/No                                                       |         | Frozen at reportable; app-written.                                            |
| `EffectiveOutcome`                        | Single line of text                                          |         | Corrected Outcome for RP-team reporting; app-written.                         |
| `EffectiveHadRemediation`                 | Yes/No                                                       |         | Corrected remediation flag; app-written.                                      |
| `OutcomeOverridden`                       | Yes/No                                                       |         | Set when an Amended Outcome diverges from the snapshot.                       |
| `QuestionBankVersion`                     | Single line of text                                          |         | Question-bank snapshot version for the Case; app-written.                     |
| `CaseJustification`                       | Multiple lines of text                                       |         | Case-level justification.                                                     |
| `Notes`                                   | Multiple lines of text (plain)                               |         | Free-text notes; never `innerHTML`.                                           |
| `Answers`                                 | Multiple lines of text (JSON blob)                           |         | All Answers; field-level PATCH only.                                          |
| `Conversation`                            | Multiple lines of text (JSON blob)                           |         | Conversation messages.                                                        |
| `Appeals`                                 | Multiple lines of text (JSON blob)                           |         | Appeal records; additive, never mutates the frozen Case.                      |
| `AmendedOutcome`                          | Multiple lines of text (JSON blob)                           |         | Case-level Amended Outcome record.                                            |
| `Details`                                 | Multiple lines of text (JSON blob)                           |         | Case Details values keyed by the Case Type's `detailFields[].key`; read-only. |

The JSON-blob columns (`Answers`, `Conversation`, `Appeals`, `AmendedOutcome`,
`Details`) are **deliberately not indexed and never queried** — reason-defining
data is hoisted onto the flag/date columns above precisely so live reads never
have to scan a blob.

### Per-Case-Type detail columns

A Case Type declares its Case Details fields via `detailFields` in
`case-types/{slug}.js` (`CaseDetailField` = `{ key, label }`). Their **values**
live in the shared `Details` JSON blob keyed by `key` and are
read-only everywhere, so **by default a Case Type adds no new physical columns**
for its details.

If a future Case Type ever needs to **query or report on a detail field**
(filter/sort/count on it), promote that one field out of the `Details` blob into
its own typed, top-level column — and, if a live read will lead with it, index it.
That promoted column is subject to the same index-at-creation trap: **create and
index it on the empty list**, because it cannot be indexed retroactively once the
list is past the threshold.

## Indexed columns

The 11 columns to index on the empty `Cases-{slug}` list — the
lifecycle/date columns and the the architecture decision reason flags that live reads lead with:

`Status`, `DueDate`, `CompletedAt`, `AssignedReviewer`, `ResponsibleParty`,
`AssignedReviewerManager`, `ResponsiblePartyManager`, `HasOpenAppeal`,
`AwaitingResponsibleParty`, `Reopened`, `ReviewRequired`.

11 of a maximum 20 indexes per list. Add any promoted detail column (above) to
this set only if a live query will lead with it, and keep the total ≤ 20.
