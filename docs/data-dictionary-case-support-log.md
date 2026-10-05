# Data dictionary — `case_support_log`

The **Support Log** is the Case Review Platform's append-only record of every
action a Maintainer takes on a Case from the Case Support page
([`platform_frontend/CONTEXT.md`](../platform_frontend/CONTEXT.md), *Support
Log*). The platform writes one item per action to a per-environment
`CaseSupportLog` SharePoint list; this feed polls that list and lands it raw →
silver. There is no gold yet: no consumer has asked a question of it.

Three things to know:

- **Entries are never edited.** Maintainers can add to the list but not edit or
  delete, so polling the `Modified` window is in effect polling `Created`: each
  entry arrives in exactly one window, and the overlap between windows re-reads
  it as a no-op.
- **An action that failed is two entries, not one.** The platform writes the
  entry *before* it changes the Case. If the Case write then fails, it appends a
  second entry with `outcome = not-applied` whose `relates_to` names the first.
  A count of actions that took effect is therefore the `recorded` entries minus
  those a `not-applied` entry relates to.
- **The site and list GUID are placeholders.** `SITE` and `LIST_ID` in
  `pipelines/case_support_log/schema.py` must come from the tenant, and the
  organisational client is not wired, exactly as for `sharepoint_cases`
  ([`sharepoint-cases-going-live.md`](sharepoint-cases-going-live.md)).

## `support_log_entry` — raw layer

One row per observation of one list item, in the list's own column names
(`Id`, `Title`, `CaseType`, `CaseId`, `SupportAction`, `Reason`, `Changes`,
`Outcome`, `RelatesTo`, `Created`, `Author/Name`, `Author/Title`) plus the
reader's provenance columns. Keyed append-only on `source_observation_id`, so a
re-read is a no-op.

## `support_log_entry` — silver layer

| Attribute | Value |
|-----------|-------|
| **Subject** | `case_support_log` |
| **Grain** | one row per Support Log entry observation; since entries are never edited, in practice one row per entry |
| **Is this a Case Type?** | No — an audit record about Cases |
| **Source system** | the `CaseSupportLog` SharePoint list (`uat_CaseSupportLog` in UAT) |
| **Reader** | `SharePointModifiedReader`, `Author` expanded |
| **Load strategy** | `AppendOnly("source_observation_id")`, raw and silver |
| **Upstream dependencies** | none — source feed |
| **Schedule** | daily, in the `case_management` set |

| Field | Source column | Type | Nullable | Value rules | Description |
|-------|---------------|------|----------|-------------|-------------|
| `source_observation_id` | — | str | No | | Identity of this observation of this item. |
| `source_list_name` | — | str | No | | The list polled. |
| `source_item_id` | — | str | No | | The list item id. |
| `source_version` | — | str | No | | The item's version as SharePoint reported it. |
| `source_modified_at` | — | datetime | No | | When SharePoint last modified the item. |
| `id` | `Id` | int | No | | The entry's id; what `relates_to` names. |
| `case_reference` | `Title` | str | No | | The Case Reference the action was taken on. |
| `case_type` | `CaseType` | str | No | | The Case Type slug. |
| `case_id` | `CaseId` | str | No | | The Case's item id in its Case Type's list; with `case_type`, joins to `sharepoint_cases` as `source_item_id`. |
| `support_action` | `SupportAction` | str | No | | The action's id, e.g. `reassign`, `unassign`, `flags`. Not constrained: the platform adds actions over time. |
| `reason` | `Reason` | str | No | | The Maintainer's reason, required by the page. |
| `changes` | `Changes` | str | Yes | | JSON list of `{field, before, after}`; values are as the Case row held them. Kept as text. |
| `outcome` | `Outcome` | str | No | `OneOf("recorded", "not-applied")` | Whether this entry records the action or its failure. Anything else is quarantined. |
| `relates_to` | `RelatesTo` | str | Yes | | On a `not-applied` entry, the `id` of the entry it follows; null otherwise (the platform writes an empty string). |
| `created` | `Created` | datetime | No | | When the entry was written, stamped by SharePoint. |
| `author_name` | `Author/Name` | str | Yes | | Who wrote it, as a claims login. **PII.** |
| `author_title` | `Author/Title` | str | Yes | | Who wrote it, as a display name; for reading, not for matching. **PII.** |

A row that breaks a rule is written to `quarantine.db`'s `support_log_entry`
with the rule it failed, and the rest of the batch still lands.
