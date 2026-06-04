# Case Review Platform

A SharePoint-hosted tool for **Reviewers** to assess **Cases** against a catalog of **Question Definitions**, recording **Answers**, attaching **Remediation Actions** to failures, and arriving at a computed **Outcome**.

## Language

### Cases & types

**Case Type**:
A configuration that defines which sections appear on a review, which **Question Definitions** apply, the case-detail fields specific to this type, and the algorithm used to compute the **Outcome**.
_Avoid_: Category, template

**Case**:
One concrete review job: an instance of a **Case Type** that a **Reviewer** works through. Has details, **Answers**, a **Conversation**, an **Outcome**, and notes.
_Avoid_: Review (ambiguous — "review" is the activity, not the thing)

**In-progress Case**:
A **Case** with one or more applicable unanswered **Question Definitions**. Cannot be marked complete.

**Completed Case**:
A **Case** where every applicable **Question Definition** has an **Answer**. Has a `completedAt` timestamp on the SharePoint list row.
_Avoid_: Closed, finished, done

**QA Check**:
A separate **Case** that references a **Completed Case** and records a meta-review of whether the original **Assigned Reviewer** conducted that Case properly. Has its own **Assigned Reviewer** (the QA reviewer), its own **Answers**, and its own **Outcome**. The original Case is read-only input. A QA Check is modeled as a distinct Case Type (e.g. `qa-{slug}`), not a mode on an existing Case. Only some Completed Cases are selected for QA Check; selection is manual and performed by a role not yet fully defined in the domain.
_Avoid_: Re-review, audit (overloaded)

### Questions & answers

**Question Definition**:
The canonical question — stable ID, text, response type, options, conditional triggers, failure criteria, attached remediation actions. **Shared across Case Types**: the same definition can appear in many catalogues. Edits are live: in-progress Cases see updates immediately.
_Avoid_: Question (ambiguous between definition and instance), QuestionTemplate

**Applicable Question**:
A **Question Definition** that, given the current state of a Case's **Answers**, should be presented to the **Reviewer**. Computed live by evaluating conditional triggers — not a stored set.

**Answer**:
A **Reviewer**'s response to one **Question Definition** for one **Case**. Carries a value, an optional justification, and zero-to-many **Remediation Actions**.
_Avoid_: Response (overloaded — used in HTTP context elsewhere)

**Remediation Action**:
A corrective action attached to a *failed* **Answer**. A failed Answer can have many Remediation Actions.
_Avoid_: Remediation (ambiguous — refers to the section, not the item)

### People

**Reviewer**:
A SharePoint user in the Case Reviewers **SharePoint Group**. Eligible to be assigned **Cases** and produce **Answers**. Group membership alone does not grant edit access to any particular Case — that's the **Assigned Reviewer**.
_Avoid_: Assessor, evaluator

**Assigned Reviewer**:
The single **Reviewer** currently assigned to a specific **Case** (the Case row's reviewer field). The role that grants edit access to that Case's **Answers**, **Conversation**, **Notes** and **Remediation Actions**. Reassignment is a single-user-field update; history comes from SharePoint's list version history, not stored explicitly.
_Avoid_: Owner (of the case), primary reviewer, lead

**Responsible Party**:
The SharePoint user whose work is being reviewed (e.g., the agent on a call being assessed). Distinct from the **Reviewer**. One per **Case**. Distinct from an **Attributed Party** (which is per-failure, not per-Case).
_Avoid_: Subject, owner (ambiguous), reviewee

**Attributed Party**:
The single SharePoint user identified as responsible for one specific *failed* **Answer**. Optional and zero-or-one per failed Answer. Distinct from the **Responsible Party**: a Case has exactly one Responsible Party (whose work is under review), but multiple people may have had a hand in the process, and any single failure may be attributed to a different person. Stored inside the Answer as a bare account name plus a cached display name (`{ loginName, displayName }`); the claims prefix and AD domain are single constants reattached at lookup time. Resolved to an authoritative display name at page load via the User Profile read (`GetPropertiesFor`), with the cached name as fallback. Settable only by the **Assigned Reviewer**, only when the **Case Type** enables `attributeFailures`, and frozen once the Case is **Completed**. Stripped automatically when its Answer is no longer a failure. Does not affect the **Outcome**.
_Avoid_: Responsible Party (case-level, a different concept), Owner, Culprit, Blame, Assignee

**Reviewer Manager**:
A SharePoint user in the Reviewer Managers **SharePoint Group** who manages a team of **Reviewers**. Sees the `#/reports/reviewer-team` report — their team's completed-Case volumes (7- and 30-day) and current assigned-Case queue health (outstanding, overdue), totalled and broken down by **Case Type**. The relationship "Reviewer X is managed by Reviewer Manager Y" is denormalised onto every **Case** row as `assignedReviewerManager` (a user field) so reports can be queried via a single server-side `$filter` per **Case Type** list. A user is either a Reviewer Manager *or* a **Responsible Party Manager**, never both — enforced by Maintainer convention, not code.
_Avoid_: Team Lead, Reviewer Supervisor

**Responsible Party Manager**:
A SharePoint user in the Responsible Party Managers **SharePoint Group** who manages a team of **Responsible Parties** (e.g. the line manager of a group of call-centre agents being assessed). Sees the `#/reports/responsible-party-team` report — a 12-calendar-month view of their team's assessed Cases, broken down by pass / fail / had-remediation, totalled and per-Responsible-Party. The relationship "Responsible Party X is managed by Responsible Party Manager Y" is denormalised onto every **Case** row as `responsiblePartyManager` (a user field). Mutually exclusive with **Reviewer Manager**.
_Avoid_: Line Manager (overloaded), RP Manager (jargon abbreviation)

**Case Type Owner**:
A SharePoint group that "owns" a **Case Type** and sees aggregate dashboard stats for it (outstanding, overdue, completed today / last 7 days). Case Type Owners are also the **authors** of Question Bank changes — they propose additions, edits, and deprecations via the question bank editor. Maintainers act as implementors who confirm (publish) those changes; they do not author them.

**Maintainer**:
A platform administrator responsible for deploying and configuring the framework. When Question Bank changes are authored by a **Case Type Owner**, the Maintainer's role is to confirm (publish) the changes — not to author or approve them. Maintainers also handle SharePoint list/group provisioning and code deployments.
_Avoid_: Admin (overloaded with SharePoint admin), developer

**Visitor**:
A SharePoint user who is authenticated (browser NTLM/Kerberos passes) but does not belong to any named Case Review **SharePoint Group** — not a **Reviewer**, **Reviewer Manager**, **Responsible Party**, **Responsible Party Manager**, **Case Type Owner**, or **Maintainer**. Cannot be an **Assigned Reviewer**, cannot produce **Answers**, has no ownership or management responsibilities. The `#/` landing page shows a Visitor an explainer and an access-request prompt; all other routes are inaccessible (enforced by SharePoint list ACLs, surfaced as UX by capability checks). Visitor is *derived* from the absence of all other group memberships — there is no "Visitors" SharePoint group.
_Avoid_: Guest (collides with SharePoint's external-guest concept), Unenrolled (jargon), Anonymous (the user *is* authenticated)

### Communication

**Conversation**:
The thread between **Reviewer** and **Responsible Party** for one **Case**. Stored as a JSON array of **Messages** in a single plain-text field on the Case row.

**Message**:
One entry in a **Conversation** — author, timestamp, body.

### Outcome

**Outcome**:
The computed verdict for a **Case**, derived by the **Case Type**'s algorithm from the Case's **Answers**. The *live* Outcome is always re-derivable from Answers — it is not a stored entity. However, a **snapshot** (`outcomeAtCompletion`) is stamped onto the Case row at the moment the Case becomes a **Completed Case**, to support historical reporting. The snapshot is frozen: it is not updated if Question Definitions or the outcome function change afterwards. A pass Outcome implies no **Remediation Actions** were attached (Remediation Actions only attach to failed Answers, and a failing Answer cannot yield a pass Outcome).

## Relationships

- A **Case** belongs to exactly one **Case Type**.
- A **Case Type** references many **Question Definitions** (a catalogue).
- A **Question Definition** can appear in many **Case Types**.
- A **Case** has many **Answers**, one per **Applicable Question**.
- An **Answer** has zero-to-many **Remediation Actions**.
- A *failed* **Answer** has zero-or-one **Attributed Party**.
- A **Case** has one **Conversation** (= many **Messages**).
- A **Case** has one **Assigned Reviewer** and one **Responsible Party**.

## Example dialogue

> **Dev:** "When the **Reviewer** finishes the last question, do we auto-complete the **Case**?"
> **Domain expert:** "No — completion is an explicit action by the Reviewer. We just unlock the 'Complete Case' button once every **Applicable Question** has an **Answer**."
> **Dev:** "And if an admin adds a new **Question Definition** to the **Case Type** after the Reviewer has answered everything else?"
> **Domain expert:** "The Case goes back to **In-progress**. The new question becomes **Applicable** and must be answered."

## Flagged ambiguities

- "Question" was being used for both the canonical definition and the per-Case instance — resolved as **Question Definition** vs **Answer**.
- "Remediation" was being used for both the section and the corrective action — resolved as **Remediation Action** for the item; the section is just a UI concern.
- "Outcome" was nearly modeled as a stored entity — resolved as a *computed* property of a Case.
- "Reviewer" was being used for both group membership and per-Case assignment — resolved as **Reviewer** (group) vs **Assigned Reviewer** (per-Case role). See ADR-0011.
- "Visitor" is *derived* (absence of all named-group memberships), not a SharePoint group — consistent with ADR-0010, capability flags are UX-only and the real boundary is SharePoint list ACLs.
