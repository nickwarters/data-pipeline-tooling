# Data dictionary — `sharepoint_cases`

The filled-in entry for the `sharepoint_cases` feed, following
[`data-dictionary-template.md`](data-dictionary-template.md). Two tables: the
faithful raw observation and the typed Case version. The Python contract is
[`pipelines/sharepoint_cases/schema.py`](../pipelines/sharepoint_cases/schema.py);
this page is its prose companion.

The column set comes from the Case Review Platform's own provisioning
authority — `platform_frontend/docs/case-type-onboarding.md` — which is what a
Maintainer creates a list from. The read mirrors
`platform_frontend/src/services/http-sharepoint-client.js`.

## Three things to know before this feed reaches a tenant

**1. The site URL and list GUID are placeholders.** `SITE` and `LIST_ID` in
`pipeline.py` are `https://sharepoint.invalid/sites/REPLACE-ME` and the nil UUID.
Neither value exists anywhere to copy: the review application derives its site
from the page it is served from and addresses lists by *title*, never by GUID. So
both must be filled in from the tenant. The watermark is keyed on the GUID, and a
wrong one does not fail — it silently forks the feed's place and looks like a
first load.

**2. `Modified` is not an indexed column, and cannot become one later.** The
list's 14 indexes are listed in `case-type-onboarding.md`; `Modified` is not among
them, and SharePoint cannot index a column on a list already past the 5,000-row
List View Threshold. A `Modified`-windowed poll therefore works on a small list
and starts failing as the list grows. **Indexing `Modified` is a provisioning
prerequisite for this feed** and has to happen while the list is under the
threshold. Recorded here, not solved here.

**3. One list per Case Type, and only Complaints is live.** Lists are named
`Cases-{slug}`; there is no combined list and no default. This feed targets
`Cases-Complaints` directly. A UAT tenant prefixes the same list `uat_`, so a UAT
run needs `LIST_NAME` changed accordingly.

## Where "when we saw it" lives

Neither table carries an observation timestamp, an ingestion batch id, or a
pipeline run id as a **column**, and that is deliberate. The load strategy is
`AppendOnly`, which compares every non-key column of a re-presented row against
the row already stored; a per-read stamp would differ on every overlapping poll
and turn each ordinary re-read into an append-only conflict. The rows record
*what the list said*, and only that.

When we saw it is recorded elsewhere, and is still recoverable: the **run log**
(`<base>/_runs/sharepoint_cases.log`) timestamps every step and its
`data_locations` name the list and both tables, and the **ingestion batch id**
returned on `SharePointIngestResult` identifies the source window the poll
resumed from. The Reader's `observed_at` stamp is an injectable callable and is
dropped at the storable-observation boundary for the same reason.

## `case_observation` — raw layer

The faithful landing zone: one row per *observation of a list item at one
version*, in SharePoint's own column names. Never renamed, never coerced — it is
the diagnosable, re-runnable copy of what the list returned.

### Part A — Table / Feed overview

| Attribute | Value |
|-----------|-------|
| **Table / Feed name** | `case_observation` |
| **Subject / Case Type** | `sharepoint_cases` |
| **Medallion layer** | raw |
| **Grain** | one row per observation (one list item at one version) |
| **Is this a Case Type?** | No — an ingest feed; the Case Type question is settled at gold |
| **Natural key → `case_id`** | n/a at this layer |
| **Source system** | SharePoint list `Cases-Complaints` (site and GUID: placeholders, see above) |
| **Reader** | `SharePointModifiedReader`, behind the feed's `StorableObservations` projection |
| **Load strategy** | `AppendOnly("source_observation_id")` |
| **Upstream dependencies** | none — source feed |
| **Schedule / freshness** | polled; window `end = server_now - 30s`, `start = watermark - 5m` |
| **Owner / data steward** | *<team>* |
| **Source of truth doc** | `platform_frontend/docs/case-type-onboarding.md` |
| **Last reviewed** | 2026-08-06 |

### Part B — Field dictionary

Raw stores every documented column of the list, under the source's own name,
plus the five stamped provenance columns. Types below are as the column arrives
(SQLite is dynamically typed and raw does not coerce). Rather than repeat forty
rows twice, the meaning of each column is given once in the `case_version`
dictionary below, against its canonical name; the mapping between the two is
purely mechanical (see **Part B** there).

Two source columns are **not** stored: `Modified` and `odata.etag`. The stamped
`source_modified_at` and `source_version` carry exactly what they said, in the
vocabulary every hop below reads.

| Field | Source column | Type | Nullable | Description |
|-------|---------------|------|----------|-------------|
| `source_list_name` | *(stamped)* | text | No | The list the observation came from. |
| `source_item_id` | *(stamped, from `Id`)* | text | No | The list item's id, as text. |
| `source_modified_at` | *(stamped, from `Modified`)* | text | No | The item's `Modified`, in UTC. |
| `source_version` | *(stamped, from `odata.etag`)* | text | No | The version observed; falls back to a digest of the item's projected values where the list supplies no stamp. |
| `source_observation_id` | *(stamped)* | text | No | A sha256 over list, item and version — the append-only key. Derived, so it replaces no source column. |
| *(all others)* | the list's own column names | as returned | mostly | See the `case_version` table below. |

### Part C — Row checks

None. Raw is a faithful mirror.

### Part D — Quarantine & data quality

- Raw does not quarantine: a value-rule breach is silver's business, so a row
  with an unknown `Status` **is** here even though it never reaches
  `case_version`.
- The Reader cannot see a hard delete: an item removed from the list has no
  `Modified` and so appears in no window. Reconciliation is a separate mechanism.
- The read leads with `$select=*`. That star is load-bearing — naming a person's
  sub-field turns the read into a projection and every other column silently
  stops coming back.

---

## `case_version` — silver layer

One row per observed Case version, snake_cased and typed. The change-over-time
record: a later `Modified` on the same item is a **new row**, never an update.

This hop is the rename and the type contract, and deliberately nothing more.
There is no derivation, no reshaping and no parsing — the JSON blob columns land
as the unparsed text the list holds, because parsing them needs the Case Type's
own question bank and that is a gold concern.

### Part A — Table / Feed overview

| Attribute | Value |
|-----------|-------|
| **Table / Feed name** | `case_version` |
| **Subject / Case Type** | `sharepoint_cases` |
| **Medallion layer** | silver |
| **Grain** | one row per observation of a Case |
| **Is this a Case Type?** | Not yet — the gold assembly is an open decision |
| **Natural key → `case_id`** | n/a until gold; `id` (the SharePoint item id) is the candidate |
| **Source system** | `raw.case_observation` (the batch just fetched, not the whole history) |
| **Reader** | `DatasetReader` over the fetched batch |
| **Load strategy** | `AppendOnly("source_observation_id")` |
| **Upstream dependencies** | `raw.case_observation` |
| **Schedule / freshness** | with the poll |
| **Owner / data steward** | *<team>* |
| **Source of truth doc** | `pipelines/sharepoint_cases/schema.py` |
| **Last reviewed** | 2026-08-06 |

**The rename is one mechanical rule**, not a curated map: each source name is
split on word boundaries and on `/`, and lower-snake-cased. `DueDate` →
`due_date`, `AssignedReviewerId` → `assigned_reviewer_id`,
`ResponsibleParty/Title` → `responsible_party_title`. Names that are already
snake_case (the stamped provenance columns) pass through unchanged. There is no
per-column mapping to keep in step with the list.

### Part B — Field dictionary

| Field | Source column | Type | Nullable | Value rules | Description | Example | Sensitivity | Notes |
|-------|---------------|------|----------|-------------|-------------|---------|-------------|-------|
| `source_observation_id` | *(stamped)* | `str` | No | `NonNull` | The observation's identity, and the append-only key. | *(64-char sha256)* | None | |
| `source_list_name` | *(stamped)* | `str` | No | `NonNull` | The list observed. | `Cases-Complaints` | None | |
| `source_item_id` | *(stamped)* | `str` | No | `NonNull` | The list item observed, as text. | `101` | Internal | Same value as `id`, in the provenance vocabulary. |
| `source_version` | *(stamped)* | `str` | No | `NonNull` | The version observed. | `3` | None | |
| `source_modified_at` | *(stamped)* | `datetime` | No | `NonNull` | When the source last changed the item. | `2026-08-05T08:10:00+00:00` | None | Orders the versions of one item. |
| `id` | `Id` | `int` | No | `NonNull` | The SharePoint item id — **the Case's identity**. | `101` | Internal | Unique within the Case Type's list. |
| `title` | `Title` | `str` | Yes | — | The human **Case Reference**. | `CMP-000101` | Internal | Nullable, and carries no format the application enforces. Unique only within a Case Type, and prefix-searchable only. A Case without one is ordinary. |
| `case_type` | `CaseType` | `str` | Yes | — | The Case Type slug. | `complaints` | None | Constant per list. |
| `status` | `Status` | `str` | No | `NonNull`, `OneOf(In-progress, Actions In Progress, Completed, Void)` | The Case's lifecycle state at this version. | `In-progress` | None | The list's only Choice column. Note the hyphen in `In-progress` and that `Actions In Progress` has none — these are persisted values, not display copy. `Void` may be missing from older provisioned lists. |
| `assigned_reviewer_name` | `AssignedReviewer/Name` | `str` | Yes | — | The Reviewer the Case is assigned to, as a claims login. | `i:0#.w\|CONTOSO\a.khan` | PII | See *Person columns* below. |
| `assigned_at` | `AssignedAt` | `datetime` | Yes | — | When the Case was last handed to its Reviewer. | `2026-07-01T09:15:00+00:00` | None | |
| `responsible_party_name` | `ResponsibleParty/Name` | `str` | Yes | — | The Responsible Party, as a claims login. | `i:0#.w\|CONTOSO\b.okafor` | PII | |
| `responsible_party_title` | `ResponsibleParty/Title` | `str` | Yes | — | The Responsible Party's directory display name. | `Bola Okafor` | PII | The only person the read asks a display name for — the one a view names a person by. |
| `assigned_reviewer_manager_name` | `AssignedReviewerManager/Name` | `str` | Yes | — | The Reviewer's manager. | `i:0#.w\|CONTOSO\d.reid` | PII | |
| `responsible_party_manager_name` | `ResponsiblePartyManager/Name` | `str` | Yes | — | The Responsible Party's manager. | `i:0#.w\|CONTOSO\e.novak` | PII | |
| `due_date` | `DueDate` | `datetime` | Yes | — | Working-day SLA due date. | `2026-08-14T00:00:00+00:00` | None | |
| `completed_at` | `CompletedAt` | `datetime` | Yes | — | Stamped at the final `Completed` transition. | | None | |
| `reportable_at` | `ReportableAt` | `datetime` | Yes | — | Stamped at the reportable milestone. | | None | |
| `remediation_due_date` | `RemediationDueDate` | `datetime` | Yes | — | Remediation SLA. | | None | |
| `related_date` | `RelatedDate` | `datetime` | Yes | — | Case Type–specific reference date. | | None | |
| `created` | `Created` | `datetime` | Yes | — | SharePoint built-in creation time. | | None | |
| `has_open_appeal` | `HasOpenAppeal` | `bool` | Yes | — | Action Centre reason flag, paired with `Appeals`. | `false` | None | |
| `appeal_raised_at` | `AppealRaisedAt` | `datetime` | Yes | — | Clock paired with `has_open_appeal`. | | None | |
| `awaiting_responsible_party` | `AwaitingResponsibleParty` | `bool` | Yes | — | Action Centre reason flag, written on every Conversation post. | `true` | None | |
| `awaiting_since` | `AwaitingSince` | `datetime` | Yes | — | Clock paired with `awaiting_responsible_party`. | | None | |
| `review_required` | `ReviewRequired` | `bool` | Yes | — | Action Centre reason flag. | `false` | None | Nothing in the application writes it yet. |
| `on_hold` | `OnHold` | `bool` | Yes | — | Reviewer hold state. | `false` | None | |
| `placed_on_hold_at` | `PlacedOnHoldAt` | `datetime` | Yes | — | When the hold was placed. | | None | Cleared automatically when leaving `In-progress`. |
| `voided_at` | `VoidedAt` | `datetime` | Yes | — | When the Case was voided. | | None | |
| `void_reason` | `VoidReason` | `str` | Yes | — | Void Reason key from the framework vocabulary. | `duplicate` | None | A key, not display copy. Not constrained here: the vocabulary is the review application's and may widen. |
| `voided_by_name` | `VoidedBy/Name` | `str` | Yes | — | Whoever voided the Case. | `i:0#.w\|CONTOSO\d.reid` | PII | |
| `outcome` | `Outcome` | `str` | Yes | — | Live working Outcome. | `Upheld` | None | Free text; the vocabulary is the Case Type's. |
| `outcome_at_completion` | `OutcomeAtCompletion` | `str` | Yes | — | Frozen Outcome snapshot taken at reportable. | `Not upheld` | None | |
| `had_remediation` | `HadRemediation` | `bool` | Yes | — | Frozen at reportable. | `false` | None | |
| `effective_outcome` | `EffectiveOutcome` | `str` | Yes | — | Corrected Outcome for RP-team reporting. | `Upheld` | None | |
| `effective_had_remediation` | `EffectiveHadRemediation` | `bool` | Yes | — | Corrected remediation flag. | `true` | None | |
| `outcome_overridden` | `OutcomeOverridden` | `bool` | Yes | — | Set when an Amended Outcome diverges from the snapshot. | `true` | None | |
| `question_bank_version` | `QuestionBankVersion` | `str` | Yes | — | Question-bank snapshot version for the Case. | `complaints-2026.07` | None | Needed to read `answers` correctly. |
| `case_justification` | `CaseJustification` | `str` | Yes | — | Case-level justification. | | Internal | Free text. |
| `notes` | `Notes` | `str` | Yes | — | Free-text notes. | | Internal | Plain text, never HTML. |
| `answers` | `Answers` | `str` | Yes | — | All Answers, as unparsed JSON text. | `{"q-outcome":{"value":"Not upheld"}}` | Internal | Not parsed here — see below. |
| `conversation` | `Conversation` | `str` | Yes | — | Conversation messages, as unparsed JSON text. | `[]` | PII | |
| `appeals` | `Appeals` | `str` | Yes | — | Appeal records, as unparsed JSON text. | `[]` | Internal | |
| `amended_outcome` | `AmendedOutcome` | `str` | Yes | — | Case-level Amended Outcome record, as unparsed JSON text. | | Internal | |
| `details` | `Details` | `str` | Yes | — | Case Details values keyed by the Case Type's `detailFields[].key`, as unparsed JSON text. | `{"product":"Current account"}` | Internal | |

#### Person columns

There are **no multi-value columns on this list** — no Lookup, no multi Choice,
no multi User. All five person columns hold a single user, and the read expands
each so it answers with `{Name, Title}` rather than the numeric id it otherwise
returns.

`Name` is the claims login (`i:0#.w|CONTOSO\a.khan`) and is what the review
application keys identity on, right down to which Sections a viewer may open.
The numeric `…Id` twin SharePoint also offers is a transport detail of one site
collection — allocated on first use and re-allocated if the account is removed —
so it is **not** stored. Silver lands the login as the source spells it; reducing
it to a bare account name, or joining it to a person, is a gold concern.

#### JSON blob columns

`answers`, `conversation`, `appeals`, `amended_outcome` and `details` land as
text and are never parsed by this feed. They are deliberately un-indexed and
never queried on the source side either: the reason-defining data is hoisted onto
the flag and date columns precisely so nothing has to scan a blob.

### Part C — Row checks

None. Cross-field rules (a `Completed` Case carrying a `completed_at`, a `Void`
one carrying a `void_reason`) are plausible and deliberately **not** declared:
this feed has no evidence about how consistently older rows hold them, and a rule
guessed at here would quarantine real data.

### Part D — Quarantine & data quality

- The only value rule that can quarantine a row is `status`. A value outside the
  four means the list's Choice column changed under us, and quarantine
  (`<base>/sharepoint_cases/quarantine.db`, table `case_version`, `failed_rule`
  set) is where that should surface rather than in a report. The raw observation
  is kept either way, so nothing is silently discarded.
- A structural breach — a missing column, a wrong dtype, a null `id` or a null
  provenance column — still aborts the run.
- Everything else is typed and left alone. Columns whose constraints belong to
  the review application (`outcome`, `void_reason`, `question_bank_version`) get
  no rule here, because a rule this feed cannot justify is a rule that will
  eventually reject good data.
