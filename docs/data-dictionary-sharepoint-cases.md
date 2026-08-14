# Data dictionary — `sharepoint_cases`

The filled-in entry for the `sharepoint_cases` feed, following
[`data-dictionary-template.md`](data-dictionary-template.md). Twenty-two
tables: the faithful raw observation, the typed Case version and its silver
`answer`, `answer_capture`, `answer_action`, `general_answer`,
`conversation_message`, `appeal` and `case_detail` Detail Tables, and the
thirteen gold tables reduced from the version history — the current Case,
those same seven Detail Tables, and five aggregates, two of which reduce from
a Detail Table rather than from the current Case. Every declared Case list
lands in the same tables and is told apart by
`case_type`. The
Python contract is
[`pipelines/sharepoint_cases/schema.py`](../pipelines/sharepoint_cases/schema.py);
this page is its prose companion.

The column set comes from the Case Review Platform's own provisioning
authority — `platform_frontend/docs/case-type-onboarding.md` — which is what a
Maintainer creates a list from. The read mirrors
`platform_frontend/src/services/http-sharepoint-client.js`.

## Three things to know before this feed reaches a tenant

**1. The site URL and every list GUID are placeholders.** `SITE` and each
`CaseList`'s `list_id` in `schema.py` are
`https://sharepoint.invalid/sites/REPLACE-ME` and the nil UUID. Neither value
exists anywhere to copy: the review application derives its site from the page it
is served from and addresses lists by *title*, never by GUID. So both must be
filled in from the tenant, per entry. The watermark is keyed on `(site,
list_id)`, and a wrong one does not fail — it silently forks the feed's place and
looks like a first load. Two entries sharing a GUID would share one watermark.

**2. `Modified` is not an indexed column, and cannot become one later.** The
list's 14 indexes are listed in `case-type-onboarding.md`; `Modified` is not among
them, and SharePoint cannot index a column on a list already past the 5,000-row
List View Threshold. A `Modified`-windowed poll therefore works on a small list
and starts failing as the list grows. **Indexing `Modified` is a provisioning
prerequisite for this feed** and has to happen while the list is under the
threshold. Recorded here, not solved here.

**3. One list per Case Type, and only Complaints is provisioned.** Lists are
named `Cases-{slug}`; there is no combined list and no default. All Case Types
share one list template, so the feed polls every entry in `CASE_LISTS` with
identical processing; onboarding a Case Type is a new entry with its own GUID.
A UAT tenant prefixes the same list names `uat_`, so a UAT run needs each
entry's `list_name` changed accordingly.

## Where "when we saw it" lives

Neither the raw nor the silver table carries an observation timestamp or an
ingestion batch id as a **column**, and that is deliberate. (Gold does carry
`as_of_utc`, but that is the run's *candidate window end*, not when we looked —
see below.) The load strategy is `AppendOnly`, which compares every non-key
column of a re-presented row against the row already stored; a per-read stamp
would differ on every overlapping poll and turn each ordinary re-read into an
append-only conflict. The rows record *what the list said*, and only that.

**The one exception is `pipeline_run_id`**, the reserved run-provenance column
every table-backed Writer stamps
([ADR-0020](adr/0020-writer-stamped-run-provenance-column.md)). It escapes the
problem above by construction: the append-only comparison **excludes** it, so an
overlapping poll still reads as unchanged. Because an unchanged row is never
rewritten, the value is *the run that first landed the row* — not when we last
saw it — and it is stable across re-drives. It is the framework's column, not
the feed's: no schema declares it, and it is added after validation.

When we saw it is recorded elsewhere, and is still recoverable: the **run log**
(`<base>/_runs/sharepoint_cases.log`) timestamps every step and its
`data_locations` name the list and every table, and the **ingestion batch id**
returned on each `ListPoll` identifies the source window that list's poll
resumed from. The Reader's `observed_at` stamp is an injectable callable and is
dropped by the raw hop's `observation` transform for the same reason.

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
| **Is this a Case Type?** | No — an ingest feed; identity is derived at gold |
| **Natural key → `case_id`** | n/a at this layer |
| **Source system** | every SharePoint list in `CASE_LISTS` (site and GUIDs: placeholders, see above) |
| **Reader** | `SharePointModifiedReader` per list, projected by the raw hop's `observation` transform |
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
| `pipeline_run_id` | *(stamped by the Writer)* | text | No | The run that **first landed** this observation. Excluded from the append-only comparison, so a re-read is still a no-op. See *Where "when we saw it" lives* above. |
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
| **Is this a Case Type?** | No — one subject holds every Case Type, discriminated by `case_type` |
| **Natural key → `case_id`** | `schema.NATURAL_KEY` = `("case_type", "source_item_id")`, namespaced by the subject `sharepoint_cases` — applied at gold, not here |
| **Source system** | `raw.case_observation` (the batch just fetched, not the whole history) |
| **Reader** | `DatasetReader` over the fetched batch |
| **Load strategy** | `AppendOnly("source_observation_id")` |
| **Upstream dependencies** | none declared (`UPSTREAMS = ()`) — the batch is in memory, not reread from raw |
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

**One column is not a faithful copy: `case_type`.** Raw holds the list's own
`CaseType` cell, exactly as the list holds it. Silver replaces it with the Case
Type declared for the list that was polled. The cell is nullable and editable by
hand in the SharePoint web UI, and gold keys a Case on it — `DeriveKey` refuses a
null natural-key value, so one blank cell would abort gold for every list. After
silver, `case_type` is always the Case Type of the list the row came from.

### Part B — Field dictionary

| Field | Source column | Type | Nullable | Value rules | Description | Example | Sensitivity | Notes |
|-------|---------------|------|----------|-------------|-------------|---------|-------------|-------|
| `source_observation_id` | *(stamped)* | `str` | No | `NonNull` | The observation's identity, and the append-only key. | *(64-char sha256)* | None | |
| `pipeline_run_id` | *(stamped by the Writer)* | `str` | No | — | The run that **first landed** this version. Not declared by the schema — the Writer adds it after validation — and excluded from the append-only comparison. | *(32-char hex)* | None | See *Where "when we saw it" lives* above. |
| `source_list_name` | *(stamped)* | `str` | No | `NonNull` | The list observed. | `Cases-Complaints` | None | |
| `source_item_id` | *(stamped)* | `str` | No | `NonNull` | The list item observed, as text. | `101` | Internal | Same value as `id`, in the provenance vocabulary. |
| `source_version` | *(stamped)* | `str` | No | `NonNull` | The version observed. | `\"3\"` | None | Opaque text. SharePoint's ETag carries its own quotes, and they are kept rather than stripped — the value is compared, never parsed. |
| `source_modified_at` | *(stamped)* | `datetime` | No | `NonNull` | When the source last changed the item. | `2026-08-05T08:10:00+00:00` | None | Orders the versions of one item. |
| `id` | `Id` | `int` | No | `NonNull` | The SharePoint item id — **the Case's identity**. | `101` | Internal | Unique within the Case Type's list. |
| `title` | `Title` | `str` | Yes | — | The human **Case Reference**. | `CMP-000101` | Internal | Nullable, and carries no format the application enforces. Unique only within a Case Type, and prefix-searchable only. A Case without one is ordinary. |
| `case_type` | *(declared)* | `str` | No | `NonNull` | The Case Type of the list polled. | `complaints` | None | **Not** the list's `CaseType` cell, which raw keeps and silver overwrites — see above. Part of the natural key. |
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
each so it answers with its selected sub-fields rather than the numeric id it
otherwise returns. The columns are provisioned "Person or Group" but hold only
people here, so an expanded value carries a claims login: an object arriving
without a `Name` was never expanded, and is refused rather than read as an empty
role. A missing `Title` is not an error — a directory display name is optional,
and only the Responsible Party's is selected at all.

An expanded person arrives **nested on the property** —
`{"AssignedReviewer": {"Name": …}}` — or as a plain `null` where nobody holds the
role. The feed flattens that onto the `AssignedReviewer/Name` columns above
before anything is stored; the `Name`/`Title` split in the column names is this
feed's storage shape, not the payload's. Only `ResponsibleParty` has a `Title`
column, because it is the only one of the five whose display name the read
selects.

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

## `answer` — silver layer (Detail Table)

One row per observation × Question Definition, exploded from `case_version`'s
`answers` JSON map. `general:`-prefixed keys belong to the
[`general_answer`](#general_answer--silver-layer-detail-table) table and are
excluded before this table ever sees them; `remediationActions` and `capture`
are separate Detail Tables of their own.

### Why this table reads silver, not raw

Raw holds the list's own `CaseType` cell exactly as the list holds it —
nullable and hand-editable — while silver has already settled `case_type` to
the value the polled `CaseList` declares. `DeriveKey` mints `case_id` from
`(case_type, source_item_id)`, so an answer row built over raw's cell would, on
any list where that cell is blank or wrong, mint a different `case_id` than the
parent Case's; the gold semi-join would then match nothing and land zero rows,
silently. Reading silver also means a Case quarantined out of `case_version`
contributes no answer rows at all — right, since a quarantined Case can never
win an observation.

### Part A — Table / Feed overview

| Attribute | Value |
|-----------|-------|
| **Table / Feed name** | `answer` |
| **Subject / Case Type** | `sharepoint_cases` |
| **Medallion layer** | silver |
| **Grain** | one row per observation × Question Definition |
| **Is this a Case Type?** | No — a Detail Table hanging off `case_version` |
| **Natural key → `case_id`** | `schema.NATURAL_KEY`, via `DETAIL_ID_VARS` — applied at gold, not here |
| **Source system** | the settled `case_version` batch just fetched (not the whole silver history) |
| **Reader** | `DatasetReader` over that batch |
| **Load strategy** | `AppendOnly(("source_observation_id", "question_id"))` — composite, because one observation yields many answer rows |
| **Upstream dependencies** | none declared — the batch is in memory, not reread from silver |
| **Schedule / freshness** | with the poll, immediately after `case_version`'s own silver hop |
| **Owner / data steward** | *<team>* |
| **Source of truth doc** | `pipelines/sharepoint_cases/schema.py` |
| **Last reviewed** | 2026-08-14 |

### Part B — Field dictionary

| Field | Source path | Type | Nullable | Value rules | Description | Example | Sensitivity |
|-------|--------------|------|----------|-------------|-------------|---------|-------------|
| `case_type` | *(from `case_version`)* | `str` | No | `NonNull` | The settled Case Type — see *Why this table reads silver, not raw*. | `complaints` | None |
| `source_item_id` | *(from `case_version`)* | `str` | No | `NonNull` | The list item observed. | `101` | Internal |
| `source_modified_at` | *(from `case_version`)* | `datetime` | No | `NonNull` | When the observation was made. | `2026-08-05T08:10:00+00:00` | None |
| `source_version` | *(from `case_version`)* | `str` | No | `NonNull` | The version observed. | `"3"` | None |
| `source_observation_id` | *(from `case_version`)* | `str` | No | `NonNull` | The observation's identity. | *(64-char sha256)* | None |
| `pipeline_run_id` | *(stamped by the Writer)* | `str` | No | — | The run that wrote the row. Not declared by the schema — the Writer adds it after validation — so it appears in no schema and in no grain. | *(32-char hex)* | None |
| `question_id` | the `answers` map's key | `str` | No | `NonNull` | The Question Definition this row answers. No `Pattern`: a question id has no documented format, so a pattern would divert real answers into quarantine to guard a namespace nobody has proposed. | `q-root-cause` | None |
| `value_json` | `answers[question_id].value` | `str` | Yes | — | The value exactly as the source stored it — a scalar as itself, a list as JSON text. Not always parseable as a single JSON value; it is the lossless copy. | `["Process","Training"]` | Internal |
| `value_text` | *(derived)* | `str` | Yes | — | The canonical, groupable rendering of `value_json`: a multi-select's elements joined on `\|`; anything else stringified. Not display copy — see `derive_value_text`. | `Process\|Training` | Internal |
| `justification` | `answers[question_id].justification` | `str` | Yes | — | Free text. | | Internal |
| `remediation_required` | `answers[question_id].remediationRequired` | `str` | Yes | `OneOf(yes, no)` | Tri-state: `"yes"`, `"no"`, or the key **absent**, which means undecided and is distinct from `"no"`. A key is deleted, not nulled, when a reviewer changes their mind. | `yes` | None |
| `free_form_remediation` | `answers[question_id].freeFormRemediation` | `str` | Yes | — | Free text. | | Internal |
| `remediation_status` | `answers[question_id].remediationStatus.status` | `str` | Yes | `OneOf(complete, partial, cancelled)` | The full framework vocabulary is validated even where one Case Type's UI offers fewer — a narrower offer is display-only. | `partial` | None |
| `remediation_status_details` | `answers[question_id].remediationStatus.details` | `str` | Yes | — | Free text. | | Internal |

### Part C — Row checks

None.

### Part D — Quarantine & data quality

- `remediation_required` and `remediation_status` are the only value rules that
  can quarantine a row; the raw `answers` blob and the parent `case_version` row
  are kept either way.
- A malformed `answers` blob (text that is not JSON, or JSON that is not an
  object) is a feed defect, not a bad value: `ExplodeJsonMap` raises
  `JsonShapeError` and aborts the run before anything from that batch commits.
- A structural breach — a missing column, a wrong dtype, a null provenance
  column — still aborts the run.

## `answer_capture` — silver layer (Detail Table)

One row per observation × Question Definition × Issue Capture Field, exploded
from one answer's flat `capture` map — one level further down than `answer`
itself. Reaching it is two chained explodes: the first lands each answer's
`capture` object as JSON text (`ExplodeJsonMap`'s `value_into` mode, via
`_as_column_value`), the second reads that text straight back and explodes it
by field key. An absent or empty `capture` map contributes zero rows for that
answer, not an error.

**Issue Capture Groups appear nowhere in this table.** Knowing which group a
field belongs to needs the Case Type's own configuration, which this ingest
feed does not join — Groups are presentation-only.

### Part A — Table / Feed overview

| Attribute | Value |
|-----------|-------|
| **Table / Feed name** | `answer_capture` |
| **Subject / Case Type** | `sharepoint_cases` |
| **Medallion layer** | silver |
| **Grain** | one row per observation × Question Definition × Issue Capture Field |
| **Is this a Case Type?** | No — a Detail Table hanging off `case_version` |
| **Natural key → `case_id`** | `schema.NATURAL_KEY`, via `DETAIL_ID_VARS` — applied at gold, not here |
| **Source system** | the settled `case_version` batch just fetched (not the whole silver history) |
| **Reader** | `DatasetReader` over that batch |
| **Load strategy** | `AppendOnly(("source_observation_id", "question_id", "field_key"))` — composite, because one observation yields many capture rows |
| **Upstream dependencies** | none declared — the batch is in memory, not reread from silver |
| **Schedule / freshness** | with the poll, alongside the other Detail Tables |
| **Owner / data steward** | *<team>* |
| **Source of truth doc** | `pipelines/sharepoint_cases/schema.py` |
| **Last reviewed** | 2026-08-14 |

### Part B — Field dictionary

| Field | Source path | Type | Nullable | Value rules | Description | Example | Sensitivity |
|-------|--------------|------|----------|-------------|-------------|---------|-------------|
| `case_type` | *(from `case_version`)* | `str` | No | `NonNull` | The settled Case Type. | `complaints` | None |
| `source_item_id` | *(from `case_version`)* | `str` | No | `NonNull` | The list item observed. | `101` | Internal |
| `source_modified_at` | *(from `case_version`)* | `datetime` | No | `NonNull` | When the observation was made. | `2026-08-05T08:10:00+00:00` | None |
| `source_version` | *(from `case_version`)* | `str` | No | `NonNull` | The version observed. | `"3"` | None |
| `source_observation_id` | *(from `case_version`)* | `str` | No | `NonNull` | The observation's identity. | *(64-char sha256)* | None |
| `pipeline_run_id` | *(stamped by the Writer)* | `str` | No | — | The run that wrote the row. Not declared by the schema — the Writer adds it after validation — so it appears in no schema and in no grain. | *(32-char hex)* | None |
| `question_id` | the `answers` map's key | `str` | No | `NonNull` | The Question Definition this capture value belongs to. | `q-root-cause` | None |
| `field_key` | the `capture` map's key | `str` | No | `NonNull` | The Issue Capture Field key — unique within a Case Type by app contract, not enforced here. | `field-owner` | None |
| `value_kind` | *(derived)* | `str` | No | `NonNull`, `OneOf(text, person)` | Which arm the value discriminated to; see `discriminate_capture_value`. A legacy `Action[]` value, a half-filled person, or any other unrecognised shape is stamped `unsupported` and quarantines on this rule, rather than earning a label of its own. | `person` | None |
| `value_text` | the `capture` map's value | `str` | Yes | — | Filled for the `text` arm only. A `person`-typed field holding a bare string still lands here, as `text` — discrimination is on the value, never on a declared type this feed does not see, matching the review application's own reader. | `Called back within SLA.` | Internal |
| `person_login` | `capture[field_key].loginName` | `str` | Yes | — | Filled for the `person` arm only. A **bare account** (`user-rp`), not the claims login `case_version`'s Person columns hold — the two vocabularies do not join. | `user-rp` | PII |
| `person_display` | `capture[field_key].displayName` | `str` | Yes | — | Filled for the `person` arm only. Cached at selection time; not looked up here. | `Bola Okafor` | PII |

### Part C — Row checks

None.

### Part D — Quarantine & data quality

- `value_kind` is the only value rule that can quarantine a row, and it is
  total: `discriminate_capture_value` always stamps one of `text`, `person` or
  `unsupported`, so every row reaches the rule with a non-null value to judge.
  The rejected row still carries `raw_value` (dropped only after quarantine),
  so the offending shape is diagnosable from the reject table alone.
- The legacy `Action[]` capture arm — a value shape no live Case Type writes —
  quarantines here rather than being modelled: it fails the `OneOf(text,
  person)` rule the same way a half-filled person object does.
- A malformed `answers` or `capture` blob (text that is not JSON, or JSON of
  the wrong shape) is a feed defect, not a bad value: the chained
  `ExplodeJsonMap` hops raise `JsonShapeError` and abort the run before
  anything from that batch commits.
- A structural breach — a missing column, a wrong dtype, a null provenance
  column — still aborts the run.

## `answer_action` — silver layer (Detail Table)

One row per observation × Question Definition × ticked Remediation Action,
exploded from one answer's `remediationActions` list — the feed's first Detail
Table exploded from a **list**, not a map key. `{id, text}` is the real
frontend contract for one action (a third `completed` field some docs describe
is stale there, not here).

Because the source is a list rather than a map key, `action_id` *can* repeat
within one answer: the review application's own selection UI forbids it, but
this feed has no way to enforce an application-level rule. A hand-edited
duplicate therefore **aborts** the run (`AppendOnly`'s conflict at silver, or
`UniqueValidator` at gold) rather than quarantining — a structural breach of
the declared grain, not an ordinary bad value.

### Part A — Table / Feed overview

| Attribute | Value |
|-----------|-------|
| **Table / Feed name** | `answer_action` |
| **Subject / Case Type** | `sharepoint_cases` |
| **Medallion layer** | silver |
| **Grain** | one row per observation × Question Definition × ticked Remediation Action |
| **Is this a Case Type?** | No — a Detail Table hanging off `case_version` |
| **Natural key → `case_id`** | `schema.NATURAL_KEY`, via `DETAIL_ID_VARS` — applied at gold, not here |
| **Source system** | the settled `case_version` batch just fetched (not the whole silver history) |
| **Reader** | `DatasetReader` over that batch |
| **Load strategy** | `AppendOnly(("source_observation_id", "question_id", "action_id"))` — composite, because one observation yields many action rows |
| **Upstream dependencies** | none declared — the batch is in memory, not reread from silver |
| **Schedule / freshness** | with the poll, alongside the other Detail Tables |
| **Owner / data steward** | *<team>* |
| **Source of truth doc** | `pipelines/sharepoint_cases/schema.py` |
| **Last reviewed** | 2026-08-14 |

### Part B — Field dictionary

| Field | Source path | Type | Nullable | Value rules | Description | Example | Sensitivity |
|-------|--------------|------|----------|-------------|-------------|---------|-------------|
| `case_type` | *(from `case_version`)* | `str` | No | `NonNull` | The settled Case Type. | `complaints` | None |
| `source_item_id` | *(from `case_version`)* | `str` | No | `NonNull` | The list item observed. | `101` | Internal |
| `source_modified_at` | *(from `case_version`)* | `datetime` | No | `NonNull` | When the observation was made. | `2026-08-05T08:10:00+00:00` | None |
| `source_version` | *(from `case_version`)* | `str` | No | `NonNull` | The version observed. | `"3"` | None |
| `source_observation_id` | *(from `case_version`)* | `str` | No | `NonNull` | The observation's identity. | *(64-char sha256)* | None |
| `pipeline_run_id` | *(stamped by the Writer)* | `str` | No | — | The run that wrote the row. Not declared by the schema — the Writer adds it after validation — so it appears in no schema and in no grain. | *(32-char hex)* | None |
| `question_id` | the `answers` map's key | `str` | No | `NonNull` | The Question Definition this action belongs to. | `q-root-cause` | None |
| `action_seq` | the `remediationActions` list's 0-based position | `int` | No | `NonNull` | Declared (not dropped) because `ExplodeJsonList`'s `ordinal_into` is mandatory, so the column exists either way, and only a declared column is typed. Descriptive only — `action_id` is the grain. | `0` | None |
| `action_id` | `remediationActions[].id` | `str` | No | `NonNull` | From the Remediation Action bank's own definitions. | `q-root-cause-ra-0` | None |
| `action_text` | `remediationActions[].text` | `str` | Yes | — | Denormalised from the bank at selection time — a **snapshot**. A later rename in the bank does not reach a row already written here. | `Retrain the branch team on call handling.` | Internal |

### Part C — Row checks

None.

### Part D — Quarantine & data quality

- No value rule can quarantine a row here: every declared field is either
  structural (`NonNull`) or unconstrained free text. A structural breach — a
  missing column, a wrong dtype, a null provenance column, or a duplicate
  `action_id` within one answer — aborts the run rather than quarantining.
- A malformed `answers` or `remediationActions` blob (text that is not JSON,
  or JSON of the wrong shape) is a feed defect, not a bad value:
  `ExplodeJsonMap`/`ExplodeJsonList` raise `JsonShapeError` and abort the run
  before anything from that batch commits.

## `general_answer` — silver layer (Detail Table)

**Why two tables tile one blob.** General Question answers live in the *same*
`answers` JSON map as real answers, under keys prefixed `general:` — but they
come from a shared catalogue rather than a Question Definition id, are plain
strings by app contract, are never outcome-driving, and never fail. `answer`
above excludes the `general:` prefix; this table includes it and strips it, so
the two tables partition one blob with no key landing in both and none lost.

One row per observation × General Question catalogue key, exploded from
`case_version`'s `answers` JSON map — from the other side of the same explode
`answer` reads. Reads the settled silver batch, never raw, for the same reason
`answer` does — see *Why this table reads silver, not raw* above.

### Part A — Table / Feed overview

| Attribute | Value |
|-----------|-------|
| **Table / Feed name** | `general_answer` |
| **Subject / Case Type** | `sharepoint_cases` |
| **Medallion layer** | silver |
| **Grain** | one row per observation × General Question catalogue key |
| **Is this a Case Type?** | No — a Detail Table hanging off `case_version` |
| **Natural key → `case_id`** | `schema.NATURAL_KEY`, via `DETAIL_ID_VARS` — applied at gold, not here |
| **Source system** | the settled `case_version` batch just fetched (not the whole silver history) |
| **Reader** | `DatasetReader` over that batch |
| **Load strategy** | `AppendOnly(("source_observation_id", "general_key"))` — composite, because one observation yields many general-answer rows |
| **Upstream dependencies** | none declared — the batch is in memory, not reread from silver |
| **Schedule / freshness** | with the poll, alongside the other Detail Tables |
| **Owner / data steward** | *<team>* |
| **Source of truth doc** | `pipelines/sharepoint_cases/schema.py` |
| **Last reviewed** | 2026-08-14 |

### Part B — Field dictionary

| Field | Source path | Type | Nullable | Value rules | Description | Example | Sensitivity |
|-------|--------------|------|----------|-------------|-------------|---------|-------------|
| `case_type` | *(from `case_version`)* | `str` | No | `NonNull` | The settled Case Type. | `complaints` | None |
| `source_item_id` | *(from `case_version`)* | `str` | No | `NonNull` | The list item observed. | `101` | Internal |
| `source_modified_at` | *(from `case_version`)* | `datetime` | No | `NonNull` | When the observation was made. | `2026-08-05T08:10:00+00:00` | None |
| `source_version` | *(from `case_version`)* | `str` | No | `NonNull` | The version observed. | `"3"` | None |
| `source_observation_id` | *(from `case_version`)* | `str` | No | `NonNull` | The observation's identity. | *(64-char sha256)* | None |
| `pipeline_run_id` | *(stamped by the Writer)* | `str` | No | — | The run that wrote the row. Not declared by the schema — the Writer adds it after validation — so it appears in no schema and in no grain. | *(32-char hex)* | None |
| `general_key` | the `answers` map's key, `general:` prefix stripped | `str` | No | `NonNull` | The General Question catalogue key. No `OneOf`/`Pattern` — rationale in `GeneralAnswerRow`'s docstring. | `complaint-channel` | None |
| `value_json` | `answers[key].value` | `str` | Yes | — | The value exactly as the source stored it — a scalar as itself, a list as JSON text. Carried even though the app contract says plain string: see *Part D*. | `"Phone"` | Internal |
| `value_text` | *(derived)* | `str` | Yes | — | The canonical, groupable rendering of `value_json` — reuses `derive_value_text` unchanged, giving `answer` and `general_answer` one identical value contract. | `Phone` | Internal |

### Part C — Row checks

None.

### Part D — Quarantine & data quality

- No value rule on this schema can quarantine a row today — see
  `silver_general_answer_builder`'s docstring for why the quarantine node
  stays wired anyway.
- A malformed `answers` blob (text that is not JSON, or JSON that is not an
  object) is a feed defect, not a bad value: `ExplodeJsonMap` raises
  `JsonShapeError` and aborts the run before anything from that batch commits.
- A structural breach — a missing column, a wrong dtype, a null provenance
  column — still aborts the run.
- The tiling asymmetry between this table's include filter and `answer`'s
  exclude filter is documented on `GeneralAnswerRow` and tested by
  `ExplodeJsonMap`'s own suite, not here.
- The `"general:"`-exactly key lands with `general_key == ""`, visible rather
  than quarantined — proven by the tiling test.

## `conversation_message` — silver layer (Detail Table)

One row per observation × Conversation message, exploded from
`case_version`'s `conversation` JSON **list** — the feed's first Detail Table
off a blob other than `answers`. The app writes no message id, no read state,
no thread or Appeal association, and no edit or delete path, so `seq`, the
blob's own 0-based ordinal, is the grain key rather than anything the message
carries. Reads the settled silver batch, never raw, for the same reason
`answer` does — see *Why this table reads silver, not raw* above.

### Part A — Table / Feed overview

| Attribute | Value |
|-----------|-------|
| **Table / Feed name** | `conversation_message` |
| **Subject / Case Type** | `sharepoint_cases` |
| **Medallion layer** | silver |
| **Grain** | one row per observation × Conversation message |
| **Is this a Case Type?** | No — a Detail Table hanging off `case_version` |
| **Natural key → `case_id`** | `schema.NATURAL_KEY`, via `DETAIL_ID_VARS` — applied at gold, not here |
| **Source system** | the settled `case_version` batch just fetched (not the whole silver history) |
| **Reader** | `DatasetReader` over that batch |
| **Load strategy** | `AppendOnly(("source_observation_id", "seq"))` — composite, because one observation yields many message rows |
| **Upstream dependencies** | none declared — the batch is in memory, not reread from silver |
| **Schedule / freshness** | with the poll, alongside the other Detail Tables |
| **Owner / data steward** | *<team>* |
| **Source of truth doc** | `pipelines/sharepoint_cases/schema.py` |
| **Last reviewed** | 2026-08-14 |

### Part B — Field dictionary

| Field | Source path | Type | Nullable | Value rules | Description | Example | Sensitivity |
|-------|--------------|------|----------|-------------|-------------|---------|-------------|
| `case_type` | *(from `case_version`)* | `str` | No | `NonNull` | The settled Case Type. | `complaints` | None |
| `source_item_id` | *(from `case_version`)* | `str` | No | `NonNull` | The list item observed. | `101` | Internal |
| `source_modified_at` | *(from `case_version`)* | `datetime` | No | `NonNull` | When the observation was made. | `2026-08-05T08:10:00+00:00` | None |
| `source_version` | *(from `case_version`)* | `str` | No | `NonNull` | The version observed. | `"3"` | None |
| `source_observation_id` | *(from `case_version`)* | `str` | No | `NonNull` | The observation's identity. | *(64-char sha256)* | None |
| `pipeline_run_id` | *(stamped by the Writer)* | `str` | No | — | The run that wrote the row. Not declared by the schema — the Writer adds it after validation — so it appears in no schema and in no grain. | *(32-char hex)* | None |
| `seq` | the `conversation` list's 0-based position | `int` | No | `NonNull` | The grain key — the app mints no message id. A durable *pointer* only while the Conversation stays append-only: a mid-list insert would renumber every later message silently. | `0` | None |
| `author_login` | `conversation[].author.loginName` | `str` | Yes | — | The bare account name the app stamped at post time — see *Bare account logins vs. claims logins*, below. | `a.khan` | Internal |
| `author_display_name` | `conversation[].author.displayName` | `str` | Yes | — | An **unrefreshed snapshot** of what the sender was called when they posted; never join it as a current name. | `Amira Khan` | Internal |
| `posted_at` | `conversation[].timestamp` | `str` | Yes | — | Kept as text on purpose — see *Blob timestamps stay text*, below. | `2026-08-04T16:02:00Z` | None |
| `body` | `conversation[].body` | `str` | Yes | — | Free text, unmoderated. | `Please confirm the call date.` | Internal |

### Part C — Row checks

None.

### Part D — Quarantine & data quality

- No value rule is declared on this schema, so nothing here quarantines; the
  quarantine node stays wired anyway, for the same reason
  `silver_general_answer_builder`'s does.
- A malformed `conversation` blob (text that is not JSON, or JSON that is not
  an array) is a feed defect, not a bad value: `ExplodeJsonList` raises
  `JsonShapeError` and aborts the run before anything from that batch commits.
- A structural breach — a missing column, a wrong dtype, a null provenance
  column — still aborts the run.

## `appeal` — silver layer (Detail Table)

One row per observation × Appeal, exploded from `case_version`'s `appeals`
JSON **list**, with the Appeal's 1:1 `resolution` object lifted onto the same
row via dotted paths — exactly as `answer` lifts `remediationStatus`. Unlike a
Conversation message, an Appeal *does* carry its own identity: `appeal_id`
(`appeal-${Date.now()}`, minted by the app) is the grain key, and `appeal_seq`
is descriptive only. Reads the settled silver batch, never raw — see *Why
this table reads silver, not raw* above.

### Part A — Table / Feed overview

| Attribute | Value |
|-----------|-------|
| **Table / Feed name** | `appeal` |
| **Subject / Case Type** | `sharepoint_cases` |
| **Medallion layer** | silver |
| **Grain** | one row per observation × Appeal |
| **Is this a Case Type?** | No — a Detail Table hanging off `case_version` |
| **Natural key → `case_id`** | `schema.NATURAL_KEY`, via `DETAIL_ID_VARS` — applied at gold, not here |
| **Source system** | the settled `case_version` batch just fetched (not the whole silver history) |
| **Reader** | `DatasetReader` over that batch |
| **Load strategy** | `AppendOnly(("source_observation_id", "appeal_id"))` — composite, because one observation yields many Appeal rows |
| **Upstream dependencies** | none declared — the batch is in memory, not reread from silver |
| **Schedule / freshness** | with the poll, alongside the other Detail Tables |
| **Owner / data steward** | *<team>* |
| **Source of truth doc** | `pipelines/sharepoint_cases/schema.py` |
| **Last reviewed** | 2026-08-14 |

### Part B — Field dictionary

| Field | Source path | Type | Nullable | Value rules | Description | Example | Sensitivity |
|-------|--------------|------|----------|-------------|-------------|---------|-------------|
| `case_type` | *(from `case_version`)* | `str` | No | `NonNull` | The settled Case Type. | `complaints` | None |
| `source_item_id` | *(from `case_version`)* | `str` | No | `NonNull` | The list item observed. | `101` | Internal |
| `source_modified_at` | *(from `case_version`)* | `datetime` | No | `NonNull` | When the observation was made. | `2026-08-05T08:10:00+00:00` | None |
| `source_version` | *(from `case_version`)* | `str` | No | `NonNull` | The version observed. | `"3"` | None |
| `source_observation_id` | *(from `case_version`)* | `str` | No | `NonNull` | The observation's identity. | *(64-char sha256)* | None |
| `pipeline_run_id` | *(stamped by the Writer)* | `str` | No | — | The run that wrote the row. Not declared by the schema — the Writer adds it after validation — so it appears in no schema and in no grain. | *(32-char hex)* | None |
| `appeal_id` | `appeals[].id` | `str` | No | `NonNull` | The grain key, minted by the app as `appeal-${Date.now()}`. No `Pattern`/`Unique` — see *Part D*. | `appeal-1754210400000` | None |
| `appeal_seq` | the `appeals` list's 0-based position | `int` | No | `NonNull` | Declared, not dropped, for the same reason `answer_action.action_seq` is — `ExplodeJsonList`'s ordinal is mandatory and typed either way. Descriptive only; `appeal_id` is the key. | `0` | None |
| `appellant` | `appeals[].appellant` | `str` | Yes | — | A bare account name — see *Bare account logins vs. claims logins*, below. | `e.novak` | Internal |
| `raised_at` | `appeals[].at` | `str` | Yes | — | Kept as text — see *Blob timestamps stay text*. | `2026-08-05T08:30:00Z` | None |
| `rationale` | `appeals[].rationale` | `str` | Yes | — | Free text. | | Internal |
| `state` | `appeals[].state` | `str` | Yes | `OneOf(raised, underReview, resolved)` | `underReview` is included although unwritten today — `openAppealOf` treats anything but `resolved` as open, so excluding it would quarantine real rows the moment that transition ships. | `raised` | None |
| `cited_question_ids_json` | `appeals[].citedAnswerKeys` | `str` | Yes | — | JSON array text of Question Definition ids, joining `answer.question_id` — never a joined string. **Null means the key was omitted**, which is what "no citations" looks like; the app never writes `[]`. | `["q-outcome","q-timeliness"]` | Internal |
| `resolution_verdict` | `appeals[].resolution.verdict` | `str` | Yes | `OneOf(agreed, rejected)` | Null while unresolved — see the `resolution_*` group note below. | `agreed` | None |
| `resolution_rationale` | `appeals[].resolution.rationale` | `str` | Yes | — | Free text. Null while unresolved. | | Internal |
| `resolution_resolver` | `appeals[].resolution.resolver` | `str` | Yes | — | A bare account name — see *Bare account logins vs. claims logins*, below. Null while unresolved. | `d.reid` | Internal |
| `resolution_at` | `appeals[].resolution.at` | `str` | Yes | — | Kept as text — see *Blob timestamps stay text*. Null while unresolved. | `2026-08-04T10:00:00Z` | None |

The four `resolution_*` columns are null **together**: the shared prefix says
so, rather than `resolver`/`resolved_at` sitting beside `raised_at` as if they
were its siblings. An unresolved Appeal carries nulls in all four rather than
being absent as a row.

### Part C — Row checks

None.

### Part D — Quarantine & data quality

- Only `state` and `resolution_verdict` carry a value rule (`OneOf`); every
  other column is free text and cannot quarantine a row.
- No `Pattern` on `appeal_id`: `appeal-${Date.now()}` is one function's
  implementation detail, nothing enforces it, and a hand-edited blob would
  quarantine a real Appeal for failing to look like one. No `Unique` either —
  that rule is per-column over a whole batch spanning many Cases, and grain
  uniqueness is `UniqueValidator`'s job at gold.
- `appeal_id` **can repeat** within one observation where a JSON map key
  cannot — this is the second Detail grain (after `answer_action.action_id`)
  drawn from a list rather than a map. The app's own UI forbids a duplicate,
  but this feed cannot enforce an application-level rule; a hand-edited
  duplicate therefore **aborts** the run (`AppendOnly`'s conflict at silver,
  or `UniqueValidator` at gold) rather than quarantining.
- A malformed `appeals` blob (text that is not JSON, or JSON that is not an
  array) is a feed defect, not a bad value: `ExplodeJsonList` raises
  `JsonShapeError` and aborts the run before anything from that batch commits.
- A structural breach — a missing column, a wrong dtype, a null provenance
  column, or an Appeal element that is not an object at all (every field
  lifts to `None`, so `appeal_id` lands null) — still aborts the run.

## `case_detail` — silver layer (Detail Table)

One row per observation × Case Details field, exploded from `case_version`'s
`details` JSON map — the smallest Detail Table this feed publishes, and the
last: with it, every nested structure on the Case row has a normalised home.
Reads the settled silver batch, never raw, for the same reason `answer`
does — see *Why this table reads silver, not raw* above.

### Why this blob has less contract behind it than the others

- **The review application never writes `Details`.** It is read-only in
  every role the app has, so the shape here comes from whatever creates the
  Case row outside the application — there is no writer contract to cite the
  way every other blob's section above cites one.
- **The frontend's parse fallback for `Details` is `undefined`**, so "absent"
  and "unparseable" are indistinguishable once a Case reaches the app.
  Silver `case_version.details` is therefore the *only* recoverable copy of a
  malformed blob.
- Keys come from the Case Type's `detailFields[].key`, declared in frontend
  config this ingest feed never joins. A key present in the blob but
  undeclared in that config renders nowhere in the app, yet lands here —
  deliberately not filtered.
- Values are whatever string the writer used and are **not normalised**: a
  date lands as `"2026-06-18"`, not an ISO `datetime`. Parsing it is a
  Reporting concern.

### Part A — Table / Feed overview

| Attribute | Value |
|-----------|-------|
| **Table / Feed name** | `case_detail` |
| **Subject / Case Type** | `sharepoint_cases` |
| **Medallion layer** | silver |
| **Grain** | one row per observation × Case Details field |
| **Is this a Case Type?** | No — a Detail Table hanging off `case_version` |
| **Natural key → `case_id`** | `schema.NATURAL_KEY`, via `DETAIL_ID_VARS` — applied at gold, not here |
| **Source system** | the settled `case_version` batch just fetched (not the whole silver history) |
| **Reader** | `DatasetReader` over that batch |
| **Load strategy** | `AppendOnly(("source_observation_id", "field_key"))` — composite, because one observation yields many field rows |
| **Upstream dependencies** | none declared — the batch is in memory, not reread from silver |
| **Schedule / freshness** | with the poll, alongside the other Detail Tables |
| **Owner / data steward** | *<team>* |
| **Source of truth doc** | `pipelines/sharepoint_cases/schema.py` |
| **Last reviewed** | 2026-08-14 |

### Part B — Field dictionary

| Field | Source path | Type | Nullable | Value rules | Description | Example | Sensitivity |
|-------|--------------|------|----------|-------------|-------------|---------|-------------|
| `case_type` | *(from `case_version`)* | `str` | No | `NonNull` | The settled Case Type. | `complaints` | None |
| `source_item_id` | *(from `case_version`)* | `str` | No | `NonNull` | The list item observed. | `101` | Internal |
| `source_modified_at` | *(from `case_version`)* | `datetime` | No | `NonNull` | When the observation was made. | `2026-08-05T08:10:00+00:00` | None |
| `source_version` | *(from `case_version`)* | `str` | No | `NonNull` | The version observed. | `"3"` | None |
| `source_observation_id` | *(from `case_version`)* | `str` | No | `NonNull` | The observation's identity. | *(64-char sha256)* | None |
| `pipeline_run_id` | *(stamped by the Writer)* | `str` | No | — | The run that wrote the row. Not declared by the schema — the Writer adds it after validation — so it appears in no schema and in no grain. | *(32-char hex)* | None |
| `field_key` | the `details` map's key | `str` | No | `NonNull` | The Case Details field key — declared per Case Type in frontend config this feed does not join; an undeclared key still lands. No `Pattern`/`Length` for the same reason `question_id` has none. | `complaintRef` | None |
| `value_text` | the `details` map's value, encoded by `encode_detail_value` | `str` | Yes | — | The value as the source wrote it — a JSON string lands as itself, any other JSON value (number, boolean) lands as its JSON encoding, so a boolean reads `true`, not the Python spelling `True`. Not normalised: a date is `"2026-06-18"`, not a `datetime`. | `CMP-000101` | Internal |

**No `value_json` twin.** Argued from the data, not from symmetry with
`answer`: `details` is a flat `key -> string` map, so for every value the app
contract admits, a `value_json` twin would be byte-identical to `value_text`
on every row. The only rows where the two could differ are contract breaches
(a non-string value), and the lossless copy of those already exists one table
over, in `case_version.details`.

### Part C — Row checks

None.

### Part D — Quarantine & data quality

- **No value rule on this schema can quarantine a row today.** `CaseDetailRow`
  declares `NonNull` on the five stamps and `field_key`, and nothing else —
  the field vocabulary lives in per-Case-Type config this pipeline cannot
  see, so a rule here would quarantine real data to guard a namespace nobody
  has proposed. `{"": "x"}` is legal JSON, so an empty-string `field_key` is
  possible, lands, and is not ruled against. The quarantine node stays wired
  anyway, for the same reason `silver_general_answer_builder`'s does.
- A malformed `details` blob (text that is not JSON, or JSON that is not an
  object) is a feed defect, not a bad value: `ExplodeJsonMap` raises
  `JsonShapeError` and aborts the run before anything from that batch
  commits.
- An off-contract **value** — `details` holding a JSON number, boolean or
  null where the app contract says a string — is not a value-rule breach
  either: there is no rule that expresses "must be text", and quarantining
  would make the field silently vanish from a Case that genuinely carries
  it, hiding the only evidence. It is instead **encoded to text** by
  `encode_detail_value` before coercion, so it always lands, faithfully.
  Losslessness is not sacrificed: silver `case_version.details` keeps the
  raw blob text regardless.
- A structural breach — a missing column, a wrong dtype, a null provenance
  column — still aborts the run.

## Two prose points shared between `conversation_message` and `appeal`

**Bare account logins vs. claims logins.** `conversation_message.author_login`,
`appeal.appellant` and `appeal.resolution_resolver` are bare account names
(`a.khan`) — what the app itself stamps — never the claims login
(`i:0#.w|CONTOSO\a.khan`) every `case_version` Person column holds. The two
vocabularies do not join: matching one against the other silently matches
nothing. This feed lands each verbatim rather than guessing at a farm's AD
domain, which is Case-Type-agnostic and has no business knowing it.

**Blob timestamps stay text on purpose.** `posted_at`, `raised_at` and
`resolution_at` are declared `str`, not `datetime`. `SchemaCoercion`'s
datetime coercion calls bare `pd.to_datetime` with no `format=`, which on
pandas 3.x infers one format from the first non-null value in the batch and
then requires every other value to match it exactly. Both spellings these
blobs carry are real — the app writes `.toISOString()` (`.mmmZ`), a
hand-edited row can write `Z` without milliseconds — and mixing them in one
batch raises and aborts the *whole poll*, intermittently, since which rows
share a batch depends on the `Modified` window. The rule: a typed column
stays typed; text inside a blob stays text. (`source_modified_at` stays
`datetime` because it comes from OData, is uniform, and is already typed
upstream — it is not one of these blob fields.)

## Gold — the current Case, its Detail Tables, and five aggregates

Silver accumulates *observations*; gold answers *what is true now*. Every
table is rebuilt whole with `Refresh()` on every poll from the entire silver
history, in
[`pipelines/sharepoint_cases/gold.py`](../pipelines/sharepoint_cases/gold.py).
They are published **before** the polling watermark is committed, so a failure
anywhere leaves the watermark where it was and the next run rebuilds
everything.

| Table | Declared grain | Measure |
|-------|----------------|---------|
| `case_current` | one row per `case_id` | the Case, as it currently stands |
| `answer` | `case_id` × `question_id` | the winning observation's answer rows |
| `answer_capture` | `case_id` × `question_id` × `field_key` | the winning observation's Issue Capture rows |
| `answer_action` | `case_id` × `question_id` × `action_id` | the winning observation's Remediation Action rows |
| `general_answer` | `case_id` × `general_key` | the winning observation's General Question answer rows |
| `conversation_message` | `case_id` × `seq` | the winning observation's Conversation messages |
| `appeal` | `case_id` × `appeal_id` | the winning observation's Appeals |
| `case_detail` | `case_id` × `field_key` | the winning observation's Case Details fields |
| `case_counts_current` | `assigned_reviewer_name` × `assigned_reviewer_manager_name` × `status` | `case_count` |
| `case_age_buckets_current` | `age_bucket` × `status` | `case_count` |
| `case_throughput_daily` | `terminal_date` × `terminal_status` | `case_count` |
| `answer_remediation_current` | `case_type` × `question_id` × `remediation_required` × `remediation_status` | `answer_count` |
| `appeal_outcomes_current` | `case_type` × `state` × `resolution_verdict` | `appeal_count` |

Only `case_current` carries a live grain gate (`UniqueValidator("case_id")`);
each Detail Table carries one too (e.g. `UniqueValidator(("case_id",
"question_id", "field_key"))` for `answer_capture`, via
`gold_detail_builder`'s generic `grain=`); the five aggregates get none,
because a uniqueness check below the group-by that produced the grain is
satisfied by construction. Their grain is declared here.

The first three aggregates reduce from `case_current`; the last two —
`answer_remediation_current` and `appeal_outcomes_current` — reduce from a
published gold Detail Table instead (`answer` and `appeal` respectively), per
`DETAIL_AGGREGATES` in `gold.py`. See their own sections below for why that
source and grain earn a table while three other candidates were refused —
also recorded in *What is deliberately not aggregated*, below.

Every gold table spans **every** declared Case list: a Reviewer holds Cases
across Case Types, so an aggregate computed per list would not add up.

### `answer`

| Attribute | Value |
|-----------|-------|
| **Grain** | `case_id` × `question_id` |
| **Load strategy** | `Refresh()` |
| **Source** | silver `answer`'s accumulated history, semi-joined to `case_current`'s winning `(case_id, source_observation_id)` pairs |
| **Columns** | every silver `answer` column, plus `case_id` and `as_of_utc` |

Reduced per [ADR-0015](adr/0015-detail-tables-reduce-to-the-parents-latest-observation.md):
the children of each Case's *winning* observation, and nothing else. A
question a reviewer removed between observations (unticking the last
Remediation Action, or setting Remediation Required back to undecided so the
key is dropped) is genuinely absent from the winning observation's map, and the
semi-join reads that absence correctly — a per-question reduce would instead
keep the deleted answer forever, because a deletion writes no row for a
key-based reduce to prefer over. `observations=DatasetReader(current)` reads
`case_current`'s already-materialised dataset rather than rereading gold, so a
dry run — where `Refresh()` wrote nothing — cannot hand the semi-join a stale
or missing table.

### `answer_capture`

| Attribute | Value |
|-----------|-------|
| **Grain** | `case_id` × `question_id` × `field_key` |
| **Load strategy** | `Refresh()` |
| **Source** | silver `answer_capture`'s accumulated history, semi-joined to `case_current`'s winning `(case_id, source_observation_id)` pairs |
| **Columns** | every silver `answer_capture` column, plus `case_id` and `as_of_utc` |

Reduced by the same `gold_detail_builder`, per the same rule as `answer`
above. The property worth calling out here specifically: the review
application deletes a question's whole `capture` map, not just individual
fields, the moment that question stops failing (`remediationRequired` moves
off `"yes"`). The semi-join reads that deletion correctly — a Case whose
failing answer was resolved between polls contributes no `answer_capture` rows
for it, even though silver still holds the earlier observation's rows forever.

### `answer_action`

| Attribute | Value |
|-----------|-------|
| **Grain** | `case_id` × `question_id` × `action_id` |
| **Load strategy** | `Refresh()` |
| **Source** | silver `answer_action`'s accumulated history, semi-joined to `case_current`'s winning `(case_id, source_observation_id)` pairs |
| **Columns** | every silver `answer_action` column, plus `case_id` and `as_of_utc` |

Reduced by the same `gold_detail_builder`, per the same rule as `answer`
above. Unticking the last Remediation Action on a question removes the whole
`remediationActions` list the same way resolving the question removes
`capture` — the semi-join drops those rows from gold rather than keeping a
stale action a per-child reduce would have no reason to prefer over.

### `general_answer`

| Attribute | Value |
|-----------|-------|
| **Grain** | `case_id` × `general_key` |
| **Load strategy** | `Refresh()` |
| **Source** | silver `general_answer`'s accumulated history, semi-joined to `case_current`'s winning `(case_id, source_observation_id)` pairs |
| **Columns** | every silver `general_answer` column, plus `case_id` and `as_of_utc` |

Reduced by the same `gold_detail_builder`, per the same rule as `answer`
above. A General Question answer a reviewer's app pruned between observations
(the question dropped from the Case Type's config) is genuinely absent from
the winning observation's map, and the semi-join reads that absence correctly.

### `conversation_message`

| Attribute | Value |
|-----------|-------|
| **Grain** | `case_id` × `seq` |
| **Load strategy** | `Refresh()` |
| **Source** | silver `conversation_message`'s accumulated history, semi-joined to `case_current`'s winning `(case_id, source_observation_id)` pairs |
| **Columns** | every silver `conversation_message` column, plus `case_id` and `as_of_utc` |

Reduced by the same `gold_detail_builder`, per the same rule as `answer`
above — the winning observation's full message list, and nothing carried over
from an earlier one. Because a Conversation only ever grows, this table's
semi-join has no deletion to read correctly the way the answer-derived tables
do; what it guarantees instead is that a Case whose thread grew *between*
observations shows only the latest observation's full list, not an
observation-spanning superset a per-message reduce would produce by never
knowing to stop.

### `appeal`

| Attribute | Value |
|-----------|-------|
| **Grain** | `case_id` × `appeal_id` |
| **Load strategy** | `Refresh()` |
| **Source** | silver `appeal`'s accumulated history, semi-joined to `case_current`'s winning `(case_id, source_observation_id)` pairs |
| **Columns** | every silver `appeal` column, plus `case_id` and `as_of_utc` |

Reduced by the same `gold_detail_builder`, per the same rule as `answer`
above. `appeals` is additive and its own elements are never deleted, but an
Appeal's row still changes shape in place — `raised` gains a full
`resolution` the moment Controls resolves it — so the semi-join is what
guarantees gold shows the *latest* state of each Appeal (one row, not two)
rather than whichever observation a naive per-`appeal_id` reduce happened to
prefer.

### `case_detail`

| Attribute | Value |
|-----------|-------|
| **Grain** | `case_id` × `field_key` |
| **Load strategy** | `Refresh()` |
| **Source** | silver `case_detail`'s accumulated history, semi-joined to `case_current`'s winning `(case_id, source_observation_id)` pairs |
| **Columns** | every silver `case_detail` column, plus `case_id` and `as_of_utc` |

Reduced by the same `gold_detail_builder`, per the same rule as `answer`
above. This grain is structurally guaranteed **twice over**, unlike every
other Detail Table's: a JSON object cannot repeat a key, so silver can never
carry two rows sharing one observation's `field_key`, and the semi-join keeps
exactly one observation per Case. `UniqueValidator((case_id, field_key))` here
is therefore a tripwire, the same role it plays below `case_current`'s own
reduction — kept for the case a future change gets it wrong, not because
today's data could trip it.

### `as_of_utc`, on every table

`as_of_utc` is the **candidate SharePoint window end** — the instant this run is
about to commit as its watermark — as ISO-8601 UTC text. Never `utcnow()`: a
re-drive of the same window must produce identical **data**. Where a *calendar
date* is derived from it (`terminal_date`, the age arithmetic) the instant is
converted to the **local** date first, per
[`tools/observability/timestamps.py`](../tools/observability/timestamps.py).

### `pipeline_run_id`, on every table

| Column | Type | Null? | Description |
|--------|------|-------|-------------|
| `pipeline_run_id` | text | No | The pipeline run that wrote the row. |

The reserved run-provenance column every table-backed Writer stamps
([ADR-0020](adr/0020-writer-stamped-run-provenance-column.md)). It is the
framework's, not the feed's: no gold builder declares it, and it is added after
validation, so it appears in no schema and in no grain.

Because every gold table is rebuilt whole with `Refresh()`, the value is
**uniform per table** — the run named on any row is the run that wrote all of
them. A re-drive of the same window therefore produces identical data with a
different `pipeline_run_id`: identical *data*, not identical bytes. Which
attempt produced a table is also answerable without reading it, from the run
registry — `python -m cli runs --table case_current`
([operator CLI](operator-cli.md)).

### `case_current`

| Attribute | Value |
|-----------|-------|
| **Grain** | one row per `case_id` |
| **Identity** | a `sha256` over `{namespace: "sharepoint_cases", natural_key: {case_type, source_item_id}}`, stamped by `DeriveKey` |
| **Load strategy** | `Refresh()` |
| **Source** | the whole `silver.case_version` history, across every declared list |
| **Columns** | every silver column, plus `case_id` and `as_of_utc` |

**Which version is current.** One stable sort on `case_id`,
`source_modified_at` (parsed UTC), the parsed source version's major then minor
part, and finally `source_observation_id`; then keep the last row per `case_id`.
`Modified` leads because it is the source's own idea of when the item changed. It
is not enough on its own: two versions can share a `Modified` to the second and
append-only silver keeps both, so the parsed version breaks that tie. The version
is **parsed, never compared as text** — `"10"` sorts before `"9"` lexically. All
three shapes the column really holds are handled: an ETag (`"3"`, `W/"3"`,
`"4,1"`), a dotted UI version (`3.0`, `512.0`), and — for a row that arrived with
no version at all — a sha256 digest, which is not a version and sorts below every
real one. Two *digest* rows at the same `Modified` are therefore separated only by
`source_observation_id`: deterministic, but arbitrary.

**The Case Type is inside the key.** Item id 101 exists in every list, so the
item id alone does not identify a Case across Case Types. The namespace is the
subject name, and the discriminator is `case_type` as *silver settles it* — the
declared slug, not the list's editable cell. The cost is stated plainly:
**renaming the subject re-keys history** ([ADR-0016](adr/0016-one-sync-subject-for-every-case-type.md)),
so the pending `cora_cases` rename needs the treatment a re-key always needs.

Two things to know about what this table holds:

- It republishes **every** silver column, including the `answers`,
  `conversation`, `appeals` and `details` JSON blobs, on every poll. A
  consumer has nowhere else to read them; the price is that `Refresh()`
  rewrites them each time. Every one of those blobs is now *also* normalised
  elsewhere: `answers` into the gold `answer`, `answer_capture`,
  `answer_action` and `general_answer` Detail Tables, `conversation` into
  `conversation_message`, `appeals` into `appeal`, and — with this slice —
  `details` into `case_detail`, joining the rest as normalised elsewhere.
  Dropping the raw blobs from `case_current` once every consumer has moved
  onto the Detail Tables is tracked in #656, not done here.
- **A Case deleted from the list stays here forever.** The poll asks for items
  modified in a window, and a deleted item is not returned by anything —
  deletion inference is out of scope for this feed. `case_current` is "every
  Case we have ever seen, at its latest observed version", which is the same
  thing only while nothing is deleted.

### `case_counts_current`

| Attribute | Value |
|-----------|-------|
| **Grain** | `assigned_reviewer_name` × `assigned_reviewer_manager_name` × `status` |
| **Columns** | `assigned_reviewer_name`, `assigned_reviewer_manager_name`, `status`, `case_count`, `as_of_utc` |

**The Assigned Reviewer leads**, because the question this table answers is who
is holding what. That reviewer's manager is kept on the same row rather than in
a table of its own: it is how the rows roll up, so a consumer wanting counts per
manager sums this table instead of reading a second one that could disagree with
it.

Both are **claims logins**, as silver holds them — not display names, and
*neither is a team*. There is no team column on the provisioned list; what the
review platform calls "my team" is exactly the set of Cases whose
`AssignedReviewerManagerId` is the signed-in user. Calling a dimension
`owning_team` would assert something that does not exist, and shortening the
manager to `reviewer_manager_name` would invent a synonym for a row that also
carries `responsible_party_manager_name`.

A Case with no Assigned Reviewer, or none recorded for that reviewer's manager,
is counted under the literal `(unassigned)` in that column. That is a
**reporting fill, never a source value**; it exists because a NULL group key is
a hole in the grain that a reader may silently drop, which would make the table
quietly fail to add up to the number of current Cases.

### `case_age_buckets_current`

| Attribute | Value |
|-----------|-------|
| **Grain** | `age_bucket` × `status` |
| **Columns** | `age_bucket`, `age_bucket_order`, `status`, `case_count`, `as_of_utc` |

Age is whole **calendar** days from `created` to `as_of`, both as local dates.
Not working days: `tools.calendar.WorkingDayCalendar` needs a seeded holiday set
and nothing here supplies one, so a working-day age would be a guess dressed as a
measure. Seed the calendar first if a consumer asks for it.

| `age_bucket` | `age_bucket_order` | Rule |
|--------------|--------------------|------|
| `0-7 days` | 0 | `0 <= age < 8` |
| `8-14 days` | 1 | `8 <= age < 15` |
| `15-30 days` | 2 | `15 <= age < 31` |
| `31-60 days` | 3 | `31 <= age < 61` |
| `61+ days` | 4 | `age >= 61` |
| `unknown` | 5 | `created` is null or unparseable, **or** the age is negative |

`age_bucket_order` travels with the label so a consumer sorts without parsing
`"15-30 days"`. A negative age is impossible while `created <= Modified < as_of`,
so if one appears it is corruption and is bucketed where someone will see it
rather than clamped to zero where nobody will. Every current Case lands in
exactly one bucket, so this table's total reconciles exactly with
`case_counts_current`'s. The reviewer dimensions are deliberately absent — they
are one join away in `case_current`.

### `case_throughput_daily`

| Attribute | Value |
|-----------|-------|
| **Grain** | `terminal_date` × `terminal_status` |
| **Columns** | `terminal_date`, `terminal_status`, `case_count`, `as_of_utc` |

Cases that **first entered** a terminal state (`Completed`, `Void`) on a local
calendar date. That event is derivable rather than reconstructed, because the
source writes it: in `platform_frontend/src/lib/case-machine.js`, `completedAt`
has exactly two writers and both refuse an already-terminal Case, no path moves a
Case back to `In-progress`, and `voidedAt` is the same shape. So there is one
transition into a terminal state per Case and its stamp is write-once. The count
is taken from the *current* row, one per Case, so overlapping re-reads cannot
inflate it.

Two caveats, both real:

- The invariant "terminal status implies a stamp" is **enforced nowhere**, and a
  list row is editable by hand in the SharePoint web UI. A terminal Case with no
  stamp is counted under the literal `(unstamped)` rather than dropped or given a
  NULL date, so the table still totals the number of Cases currently in a
  terminal status.
- It is the *source's* stamp under `Refresh()`. A hand-edited or backdated stamp
  therefore **changes a historical count on the next poll**. That is the honest
  reading of a source that owns the event; a frozen copy would report a number
  the source no longer agrees with.

### `answer_remediation_current`

| Attribute | Value |
|-----------|-------|
| **Grain** | `case_type` × `question_id` × `remediation_required` × `remediation_status` |
| **Source** | the published gold `answer` Detail Table, read from that hop's already-materialised dataset — not silver, and not a re-read of gold |
| **Columns** | `case_type`, `question_id`, `remediation_required`, `remediation_status`, `answer_count`, `as_of_utc` |

Counts the winning observation's answer rows (gold `answer`) by the
remediation decision recorded against each question and the status of that
remediation. `case_type` **leads the grain**, and this is a correctness
requirement rather than a convenience: `question_id`s are drawn from a
per-Case-Type question bank, so `q1` in two banks names two different
questions, and grouping without `case_type` would silently sum them as one.

**`answer_count` within one `(case_type, question_id)` group is a Case
count** — gold `answer` holds exactly one row per Case × question, per
ADR-0015. Summed *across* every `question_id`, though, it counts *answers*,
not Cases: a Case that answered three questions contributes three rows. The
identity that always holds is `sum(answer_count) == ` the row count of gold
`answer` — never the current Case count.

Two literal fills, not source values, for the same reason `case_counts`'s
`(unassigned)` is one — a NULL group key is a hole in the grain a reader may
silently drop:

- `remediation_required` is filled `(undecided)` where the source key is
  absent. This is **not a fill for missing data** — it is the tri-state's
  real third state (`AnswerRow.remediation_required`'s docstring), and it
  must stay distinguishable from a reviewer having explicitly chosen `"no"`.
- `remediation_status` is filled `(unresolved)` where absent — which covers
  both a question never marked for remediation at all, and one marked
  `remediation_required="yes"` with no status recorded yet (e.g. `"yes"`
  paired with a null status counts under `(unresolved)`, not dropped).

**Stated limitation.** This table cannot be filtered to open Cases. A gold
Detail row carries nothing from its parent beyond the two winner columns it
semi-joined on (`gold_detail_builder`'s semi-join is deliberately narrow — see
*Part B*'s `answer` field dictionary above); reading `case_current.status`
alongside it would need a two-input transform this feed has never needed. A
consumer wanting "open Cases with an undecided remediation" joins this table
to `case_current` itself.

### `appeal_outcomes_current`

| Attribute | Value |
|-----------|-------|
| **Grain** | `case_type` × `state` × `resolution_verdict` |
| **Source** | the published gold `appeal` Detail Table, read from that hop's already-materialised dataset — not silver, and not a re-read of gold |
| **Columns** | `case_type`, `state`, `resolution_verdict`, `appeal_count`, `as_of_utc` |

Counts the winning observation's Appeal rows (gold `appeal`) by lifecycle
state and resolution verdict. `case_type` leads the grain for the same
correctness reason it leads `answer_remediation_current`'s.

**`appeal_count` counts Appeals, not Cases** — a Case may raise several, so
this table does not answer "how many Cases have an open appeal". That
question is `case_current.has_open_appeal`, source-written, and is
deliberately not restated here. An Appeal that gains its `resolution` between
observations is counted **once**: gold `appeal`'s own semi-join has already
picked the winning observation's row for that `appeal_id` (see the `appeal`
section above), so this transform never sees both states of one Appeal.

Two literal fills, the same convention as `answer_remediation_current`'s:

- `state` is filled `(unstated)` where absent.
- `resolution_verdict` is filled `(unresolved)` where absent — **the same
  literal** `answer_remediation_current` uses for its own unresolved case,
  because both mean one thing: no resolution recorded.

`sum(appeal_count)` equals gold `appeal`'s own row count — every Appeal lands
in exactly one `(state, resolution_verdict)` group, dropped or fill, never
both.

**Stated limitation.** Carries the same `status`-filter limitation as
`answer_remediation_current` — see its own note above.

## What is deliberately not aggregated

Three of the issue's five proposed aggregates are refused here, deliberately,
rather than deferred quietly. Each earns its refusal on its own terms.

- **Answer outcomes** (`case_type` × `question_id` × `value_text`) — deferred
  to #383, not built against a stub. Without the Question Definition
  dimension, there is no wording, Question Group or Category to roll
  an answer's raw value up to, so the only available grouping is the stored
  `value_text` — and for a multi-select, `value_text` is the selected values
  *joined* on `|` (see `derive_value_text`), so grouping on it counts
  combinations of values, not the values themselves. A grain built on that
  would need re-doing the moment #383 lands, not extending.
- **Capture field values** (`case_type` × `field_key` × `value_text`) —
  refused outright. `field_key` cardinality is unbounded: a free-text Issue
  Capture field yields close to one distinct value per Case, so a grain on it
  is not an aggregate in any useful sense — it approaches the row count of
  `answer_capture` itself. The `person` arm has nowhere to go in a count at
  all — a login is an identity, not a measure. Its real home is the Reporting
  pipeline's per-Case-Type pivots, which can shape a typed, per-field view
  this Case-Type-agnostic ingest feed cannot.
- **Conversation latency** (`case_id`, or `case_type` × author side) —
  refused. `case_current.awaiting_responsible_party` and
  `case_current.awaiting_since` are already source-written and already answer
  the latency question directly, so an aggregate here would be a second,
  derived spelling of a fact the source already states. Splitting by author
  side would also need the bare-account-to-claims-login join
  `conversation_message.author_login` and `case_current`'s Person columns
  deliberately do not support (see *Bare account logins vs. claims logins*,
  above) — this feed refuses that join on principle, not for lack of time.
  #356, the in-app clock, is the related inverse and should be read before
  re-proposing this.
