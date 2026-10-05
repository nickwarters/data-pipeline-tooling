# Data dictionary — `cora_access_log`

The **Access Log** is the Case Review Platform's append-only record of every
change a Maintainer makes to a person's internal CORA roles from the Access page
([`platform_frontend/CONTEXT.md`](../platform_frontend/CONTEXT.md), *Access
Log*). The platform writes one item per change to a single site-wide
`CoraAccessLog` SharePoint list; this feed polls that list and lands it raw →
silver. There is no gold yet: no consumer has asked a question of it.

Four things to know:

- **There is one list, not one per environment.** The CORA groups the page
  changes are shared by prod, UAT and training, so the log is deliberately not
  `<env>_` prefixed and every environment's Access page writes to it. One
  `cora_access_log` feed therefore covers every environment's changes, and an
  entry cannot be told apart by the environment it was made from.
- **Entries are never edited.** Maintainers can add to the list but not edit or
  delete, so polling the `Modified` window is in effect polling `Created`: each
  entry arrives in exactly one window, and the overlap between windows re-reads
  it as a no-op.
- **A change that did not finish is two entries, not one.** The platform writes
  the entry *before* it changes any group. If a group write then fails it
  appends a second entry whose `outcome` is `not-applied` (nothing was changed)
  or `partly-applied` (some groups were), and whose `relates_to` names the
  first. The follow-up's `reason` is the platform's own message naming the group
  that failed, not the Maintainer's, and its `changes` lists only the groups that
  did change (none for `not-applied`). The access that actually took effect is
  the `recorded` entries minus those a `not-applied` entry relates to, and for a
  `partly-applied` one the first entry's `changes` over-states what happened.
- **It holds personal data.** `target_login`, `target_name`, `author_name` and
  `author_title` identify people, and `reason` is free text a Maintainer typed,
  which can say anything about why someone needed access. Treat the raw and
  silver tables as personal data wherever they are copied. `changes` names SharePoint
  groups, not people.

The site and list GUID are placeholders. `SITE` and `LIST_ID` in
`pipelines/cora_access_log/schema.py` must come from the tenant, and the
organisational client is not wired, exactly as for `sharepoint_cases`
([`sharepoint-cases-going-live.md`](sharepoint-cases-going-live.md)).

This feed carries the Access page's role changes only. It does not overlap with
the notifications pipeline's frontline privileges Deliverable, which is a
separate record this page neither writes nor reads.

## `access_log_entry` — raw layer

One row per observation of one list item, in the list's own column names
(`Id`, `Title`, `TargetName`, `AccessAction`, `AccessRole`, `CaseType`,
`Reason`, `Changes`, `Outcome`, `RelatesTo`, `Created`, `Author/Name`,
`Author/Title`) plus the reader's provenance columns. Keyed append-only on
`source_observation_id`, so a re-read is a no-op.

## `access_log_entry` — silver layer

| Attribute | Value |
|-----------|-------|
| **Subject** | `cora_access_log` |
| **Grain** | one row per Access Log entry observation; since entries are never edited, in practice one row per entry |
| **Is this a Case Type?** | No — an audit record about people's access |
| **Source system** | the `CoraAccessLog` SharePoint list (one list, shared by every environment) |
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
| `target_login` | `Title` | str | No | | The claims login of the person whose access changed; the identity to match on. **PII.** |
| `target_name` | `TargetName` | str | Yes | | Their display name when the change was made; for reading, not for matching. **PII.** |
| `access_action` | `AccessAction` | str | No | `OneOf("grant", "revoke")` | What the change did. Anything else is quarantined. |
| `access_role` | `AccessRole` | str | No | | The role's id, e.g. `reviewer`, `reviewer-manager`, `controls`, `case-type-owner`, `journey-owner`. Not constrained: the platform adds roles over time. |
| `case_type` | `CaseType` | str | Yes | | The Case Type slug for a per-Case-Type role; null for a site-wide one (the platform writes an empty string). |
| `reason` | `Reason` | str | No | | The Maintainer's reason, required by the page; on a `not-applied` or `partly-applied` entry, the platform's message naming the group that failed. Free text. **PII risk.** |
| `changes` | `Changes` | str | Yes | | JSON list of `{field, before, after}`, one per SharePoint group, where `field` is the group's name and `before`/`after` say whether the person was a member. Kept as text. |
| `outcome` | `Outcome` | str | No | `OneOf("recorded", "not-applied", "partly-applied")` | Whether this entry records the change or how it fell short. Anything else is quarantined. |
| `relates_to` | `RelatesTo` | str | Yes | | On a `not-applied` or `partly-applied` entry, the `id` of the entry it follows; null otherwise (the platform writes an empty string). |
| `created` | `Created` | datetime | No | | When the entry was written, stamped by SharePoint. |
| `author_name` | `Author/Name` | str | Yes | | Which Maintainer made the change, as a claims login. **PII.** |
| `author_title` | `Author/Title` | str | Yes | | Which Maintainer, as a display name; for reading, not for matching. **PII.** |

A row that breaks a rule is written to `quarantine.db`'s `access_log_entry`
with the rule it failed, and the rest of the batch still lands.
