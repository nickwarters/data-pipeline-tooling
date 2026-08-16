# Data dictionary — `notifications`

The `notifications` pipeline reads Sync's **gold** current state and produces
three things: a **file Deliverable** in the outbox (the notifications
themselves), a gold **`notified` ledger** (who has been told what), and it
consumes one **`users` reference feed** (who a login is, and who manages them).
Recipients are the two Conversation parties who did not author the last Message
— see
[ADR-0024](adr/0024-notification-recipients-are-the-two-parties-who-did-not-speak-last.md).

The prose companion to `pipelines/notifications/`; the enforced contracts are in
`pipelines/notifications/pipeline.py` and, for the `users` directory feed it
reads but does not own, the Shared Reader `readers/users.py`.

## Three things to know before this reaches a tenant

**1. `CASE_LINK_TEMPLATE` is a placeholder.** It is
`https://sharepoint.invalid/sites/REPLACE-ME/SitePages/REPLACE-ME.aspx#/conversation/{case_type}/{source_item_id}`,
and two tenant facts fold into it: the **site collection** holding the review
application, and the **host `.aspx` page** the single-page app is served from.
Neither exists anywhere in this repository to copy — the app derives its own site
from the page it is served from. The fragment after them is the app's registered
`#/conversation/:caseType/:id` route, and is *not* a placeholder: it is
deliberately a deep link into the app rather than a `DispForm.aspx` list form,
because the recipient must land somewhere they can **reply**. Both unknowns are
swapped in one place.

**2. `sample_data/users.csv` carries example addresses, not people.** Every
address is `@example.invalid` and every login is a fixture name. Going live means
pointing this feed at a real directory extract with the same four columns; until
then a notification would be addressed to nobody.

**3. The first run tells everybody.** The ledger is empty on the first pass, so
every non-terminal Case with a Conversation produces a notification. This is
accepted, not a defect — the pipeline writes a file into an outbox, it does not
send mail — and the operator drains or discards that first file **deliberately**.
See the go-live checklist in
[`sharepoint-cases-going-live.md`](sharepoint-cases-going-live.md).

---

## The outbox file — a **Deliverable**, not a table

### Part A — overview

| Attribute | Value |
|-----------|-------|
| **Deliverable name** | `deliverables/cora_notifications/<stamp>-<run>.json` |
| **Destination** | `NOTIFICATIONS_DESTINATION` = `cora_notifications` (`tools/deliverables.py`) |
| **Grain** | one object per Case with at least one un-notified recipient |
| **Writer** | `JsonWriter` (`orient="records"`, so the file is a JSON array of objects in frame-column order) |
| **Load strategy** | `Refresh()` — onto a path that is **unique per pass**, so it never overwrites an undrained file |
| **Upstream dependencies** | `sharepoint_cases` gold `case_current` and `conversation_message`; the `users` feed |
| **Consumer** | the notification service, which drains the outbox as a per-file work queue with no ordering key |
| **Emitted when** | at least one recipient survives the ledger anti-join; a pass owing nobody anything writes **no file at all**, rather than an empty array |

### Part B — the three keys, verbatim

**This is the consumer's contract.** Every object carries exactly these three
keys, in this order, and no others. Adding a fourth is a breaking change to the
notification service, and the pipeline gates it: a validate node refuses any
other column set or order before the file is written.

| Key | Type | Description | Example |
|-----|------|-------------|---------|
| `recipients` | `str` | The recipients' email addresses joined by `;`, **with no spaces around the separator**, sorted. Never blank — an object with no recipients is never produced. | `a.khan@example.invalid;e.novak@example.invalid` |
| `subject` | `str` | The literal string `you have a new message`. Not templated, not per-Case. | `you have a new message` |
| `body` | `str` | A minimal HTML block: one paragraph, then one paragraph holding one `<a href>` to the Case's conversation. **No `<style>` element, no inline `style=` attribute, no table layout** — the notification system supports HTML but barely any styling. Every interpolated value is `html.escape`d. | `<p>There is a new message…</p>\n<p><a href="…">Open the conversation</a></p>` |

---

## `notified` — gold layer, `notifications` subject

The **Notified ledger**: what a person has been told. Distinct from the **Run
store**, which records what a *run* did.

### Part A — overview

| Attribute | Value |
|-----------|-------|
| **Table name** | `notified` |
| **Subject** | `notifications` (`<base_dir>/notifications/gold.db`) |
| **Medallion layer** | gold |
| **Grain** | one row per `(case_id, recipient, message_at)` |
| **Is this a Case Type?** | No — application state |
| **Reader** | `SqliteReader`, through the namespace `Store` |
| **Load strategy** | `AppendOnly(("case_id", "recipient", "message_at"))` |
| **Written** | *after* the outbox file lands, by a sequencing edge in the graph |

### Part B — field dictionary

| Field | Type | Nullable | Description | Example | Sensitivity | Notes |
|-------|------|----------|-------------|---------|-------------|-------|
| `case_id` | `str` | No | The Case the notification was about, as gold already carries it. | `9f2c…` | Internal | Not re-derived here; gold's column is used as landed. |
| `recipient` | `str` | No | The email address told. Keyed by the address rather than the login, because the address is what was actually written into a file. | `b.okafor@example.invalid` | PII | A directory email change therefore re-notifies once — the safe direction. |
| `message_at` | `str` | No | The triggering Message's `posted_at`, carried through **verbatim**. | `2026-08-04T18:47:12.000Z` | None | Never parsed: it is `str` by design at silver, and re-typing it would let a spelling difference re-notify everybody. |

**The row is exactly its key and nothing else.** No `notified_at` column: the
append-only comparison spans every non-provenance column, so a non-key value
would turn a legitimate re-present into an `AppendOnlyConflictError`. The
reserved run-provenance column is excluded from that comparison and already
answers *"which run first told them"*. With no non-key columns the conflict
branch is unreachable by construction, and re-presenting a row a previous pass
already wrote is a no-op.

`InsertIfAbsent` looks like the natural strategy for this table and is not: it
mints an integer surrogate the ledger has no use for, and offers no
`apply_to_frame`, so no file-side form of the same load exists.

### Part C — Row checks

None. The row is its key; there are no other fields for a rule to relate.

### Part D — quality notes

- The first pass reads a table that **does not exist yet**. `SqliteReader` raises
  on a missing table, so the anti-join's ledger source guards on
  `Store.columns_of(...)` returning `None` and yields an empty three-column
  Dataset instead.
- A crash between the outbox write and the ledger write costs a **duplicate
  notification** on the next pass, never a lost one. That is why the two writes
  are ordered, and why they are ordered that way round.

---

## `users` — reference feed

The directory extract behind every recipient. Read-only; nothing writes it.

### Part A — overview

| Attribute | Value |
|-----------|-------|
| **Feed name** | `users` |
| **Grain** | one row per `login` — **enforced**; a duplicate is refused |
| **Is this a Case Type?** | No — **Reference Data** |
| **Source system** | a directory extract *(today: the bundled `readers/sample_data/users.csv`)* |
| **Reader** | `readers.users.UsersReader` — a Shared Reader wrapping a `CsvReader`; constructed with a `base_dir` and resolving its own location ([ADR-0026](adr/0026-shared-readers-declare-cross-subject-reads.md)) |
| **Load strategy** | none — read straight into the join, never landed |

### Part B — field dictionary

| Field | Type | Nullable | Description | Example | Sensitivity | Notes |
|-------|------|----------|-------------|---------|-------------|-------|
| `login` | `str` | No | The person's account name. Normalised through `shared/account_names.py` to the **lower-cased bare account**, so a claims-form or `DOMAIN\user` extract keys the same as a bare one. | `b.okafor` | Internal | A blank login drops the row: blank must never match blank. |
| `email` | `str` | No | Where a notification to this person is addressed. Lower-cased. | `b.okafor@example.invalid` | PII | A blank email drops the row — an unreachable person is skipped, not substituted. |
| `manager_login` | `str` | Yes | Who manages this person, normalised the same way. Read for the **Responsible Party's** row, to find the Responsible Party Manager. | `e.novak` | Internal | Blank is legitimate (the top of a tree); the Manager is then simply not a recipient. |
| `manager_email` | `str` | Yes | The manager's address, so the Manager is resolvable from the Responsible Party's row alone. | `e.novak@example.invalid` | PII | The **fallback**: the Manager's own `email`, where they have a row of their own, wins. Blank on both means the Manager cannot be told and is skipped. |

### Part C — Row checks

None. The four fields are two independent `login`/`email` pairs.

### Part D — quality notes

- **A duplicate `login` aborts the read.** It is the one validation worth having
  here: the recipient join fans out on it, and every extra row is a person told
  the same thing twice.
- A missing column aborts the read, naming the columns it wanted.
- The Responsible Party Manager comes from **here**, never from
  `case_current.responsible_party_manager_name` — nothing writes that column, and
  live directory resolution is the documented correct authority for a role that
  is an access-control input (`platform_frontend/CONTEXT.md`, *Responsible Party
  Manager*).

---

## Where the identity join happens

The Case row's person columns hold **claims logins**
(`i:0#.w|CONTOSO\b.okafor`); a Conversation Message's `author_login` holds a
**bare** account name (`b.okafor`). They do not join as landed — see the
*Bare account logins vs. claims logins* note in
[`data-dictionary-sharepoint-cases.md`](data-dictionary-sharepoint-cases.md).
This pipeline applies the encoding on its own side, through
`shared/account_names.py`, which is the Python half of
`platform_frontend/src/services/account-name.js`. Keep the two in step.
