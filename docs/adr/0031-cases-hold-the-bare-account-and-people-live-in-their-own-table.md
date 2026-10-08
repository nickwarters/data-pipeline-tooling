---
status: accepted
---

# Cases hold the bare account; what is known about a person lives in its own table

**Every person column on a `sharepoint_cases` Case row holds the lower-cased
bare account** (`a.khan`), reduced in silver from the claims login the list
gives (`i:0#.w|CONTOSO\A.Khan`) with `shared.account_names.to_bare_account`.
Raw keeps the login. **Everything else about a person** — their domain, display
name and email — lives in one silver `person` table: user details only, one
row per bare account, which each poll merges the people it saw into and
upserts on `account`.

Existing rows are brought into line by migration: the silver and gold `0003`
migrations reduce each stored `…_name` value in SQL with the same rule, so a
Case polled before the change and one polled after spell a person alike.

## Why

- **One spelling joins everything.** The platform stamps the bare account into
  every JSON blob (Conversation authors, Appeals, amendments, captured people),
  the Staff Hierarchy keys on it, and the frontend works in it. The Case row
  was the one place holding the claims login, so every consumer that matched a
  Case's people against anything else reduced it on its own side, and the data
  dictionary had to warn that the two "do not join". Reducing once, in silver,
  removes that rule rather than documenting it.
- **Details per person, not per role per Case.** Carrying a domain, display
  name and email beside each of five Person columns would have meant fifteen
  more columns on the Case row, each a snapshot of something about a person
  rather than about the Case, repeated on every Case they touch. One row per
  person states each fact once.
- **User details only, merged before the upsert.** The table holds nothing
  about the Cases that named a person. An upsert replaces the whole row, so
  each poll first merges its people into the rows already held — each detail
  the latest value any sighting gave, ordered by when it was seen — and only
  then upserts. Otherwise the next sighting with no email (a Conversation
  author carries none) would blank it, and a late-polled old version would
  overwrite a newer one.
- **Read from raw.** Sightings come from the raw batch, because by the time the
  Case row is settled its Person columns are reduced and their details gone.

## Consequences

- The table is named `person`, not "users": the `users` reference feed
  (`readers/users.py`) is a different table with a different source.
- There is no per-sighting history, so which Case named a person, and when a
  detail changed, are not answerable from it. Raw keeps every login, title
  and email if that is ever needed.
- `responsible_party_title` stays on the Case row because views already read
  it; every person's display name, that one's included, is also in the
  `person` table.
- A bare account is assumed unique across domains, as the platform already
  assumes ([platform ADR-0013](../../platform_frontend/docs/adr/0013-attributed-party-identity-in-answer-json.md)).
  A person seen in two domains is one row holding the domain seen last.
- Consumers that still reduce through `to_bare_account` keep working: it leaves
  a bare account unchanged.
- The aggregates keyed on `assigned_reviewer_name` hold claims logins until the
  next publish rebuilds them from the migrated `case_current`.

## Considered

- **A per-observation sighting log reduced to a gold table** — the first
  version of this decision. Rejected in review: it carried Case-level detail
  the table has no use for.
- **Add a domain column beside each Person column** — an earlier version of
  this change. Rejected for the reasons above: it multiplies per-person facts
  across Case rows and still leaves the claims login on the row.
- **Keep the claims login on the Case row and add a bare-account column** —
  rejected: two spellings of one person on one row is exactly the ambiguity
  this removes.
