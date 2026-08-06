# Data dictionary — `sharepoint_cases`

The filled-in entry for the `sharepoint_cases` feed, following
[`data-dictionary-template.md`](data-dictionary-template.md). Three tables, three
grains: the faithful raw observation, the typed Case version, and the party
bridge. The Python contract is
[`pipelines/sharepoint_cases/schema.py`](../pipelines/sharepoint_cases/schema.py);
this page is its prose companion.

> **The list shape here is an assumption.** The feed is written against an agreed
> shape for the *Cases* list — two date columns, a numeric `RiskScore`, a person
> column split into lookup id + display title, and one multi-value person column
> `Parties`. The `case_party_version` bridge is built on that assumed shape.
> Confirm the columns against the real list before the feed is pointed at a
> tenant; a column that turns out not to exist is a change to `SOURCE_COLUMNS`,
> `RAW_FEED_COLUMNS` and `RENAME` in `pipeline.py`, and a row here.

## Where "when we saw it" lives

None of the three tables carries an observation timestamp, an ingestion batch id,
or a pipeline run id as a **column**, and that is deliberate. The load strategy is
`AppendOnly`, which compares every non-key column of a re-presented row against
the row already stored; a per-read stamp would differ on every overlapping poll
and turn each ordinary re-read into an append-only conflict. The rows record
*what the list said*, and only that.

When we saw it is recorded elsewhere, and is still recoverable:

- the **run log** (`<base>/_runs/sharepoint_cases.log`) timestamps every step,
  and its `data_locations` name the list and the three tables;
- the **ingestion batch id** returned on `SharePointIngestResult` identifies the
  source window the poll resumed from (`<list GUID>:<watermark|first-load>`), and
  is what a later checkpoint commit records as its provenance.

The Reader's `observed_at` stamp is an injectable callable and is dropped at the
storable-observation boundary for the same reason.

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
| **Source system** | SharePoint list *Cases* at `https://contoso.sharepoint.com/sites/case-review` (list GUID `1b6f2a3c-0000-4a1f-9c7e-5f2d8a4b1e01`) |
| **Reader** | `SharePointModifiedReader`, behind the feed's `StorableObservations` projection |
| **Load strategy** | `AppendOnly("source_observation_id")` |
| **Upstream dependencies** | none — source feed |
| **Schedule / freshness** | polled; window `end = server_now - 30s`, `start = watermark - 5m` |
| **Owner / data steward** | *<team>* |
| **Source of truth doc** | the list's own settings page |
| **Last reviewed** | 2026-08-06 |

### Part B — Field dictionary

| Field | Source column | Type | Nullable | Value rules | Description | Example | Sensitivity | Notes |
|-------|---------------|------|----------|-------------|-------------|---------|-------------|-------|
| `CaseRef` | `CaseRef` | text | No | — | The Case's reference on the list. | `C000101` | Internal | Renamed to `case_ref` at silver. |
| `Status` | `Status` | text | No | — | The Case's lifecycle state. | `Open` | None | A sixth value would be a source change; quarantine is where it surfaces. |
| `OpenedOn` | `OpenedOn` | text | No | — | When the Case was opened. | `2026-07-01T00:00:00Z` | None | Text at raw; coerced at silver. |
| `TargetCloseOn` | `TargetCloseOn` | text | Yes | — | The target close date, where one is set. | `2026-08-01T00:00:00Z` | None | Null is meaningful (no target set). |
| `RiskScore` | `RiskScore` | number | No | — | The Case's risk score out of 100. | `42` | None | Range-checked at silver, not here. |
| `OwnerId` | `OwnerId` | number | No | — | The owning user's SharePoint lookup id. | `17` | Internal | The identity; the title is not. |
| `Owner/Title` | `Owner/Title` (expanded) | text | Yes | — | The owning user's display name. | `A. Khan` | PII | Added by `$expand`, not projected by name — absent from a quiet window's response. |
| `PartiesId` | `PartiesId` | text (JSON) | No | — | The parties' lookup ids, as a JSON array. | `[17,23]` | Internal | Encoded to compact JSON so a list cell can be stored; `[]` when there are none. |
| `Parties/Title` | `Parties/Title` (expanded) | text (JSON) | No | — | The parties' display names, as a JSON array. | `["A. Khan","B. Okafor"]` | PII | Pairs with `PartiesId` **by position**. |
| `source_list_name` | *(stamped)* | text | No | — | The list the observation came from. | `Cases` | None | Stamped by the Reader. |
| `source_item_id` | *(stamped, from `Id`)* | text | No | — | The list item's id. | `101` | Internal | Replaces `Id`, which is not stored. |
| `source_modified_at` | *(stamped, from `Modified`)* | text | No | — | The item's `Modified`, in UTC. | `2026-08-05T08:10:00+00:00` | None | Replaces `Modified`, which is not stored. |
| `source_version` | *(stamped, from `odata.etag`)* | text | No | — | The version observed. | `3` | None | Falls back to a digest of the item's projected values where the list supplies no stamp. |
| `source_observation_id` | *(stamped)* | text | No | — | The identity of "this item, at this version, in this list" — the append-only key. | *(64-char sha256)* | None | Replaces `odata.etag`, which is not stored. |

### Part C — Row checks

None. Raw is a faithful mirror; the only check is structural (the column gate).

### Part D — Quarantine & data quality

- Raw does not quarantine: a value-rule breach is silver's business, so a row
  with a bad `RiskScore` **is** here even though it never reaches `case_version`.
- The Reader cannot see a hard delete: an item removed from the list has no
  `Modified` and so appears in no window. Reconciliation is a separate mechanism.

---

## `case_version` — silver layer

One row per observed Case version, typed and canonicalised. The change-over-time
record: a later `Modified` on the same item is a **new row**, never an update.

### Part A — Table / Feed overview

| Attribute | Value |
|-----------|-------|
| **Table / Feed name** | `case_version` |
| **Subject / Case Type** | `sharepoint_cases` |
| **Medallion layer** | silver |
| **Grain** | one row per observation of a Case |
| **Is this a Case Type?** | Not yet — the gold assembly is an open decision |
| **Natural key → `case_id`** | n/a until gold; `case_ref` is the candidate |
| **Source system** | `raw.case_observation` (the batch just fetched, not the whole history) |
| **Reader** | `DatasetReader` over the fetched batch |
| **Load strategy** | `AppendOnly("source_observation_id")` |
| **Upstream dependencies** | `raw.case_observation` |
| **Schedule / freshness** | with the poll |
| **Owner / data steward** | *<team>* |
| **Source of truth doc** | `pipelines/sharepoint_cases/schema.py` |
| **Last reviewed** | 2026-08-06 |

### Part B — Field dictionary

| Field | Source column | Type | Nullable | Value rules | Description | Example | Sensitivity | Notes |
|-------|---------------|------|----------|-------------|-------------|---------|-------------|-------|
| `source_observation_id` | `source_observation_id` | `str` | No | `Length(64, 64)` | The observation's identity, and the append-only key. | *(64-char sha256)* | None | Fixed length because it is a sha256 digest. |
| `source_list_name` | `source_list_name` | `str` | No | — | The list observed. | `Cases` | None | |
| `source_item_id` | `source_item_id` | `str` | No | — | The list item observed. | `101` | Internal | Stable across versions of the same Case. |
| `source_version` | `source_version` | `str` | No | — | The version observed. | `3` | None | |
| `source_modified_at` | `source_modified_at` | `datetime` | No | — | When the source last changed the item. | `2026-08-05T08:10:00+00:00` | None | Orders the versions of one item. |
| `case_ref` | `CaseRef` | `str` | No | `Pattern(^C\d{6}$)` | The Case's reference. | `C000101` | Internal | Not unique here — one Case has many versions. |
| `status` | `Status` | `str` | No | `OneOf(Open, With Adviser, Awaiting Evidence, Closed, Void)` | The Case's lifecycle state at this version. | `Open` | None | A new source value quarantines the row rather than reaching a report. |
| `opened_on` | `OpenedOn` | `date` | No | — | When the Case was opened. | `2026-07-01` | None | |
| `target_close_on` | `TargetCloseOn` | `date` | Yes | — | The target close date. | `2026-08-01` | None | Null is meaningful (no target set). |
| `risk_score` | `RiskScore` | `int` | No | `Range(0, 100)` | The Case's risk score. | `42` | None | The usual quarantine trigger. Non-null in practice: a nullable int round-trips as a float and fails the dtype gate. |
| `owner_user_id` | `OwnerId` | `int` | No | `Range(min 1)` | The owning user — **the identity**. | `17` | Internal | A lookup id, not a name; joins to the people reference data. |
| `owner_display_name` | `Owner/Title` | `str` | Yes | — | The owning user's display name. | `A. Khan` | PII | Display only. Never identity: a title is a mutable display name. |

### Part C — Row checks

None declared. `opened_on <= target_close_on` is a candidate once the real list's
data quality is known.

### Part D — Quarantine & data quality

- Value-rule breaches (`risk_score` out of `[0, 100]`, an unknown `status`, a
  `case_ref` that does not match the pattern) are partitioned to
  `<base>/sharepoint_cases/quarantine.db`, table `case_version`, with
  `failed_rule` set. The raw observation is kept either way, so nothing is
  silently discarded.
- A structural breach (a missing column, a wrong dtype) still aborts the run.

---

## `case_party_version` — silver layer

The bridge for the list's one multi-value person column, at its own grain: one
row per observation × party. It is a **pure function of the raw observation** —
it holds no foreign key into `case_version`, so a Case row quarantined for an
unrelated value rule does not take its parties with it.

### Part A — Table / Feed overview

| Attribute | Value |
|-----------|-------|
| **Table / Feed name** | `case_party_version` |
| **Subject / Case Type** | `sharepoint_cases` |
| **Medallion layer** | silver |
| **Grain** | one row per observation × party |
| **Is this a Case Type?** | No — a Detail Table for the Case observation |
| **Natural key → `case_id`** | n/a until gold |
| **Source system** | `raw.case_observation` (the batch just fetched) |
| **Reader** | `DatasetReader` over the fetched batch |
| **Load strategy** | `AppendOnly(("source_observation_id", "party_position"))` |
| **Upstream dependencies** | `raw.case_observation` |
| **Schedule / freshness** | with the poll |
| **Owner / data steward** | *<team>* |
| **Source of truth doc** | `pipelines/sharepoint_cases/schema.py` |
| **Last reviewed** | 2026-08-06 |

### Part B — Field dictionary

| Field | Source column | Type | Nullable | Value rules | Description | Example | Sensitivity | Notes |
|-------|---------------|------|----------|-------------|-------------|---------|-------------|-------|
| `source_observation_id` | `source_observation_id` | `str` | No | — | The observation these parties were named on. | *(64-char sha256)* | None | Half the append-only key. |
| `source_item_id` | `source_item_id` | `str` | No | — | The list item observed. | `101` | Internal | Provenance survives every hop. |
| `source_modified_at` | `source_modified_at` | `datetime` | No | — | When the source last changed the item. | `2026-08-05T08:10:00+00:00` | None | |
| `party_user_id` | `PartiesId[n]` | `int` | No | `Range(min 1)` | The party — **the identity**. | `23` | Internal | A lookup id, not a name. |
| `party_display_name` | `Parties/Title[n]` | `str` | Yes | — | The party's display name. | `B. Okafor` | PII | Display only. |
| `party_position` | *(the index n)* | `int` | No | `Range(min 0)` | The party's position in the source's multi-value cell. | `0` | None | The other half of the key: the same person may legitimately appear twice in one cell, and keying on the person would read that as a contradiction. |

### Part C — Row checks

None.

### Part D — Quarantine & data quality

- No quarantine writer: the bridge's rows are derived, not sourced, so a breach
  here is a bug in the fan-out rather than bad source data, and aborting says so.
- The two halves of the source field pair **by position**. Lists whose lengths
  disagree raise a `SharePointFeedError` naming the list, the item and both
  lengths, rather than guessing at the pairing.
- An empty `PartiesId` yields no rows at all — an observation with no parties is
  absent from this table, not present with nulls.
