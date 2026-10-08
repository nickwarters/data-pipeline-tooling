---
status: accepted
---

# Cases hold the bare account; what is known about a person lives in its own table

**Every person column on a `sharepoint_cases` Case row holds the lower-cased
bare account** (`a.khan`), reduced in silver from the claims login the list
gives (`i:0#.w|CONTOSO\A.Khan`) with `shared.account_names.to_bare_account`.
Raw keeps the login. **Everything else about a person** — their domain, display
name and email — is recorded once per observation in silver `person_sighting`
and reduced to gold `person_current`, one row per bare account.

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
- **Rebuilt from history, not upserted.** `person_current` is a `Refresh()`
  over every sighting, each detail taking the latest value any sighting gave,
  ordered by `source_modified_at`. An upsert replaces the whole row, so the
  next sighting that carried no email (a Conversation author carries none)
  would blank it, and a late-polled old version would overwrite a newer one.
- **Read from raw.** Sightings come from the raw batch, because by the time the
  Case row is settled its Person columns are reduced and their details gone.

## Consequences

- `person_current` is named for this feed's people, not "users": the `users`
  reference feed (`readers/users.py`) is a different table with a different
  source.
- `responsible_party_title` stays on the Case row because views already read
  it; every person's display name, that one's included, is also in
  `person_current`.
- A bare account is assumed unique across domains, as the platform already
  assumes ([platform ADR-0013](../../platform_frontend/docs/adr/0013-attributed-party-identity-in-answer-json.md)).
  A person seen in two domains is one row holding the domain seen last.
- Consumers that still reduce through `to_bare_account` keep working: it leaves
  a bare account unchanged.
- The aggregates keyed on `assigned_reviewer_name` hold claims logins until the
  next publish rebuilds them from the migrated `case_current`.

## Considered

- **Add a domain column beside each Person column** — the first version of
  this change. Rejected for the reasons above: it multiplies per-person facts
  across Case rows and still leaves the claims login on the row.
- **Keep the claims login on the Case row and add a bare-account column** —
  rejected: two spellings of one person on one row is exactly the ambiguity
  this removes.
