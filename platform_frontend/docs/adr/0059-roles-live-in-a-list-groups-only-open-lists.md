# 59. Roles live in one list; groups only open Case lists

Date: 2026-11-19

## Status

Accepted. Rolled out in phases, each its own change; see **Migration** below for
which have landed. Amends [ADR-0022] (its two axes survive, but neither is held
in per-type groups any more) and [ADR-0057] (a second list is shared by every
environment, for the reason that ADR asks for).

## Context

[ADR-0022] put every role in a SharePoint group, and four of those groups exist
per **Case Type**: `Reviewers - <type>`, `Frontline - <type>`, `CaseTypeOwner -
<type>` and `JourneyOwner - <type>`, beside six site-wide ones. That is 4N + 6
groups, so 46 at ten Case Types, and five more types were planned.

Only two of the four per-type groups are a security boundary. `CaseTypeOwner -
<type>` and `JourneyOwner - <type>` carry no permission on any list; the Access
page grants them with `Reviewers - <type>` or `Frontline - <type>` precisely
because they open nothing. They are flags the app reads, held in the one store
SharePoint makes awkward to read in bulk, to audit, or to see at a glance.

Two more facts weighed:

- Every Case list writer held plain **Contribute**, which includes **Delete
  Items**, although nothing the app does deletes a Case.
- The runbook grants the site-wide `Frontline` group read on every Case list, so
  any **Adviser** can read every Case of every type through REST; only the app's
  filters stop them.

## Decision

**Groups say who can open a list. One row per person says what they may do.**

### Groups

| Group                  | Permission                    | Granted on      | Holds                                                                                 |
| ---------------------- | ----------------------------- | --------------- | ------------------------------------------------------------------------------------- |
| `Cases - <type> Read`  | Read                          | `Cases-<Slug>`  | Per-type read-only roles; none exist yet, so it starts empty                          |
| `Cases - <type> Write` | `CORA Contribute (no delete)` | `Cases-<Slug>`  | Reviewers, Case Type Owners and Journey Owners of the type, and its frontline parties |
| `CORA All Cases Read`  | Read                          | every Case list | Reviewer Managers, Responsible Party Managers                                         |
| `CORA All Cases Write` | `CORA Contribute (no delete)` | every Case list | Controls                                                                              |
| `CORA Owner Delegates` | unchanged                     | unchanged       | Maintainers                                                                           |

That is 2N + 3 groups, so 23 at ten Case Types. `CORA Owner Delegates` stays a
group because it owns every other group and is the one that may edit the roles
list: the thing guarding the list cannot live inside it. `caseListGroupNames()`
and `allCaseListGroups` in `src/services/permissions.js` are the one spelling of
the new names.

**A Case Type Owner holds Write on their own type.** They have it today through
`Reviewers - <type>`, so this keeps what they can do, without making them a
Reviewer.

### The `CoraUserRoles` list

One row per person, unique on a **Person** column, with the bare account in the
indexed **Title** column the app filters on (the same key the Access Log uses).

| Column                    | Type                    | Was                                                     |
| ------------------------- | ----------------------- | ------------------------------------------------------- |
| `Adviser`                 | Yes/No                  | `Frontline`                                             |
| `Controls`                | Yes/No                  | `Controls`                                              |
| `ReviewerManager`         | Yes/No                  | `Reviewer Managers`                                     |
| `ResponsiblePartyManager` | Yes/No                  | `ResponsibleParty-Managers`                             |
| `Reviewer`                | Yes/No                  | bare `Reviewers`, for a Reviewer who holds no Case Type |
| `Reviews`                 | Choice, multiple, slugs | `Reviewers - <type>`                                    |
| `OwnsCaseTypes`           | Choice, multiple, slugs | `CaseTypeOwner - <type>`                                |
| `JourneyOwnerOf`          | Choice, multiple, slugs | `JourneyOwner - <type>`                                 |

A per-type role is a multi-choice column, not a yes/no column per type, so a new
Case Type is one new choice value on three columns rather than three new
columns. The row is UX, exactly as the groups it replaces were ([ADR-0010]): it
can only grant screens whose data the list ACLs already allow. It is still
locked down — `CORA Owner Delegates` edit, every CORA user reads, versioning on.

Like `CoraAccessLog`, it is **one list shared by every environment**, with no
prefix. [ADR-0057] asks a second shared list for its own reason; this is it: the
roles the row holds are what a person may do in every environment, just as the
groups were.

`src/services/user-roles.js` is the one statement of the row's shape. It also
spells the row as **role entries**, one string per set flag and per held slug,
so the Access page can plan a change over a person's groups and their row as one
list. An entry carries a colon, which SharePoint refuses in a group name, so it
can never be mistaken for one.

## Migration

Built beside the old model and read alongside it, so nobody loses access until
the old groups are switched off, and each phase can be reversed on its own.

0. **Tenant checks.** Confirm `Reviewers - <type>` and `Frontline - <type>` hold
   the same level on each Case list; if not, split the Write group in two first.
1. **No delete.** Every Case list writer moves to `CORA Contribute (no delete)`,
   proven by the ACL smoke gate's `delete: 'deny'`.
2. **Build alongside.** Provision the list and groups, then
   `scripts/backfill_user_roles.js` fills them from the legacy groups.
   `src/services/legacy-groups.js` is the one translation, and goes with the old
   groups.
3. **Read both.** The app grants a role from either model, and the Access page
   and notifications pipeline write both.
4. **New only.** The app, the Access page and the pipeline use only the new model.
5. **Retire.** Adviser reads narrow to the lists a person's groups open, the
   `Frontline` blanket read goes, and then the legacy groups.

## Considered options

- **Keep four groups per type.** The count is a manageability cost, not a
  limit: SharePoint allows 10,000 groups per site collection.
- **One `Cases - <type>` group, no Read/Write split.** Smaller, but a future
  per-type read-only role would need a new group anyway; the empty Read group
  costs one group per type and is ready for it.
- **Item-level permissions per Case for frontline.** The only way to stop an
  Adviser reading other Cases of a type they hold one in, but SharePoint
  guidance keeps unique scopes per list well under 5,000 and every reassignment
  would re-grant. A separate decision.
- **App-enforced access with one broad group.** A browser-only application
  enforces nothing; any user could read any list through REST.

## Consequences

- Provisioning a Case Type is two groups, one Case list, and one choice value on
  three columns, rather than four groups.
- Nobody can delete a Case item, and once phase 5 lands an Adviser reaches only
  the types they have been granted.
- The roles list is new platform data, so the data pipelines must land it or
  record why not; that is decided with the phase that first reads it.
- Members granted through a nested AD group are still invisible to the app's
  group reads, but per-type roles no longer depend on group reads, so an AD
  group may sit inside a `Cases - <type>` group freely.

[ADR-0010]: ./0010-auth-and-permissions.md
[ADR-0022]: ./0022-two-axis-role-model.md
[ADR-0057]: ./0057-the-access-log-is-one-list-shared-by-every-environment.md
