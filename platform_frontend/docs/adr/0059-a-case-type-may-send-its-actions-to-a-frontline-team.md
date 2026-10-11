# 59. A Case Type may send its Remediation Actions to a frontline team

Date: 2026-10-11

## Status

Accepted. Settled with the owner in the project thread that explored Case Types
with no Responsible Party.

**Amends [ADR-0022](./0022-two-axis-role-model.md)** by adding a fourth
per-Case-Type group the app reads, `FrontlineTeam - <type>`. **Amends
[ADR-0011](./0011-section-level-role-based-access.md)** where it rejected
group-membership roles for the Conversation. Leaves
[ADR-0035](./0035-case-type-descriptors-express-variation-behaviour-stays-in-code.md)
standing: the Case Type declares the team's name and nothing else, and every
decision about what the team may do is in code.

## Context

Upcoming Case Types do not send their Remediation Actions to a named person. A
frontline team receives them as a team, through fixed mailboxes and through
group membership managed by a permissions workflow outside this application. On
these Case Types nobody fills in the Responsible Party, and three things break
when it is left blank:

- **Send Actions is held.** It waits for a Responsible Party whenever a failed
  Answer needs remediation, and on these Case Types nobody is ever named.
- **Nobody is on the frontline side of the Case.** Roles for the frontline came
  only from the people fields on the Case row (`responsibleParty`,
  `responsiblePartyManager`). With those blank, a team member who follows the
  notification's link matches no role and gets **Access denied**.
- **Awaiting Frontline never clears.** Send Actions sets the flag, and only a
  frontline reply clears it before the Case closes. With nobody on the frontline
  side, the Case sits in the Reviewer's Awaiting Frontline group until it
  breaches its SLA.

The owner ruled out changing the SharePoint lists or the pipelines; the
notifications pipeline is being handled separately. So the answer could not be a
new team column on the Case, and it did not need one: there is **one frontline
team per Case Type**, so the Case Type alone says which team a Case belongs to.

## Decision

1. **A Case Type opts in by declaring `frontlineTeam: { name }`.** The name is the
   team as a Reviewer knows it. A Case Type that declares nothing keeps the
   Responsible Party journey exactly as it was. `verify-config` refuses a
   declaration without a name.
2. **Membership comes from a group, composed like the other three.**
   `caseTypeGroupNames()` gains `frontlineTeam: 'FrontlineTeam - <displayName>'`,
   `resolveCapabilities` turns membership into `frontlineTeamCaseTypes`, and
   `resolveRoles` grants the new **`frontlineTeam`** Role on every Case of those
   types. It is the Journey Owner pattern applied to the frontline.
3. **The team stands where a Responsible Party would, no wider.** It gets the
   Responsible Party's access in every Section: the Summary from Reportable,
   Remediation read-only, and it is a Conversation participant on the frontline
   side. A team reply therefore clears Awaiting Frontline, so Send Actions keeps
   setting the flag and the Action Centre needs no change. A test holds the team
   to the Responsible Party's answer for every Section at every status.
4. **These Case Types never ask for a Responsible Party.** The picker is replaced
   by the line "Frontline team: _name_" at the foot of the Issues tab. It shows on
   the same condition the picker did, once remediation is required. Send Actions
   no longer waits on a Responsible Party for them.
5. **The team works from Frontline Cases (`#/frontline-cases`).** This is the
   Responsible Party queue (outstanding Remediation Actions, unread Messages)
   drawn from every Case of the team's Case Types, with no person filter. A team
   member lands there and Home links to it. Like the other Case-list queues it
   has no nav item. The `FrontlineTeam - <type>` group also makes that Case
   Type's list a Case source for the member.

### Why not reuse `Frontline - <type>`

`Frontline - <type>` already exists and already means "may open this Case Type's
list". It cannot also mean "is the frontline team". The notifications pipeline's
User group privileges deliverable puts **every notified Responsible Party** in
it, so reading it as a capability would give each of them every Case of the type
on Case Types that still name a person. The new group is the capability, and
`Frontline - <type>` stays a capability-free list ACL.

### Why the role is per Case Type, not per Case

ADR-0011 rejected group-membership roles for the Conversation because "the
Conversation is the thread between the Assigned Reviewer and the Responsible
Party of _that_ Case": letting unrelated people post broke the audit trail. On a
frontline-team Case Type the team **is** the Responsible Party of every Case, so
the group grants nothing a named person would not have had. Each Message still
records its author's own login.

## Consequences

- **Provisioning.** Each such Case Type needs a `FrontlineTeam - <displayName>`
  group whose members can read `Cases-<slug>`, either directly or through
  `Frontline - <displayName>`. The permissions workflow owns that membership. The
  Maintainer **Access** page does not grant it, as it does not grant any frontline
  group. The app reads the group for every Case Type, whether or not it declares
  `frontlineTeam`, because capabilities resolve at boot before any Case Type
  module is loaded. So the group must be created only for Case Types that declare
  a team: on a Case Type that names Responsible Parties it would hand its members
  every Case.
- **No new Case data.** No list column, JSON field or pipeline changes.
  `ResponsibleParty` and `ResponsiblePartyManager` stay on the list and are left
  blank, which the pipelines already accept. Reports group these Cases under
  "(unassigned)" with any Case that has no Responsible Party.
- **The JavaScript is UX only, as everywhere.** The list ACL is the boundary: a
  team member can read every item on a list their group can read, whatever the
  Section access says.
- **Appeals.** The Appeal raiser defaults to the Responsible Party's Manager, and
  a frontline-team Case Type has none. Appeals are switched off today. A Case Type
  that turns them on must say `appeal: { raisedBy: 'journeyOwner' }`.
- **Nothing is superseded.** The Responsible Party journey is unchanged for every
  Case Type that does not declare a team.
