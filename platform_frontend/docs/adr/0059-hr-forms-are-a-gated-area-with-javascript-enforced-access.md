# 59. HR Forms are a gated area with JavaScript-enforced access and encoded free text

Date: 2026-10-10

## Status

Proposed. Raised on
[#1045](https://github.com/nickwarters/data-pipeline-tooling/issues/1045) under the
epic [#1044](https://github.com/nickwarters/data-pipeline-tooling/issues/1044);
awaiting the owner's sign-off on the security wording and the pipelines decision.

Amends [ADR-0008](./0008-autosave-and-concurrency.md) (auto-save now covers
**Forms** as well as Cases). Surfaces a deliberate narrowing of
[ADR-0010](./0010-auth-and-permissions.md) for the Forms lists only: the list ACL
is still the security boundary, but on a Form list it is wider than the per-Form
rule the page shows, and that gap is accepted rather than closed. Takes the
recorded-versus-live manager split from
[ADR-0038](./0038-manager-fields-split-reporting-snapshot-vs-live-access-role.md)
and the descriptor rule from
[ADR-0035](./0035-case-type-descriptors-express-variation-behaviour-stays-in-code.md).

Amended on
[#1052](https://github.com/nickwarters/data-pipeline-tooling/issues/1052): the
application also owns `ClosedDate`, stamped by the lifecycle buttons, and the
list indexes it in place of `Modified` (sections 1, 4 and 7). Amended again on
[#1053](https://github.com/nickwarters/data-pipeline-tooling/issues/1053): the
same write stamps `ClosedBy`, which settles how the completion date and
completed-by are stored (section 4).

## Context

The site gains a separately gated **Forms** area where an employee and their
managers fill in internal HR forms: a 1-to-1 first, coaching forms and learning
plans later. These are held outside the platform today. Bringing them in reuses
its authentication, auto-save, styling and deployment, and gives employees and
managers one place to see what is outstanding.

Three things about it are new to this application and easy to misread later:

- **a new concept.** A Form is not a Case. A Case Type brings a Question Bank,
  an Outcome, Reviewer groups, and a place in the Dashboard, Search, Team Cases
  and allocation. A 1-to-1 has none of those, and modelling it as a Case Type
  would leak HR content into every one of them.
- **a new access model.** On the Case lists, who may see a Case is decided by
  list permissions, and the per-Case roles narrow only what the page shows
  (ADR-0010, ADR-0011). A 1-to-1 needs a per-person rule ("the employee and
  their managers"), and SharePoint can only enforce that with per-item
  permissions, which a normal user cannot set and which this application has no
  elevated process to set for them (ADR-0030, ADR-0031).
- **a new kind of stored data.** Free-text answers about a named employee's
  wellbeing and performance, which should not be readable by anyone who happens
  to open the list.

The decisions below were settled with the owner during planning. They depend on
each other, so they are recorded together.

## Decision

### 1. A Form Type is declared once, as data

A **Form Type** (1-to-1, coaching form, learning plan) is one JavaScript data
module under `form-types/`, typed with `@satisfies` and composed by the
application's composition root (ADR-0054), in the same way a Case Type is one
module under `case-types/` (ADR-0004). It declares its slug, its display name,
its list name and its sections, panels and fields. One generic renderer draws
any Form Type, in its editable, view-only and locked renderings.

A definition selects keys, labels, ordering and simple flags only (ADR-0035).
The access rules, the lock, the lifecycle buttons, manager prefill and the
completion stamp are code shared by every Form Type, never definition entries.

Each Form Type has **one SharePoint list**, named by the definition and given
the environment prefix centrally (ADR-0033), like every other list the app
reads.

The application owns the fields access and the lifecycle depend on: `Employee`,
`CurrentFirstLineManager`, `CurrentSecondLineManager`, `Status`, `DueDate`,
`ClosedDate` and `ClosedBy`. A definition may place them on the page. It cannot rename them, leave them out,
or make them editable after creation. The verify gate refuses a definition that
tries.

### 2. Who may read, edit and create a Form

This matrix is the 1-to-1's and the default for every Form Type:

| Who                                                 | Read            | Edit (while open) | Create |
| --------------------------------------------------- | --------------- | ----------------- | ------ |
| The Form's **Employee**                             | yes             | yes               | yes    |
| The **current first line manager**                  | yes             | yes               | yes    |
| The **current second line manager**                 | yes             | no                | yes    |
| The **Forms Control group** (one for every type)    | yes, every Form | no                | yes    |
| A manager recorded at completion, no longer current | no              | no                | n/a    |

- A member of the Forms Control group who is also the Employee or a current
  manager on a Form has that role's rights on it too. Control membership adds
  reading every Form; it never takes their own Forms away.
- Whoever creates a Form need not be one of its editors. A second line manager
  or a Forms Control member who creates one hands it to the employee and the
  first line manager to fill in.
- Anyone allowed to read a Form but not edit it sees the same layout with the
  values as text, behind a banner saying why.

**The rules are enforced in the page's JavaScript.** One pure module answers
"may this person read, edit or create this Form" from the Form's own `Employee`,
`CurrentFirstLineManager` and `CurrentSecondLineManager` and the person's
Forms Control membership. Views ask it and never re-derive the rules, as
Section access resolves Case roles from the Case row today.

**SharePoint permissions are set at list and group level only, never per
item.** Reads are narrowed on the server to the Forms where the person is the
Employee or a current manager, on indexed Person columns, and the rule module
re-checks every row that comes back, so a row the query let through is never
shown. A Forms Control member's "every Form" read is paged and date-windowed
because of the list view threshold (ADR-0031).

### 3. Current managers grant access; the managers at completion are the record

Two pairs of manager columns, for the same reason ADR-0038 split the Case's
manager fields: an org-chart edge is a mutable fact, and a copy of it on a row
goes stale.

- **`CurrentFirstLineManager` and `CurrentSecondLineManager`** decide access,
  and nothing else does. The app writes them once, when the Form is created.
  After that only a process outside this application changes them, as people
  move, and the app assumes they are up to date. That process is not part of
  this decision.
- **`FirstLineManager` and `SecondLineManager`** are ordinary fields on the Form.
  The editors may change them until the Form is completed. Locking then freezes
  them, which makes them the record of who the managers were at completion,
  with no separate stamp. They grant no access.

At creation both pairs are written with the chosen managers. Editing
`FirstLineManager` afterwards never touches `CurrentFirstLineManager`. So a
manager who has moved on loses access to a Form they once managed, even one
they completed, and the Form still shows that they were its manager.

### 4. A closed Form is locked for everyone

A Form's **Status** is a plain Choice column holding **Pending**, **Completed**,
**Void** or **Cancelled**. A Form is **Pending** until it closes, and is locked,
read-only for everyone including its editors, once its Status is **Completed**,
**Void** or **Cancelled**. The lock is one rule in the access module: a terminal Status makes
"may edit" false for everybody, so the Form renders read-only and the save queue
is never handed an edit.

Status changes only through the Form's own lifecycle buttons (Mark complete,
Void, Cancel), never through a field. The same write stamps **`ClosedDate`**,
the day the Form closed, which the Forms archive windows and sorts on. It is its
own column rather than `Modified`, because `Modified` moves whenever anything
touches the item, including the outside process that keeps the current
managers up to date, so a Form closed a year ago would read as closed today.
It also stamps **`ClosedBy`**, the person who pressed the button, which the
locked page shows beside the managers recorded at completion. Both are columns
of their own rather than a reading of the version history: versioning is a
provisioning setting on these lists (section 7), and the history names whoever wrote the
item last, which after a close can be the outside process updating the current
managers. The defaults below are recorded as
defaults, not settled rules:

- **Who may Void or Cancel:** the two editors, the Employee and the current first
  line manager.
- **Reopening:** a locked Form is never reopened.

### 5. Two fields are editable only by their owner

Every field on a Form is editable by both editors except two, which a
definition marks with `editableBy`:

- **Individual comments** (`editableBy: 'employee'`): only the Form's Employee.
- **Line manager comments** (`editableBy: 'manager'`): only the current first
  line manager.

Everyone else reads them as text. The rule that reads `editableBy` lives in the
same access module as the matrix, not in the renderer.

### 6. Free text is encoded, and encoding is not protection

**What it is.** Every free-text value a Form stores, its `text` and `textarea`
fields and its Actions blob, is written to a multi-line plain-text column as
UTF-8-safe base64: the value's UTF-8 bytes, base64 encoded, so a `£`, an emoji
or a smart quote survives where plain `btoa` would throw. People, dates, choices
and Status stay plain. Which columns are encoded follows the field's type, with
no per-field flag to forget. Encoding and decoding happen in the data layer,
never in a view.

The point is that **content is not readable at a glance**: in the list's own
views, in an export, over someone's shoulder.

**What it is not.**

- **It is not encryption.** Anyone who can read the row can decode it with one
  line in a browser console. There is no key.
- **It is not a permission boundary, and neither is hiding the list.** Each Form
  list is hidden from everyone but the site owner group, which has two trusted
  people: it is left out of the navigation and Site Contents. Hiding changes what
  the SharePoint UI shows. It does not change what REST returns. Every member of
  a list's access group has permission on it, because that is how the app reads
  and writes on their behalf, and the list names are in the deployed
  JavaScript.
- **The JavaScript gate is UX.** It decides what the page shows. It does not
  decide what the server will hand over.

**The residual risk, in plain words:** any member of a Form list's access group
can read every Form on that list, including other employees' 1-to-1s, by calling
`/_api/web/lists/getbytitle('<list>')/items` and decoding the result. Hiding
the list and encoding its text make that a deliberate act rather than an
accident. They do not prevent it. **The owner accepts this risk**, limited to
each list's access group, in place of per-item permissions and the elevated
process they would need.

Encoded columns cannot be filtered, sorted or indexed on the server, which is
why every column a query or the access rule reads stays plain. Base64 also
inflates text by about a third, which is why encoded values go in multi-line
columns.

### 7. Recommended list settings

Each Form list is provisioned by hand in each environment, with:

- **search exclusion** ("Allow items from this list to appear in search
  results" off), because search results are trimmed only to list permission;
- **list auditing** on, so a bulk read is at least recorded. Whether REST item
  reads are audited on this farm is still to be checked;
- indexes on `Employee`, `CurrentFirstLineManager`, `CurrentSecondLineManager`,
  `Status`, `DueDate` and `ClosedDate`, created while the list is empty
  (ADR-0031);
- versioning on, remembering that version history keeps every earlier
  encoded value, readable by anyone who can read the item.

The provisioning runbook carries the per-list detail.

### 8. Auto-save covers Forms

A Form saves itself the way a Case does (ADR-0008): one `SaveQueue`, a 1500 ms
debounce after the last edit, field-level PATCH, ETag concurrency, the same
retry and backoff, and the same Saving / Reconnecting / Conflict status. The
queue is handed a small target adapter (read, write, and a conflict rule), so
Cases keep exactly today's behaviour.

- **A Form's conflict rule:** a 412 is a conflict when any field being saved has
  changed remotely since it was loaded. Otherwise the queue re-reads, merges and
  retries silently.
- **"Last saved":** a Form shows the time of its last successful save beside the
  status.
- **Creating a Form** is one explicit write. Auto-save needs an item to PATCH,
  so New form asks for the Employee, both managers and the due date, creates the
  item, then opens it with auto-save on.
- **Lifecycle buttons** (Mark complete, Void, Cancel) write on the button press,
  not on the debounce, as a Case's status does.

### 9. HR Form data is not ingested by the data pipelines

The repository's rule is that new data on the platform flows to the pipelines
unless a decision not to is recorded with a reason. **Form data is not
ingested.** The reasons:

- **No consumer needs it.** The pipelines exist to select, review and report on
  Cases. No report, Deliverable or Selection rule reads anything about a 1-to-1.
- **It would widen the audience.** The accepted risk in 6 is limited to each
  Form list's access group. A pipeline copy would put the same content in the
  pipeline's stores, under different access, and decoding base64 there is as
  trivial as in a browser.

If a report on Forms is wanted later (how many are overdue, say), it is a new
decision. The likely shape is to read only the plain columns, Status and the
dates, and never the encoded content. The pipeline side carries a one-line
pointer to this decision in the root `CONTEXT.md`.

## Open items

Settled during the build, before any real data goes in. Each is open, not
guessed:

1. **Who may Void or Cancel.** The default in 4 is the two editors.
2. **Reopening.** The default in 4 is never.
3. **Group names.** Settled: the access group is `EPF Users` and the Forms
   Control group `EPF Controls`. One access group serves every Form list until a
   Form Type needs a narrower audience.
4. **Retention:** how long Forms are kept, and who may delete one.
5. **Auditing:** whether REST item reads are audited on this farm.

The choice values were settled during review: a 1-to-1's Competency stage is
Stage 1, Stage 2 or Stage 3 and its Location In person or Zoom, a Form's Status
is as in 4, and a Form Action's status is Pending, Completed or Cancelled. The
stages are a first set and may grow.

## Considered and rejected

- **Forms as Case Types.** A Form has no Question Bank, Outcome, Reviewer or
  allocation, and a Case Type would put HR forms in the Dashboard, Search and
  Team Cases. Rejected in favour of the smaller Form Type.
- **Per-item permissions.** The only real per-person boundary on SharePoint. A
  normal user cannot break inheritance, so it needs an elevated process (a
  workflow, a service account, or the site owners by hand), which reverses this
  application's no-automation-tier stance, and list performance degrades past a
  few thousand uniquely permissioned items.
- **"Users read only items they created."** Breaks when a manager creates the
  Form for an employee, which is the common case.
- **Client-side encryption.** With no backend, a key shipped in the JavaScript is
  obfuscation again; per-user keys are a large design whose failure mode is
  losing the data.
- **Encoding the people, dates and Status too.** Every query and the access rule
  read them, so every browser would have to download every Form to find its own.

## Consequences

- **The per-Form rule is not enforced by SharePoint.** Anyone reviewing a later
  Forms change checks it against 2 and 6, and treats a claim that a Form is
  "private to its employee" as wrong.
- **The access module and the lock are security-relevant code** and are held to
  full line and branch coverage, as permissions code is.
- **A Form is invisible to a manager who has moved on**, including one they
  completed. Only the Forms Control group and the people current on it can read
  it.
- **The data is only as current as the outside process.** If
  `CurrentFirstLineManager` is stale, the wrong manager has access until it is
  corrected; the app cannot tell.
- **Coaching forms and learning plans are new definitions, not new pages.** One
  may add a section or field type if it needs one.
- **Nothing is superseded.** This is a new area; no existing code path is made
  dead.
