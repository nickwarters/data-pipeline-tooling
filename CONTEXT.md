# CORA — Case Review Platform

**CORA** is a SharePoint-hosted tool for **Reviewers** to assess **Cases** against a catalog of **Question Definitions**, recording **Answers**, attaching **Remediation Actions** to failures, and arriving at a computed **Outcome**.

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
A **Case** in the terminal `Completed` **status** with a `completedAt` timestamp. Reaching
it requires every applicable **Question Definition** to have an **Answer** _and_ either no
**Remediation Actions** exist (the Reviewer clicks **Complete Case** directly) or every
sent action has been resolved on the **Remediation** Section (the actions path — see
**Case Status** and **Reportable**, ADR-0023). Not the same as **Reportable**: on the
actions path a Case is Reportable (its Answers frozen, Outcome snapshotted) at **Send
Actions**, then only later Completed.
_Avoid_: Closed, finished, done

**Case Status**:
The lifecycle state on the Case row: **`In-progress`** → (**Send Actions** if any
Remediation Actions exist) **`Actions In Progress`** → **`Completed`**, or `In-progress`
→ (**Complete Case** when no actions) → `Completed` (ADR-0023). One button at the bottom
of **Summary** drives the transition, labelled **"Send Actions"** when actions exist and
**"Complete Case"** otherwise.
_Avoid_: State (overloaded), phase

**Reportable**:
The milestone at which a Case's **Answers** freeze and its **Outcome** snapshots
(`outcomeAtCompletion`, `hadRemediation`, `questionBankVersion` all stamped) — reached
when actions are **sent** (`Actions In Progress`) or, with no actions, when the Case is
**Completed**. Equivalently `status ∈ { Actions In Progress, Completed }`. Timestamped as
`reportableAt`. Past this point a newly-applicable **Question Definition** no longer
reopens the Case (ADR-0023). Distinct from `completedAt`, which marks final closure only.
_Avoid_: Frozen (describes the effect, not the milestone), Locked

**QA Check** _(shelved — see **Amended Outcome**)_:
Former separate `qa-{slug}` **Case** that meta-reviewed a **Completed Case** and could
append **Answer Overrides**. **Removed pre-go-live** (ADR-0026): QA is being re-designed
later, so the QA Check Case Types, the embedded override editor, and the cross-row write
are gone. Post-completion corrections are now the **Controls** role's case-level **Amended
Outcome**. Kept here only to redirect old references.
_Avoid_: reusing this in new work — there is no QA Check surface today.

**Case Details**:
The **Section** that displays the **Case Type**-specific descriptive fields that frame a Case — e.g. customer name, account numbers, relevant dates. The set of fields is declared per **Case Type**, so different types show different details. Read-only for every role and never hidden: visible to anyone who can open the Case. One of the six Sections (alongside Questions, Conversation, Notes, Remediation, Summary) and the default view on the case review page.
_Avoid_: Metadata, header, summary (the latter is now a distinct Section — see **Summary**)

**Section**:
One of the role-gated areas of a Case. Each Section has an access mode (`edit` /
`read-only` / `hidden`) resolved per viewer-role (ADR-0011), and a **Case Type** declares
per-Section config (membership + a `showInSummary` flag). As of the Jul 2026 workflow
changes the Section set is: `details` · `questions` · `issues` · `summary` ·
`remediation` · `notes` · `conversation` · `appealRequest` · `appealReview` ·
`amendOutcome`. The **Reviewer**'s tab row is **Case Details · Review · Issues · Summary ·
Remediation · Notes · Amend Outcome**, where "Review" is a UI label for the `questions`
Section. Two Sections that used to be one (ADR-0024): **Issues** _captures_ failed-Answer
detail + **Remediation Actions** (Reviewer-edit until **Reportable**); the standalone
**Remediation** Section _tracks_ each sent action to `complete`/`cancelled` (resolves
#144). **Amend Outcome** is the **Controls** surface for a case-level **Amended Outcome**
(ADR-0026, resolves #145) — it is _not_ the retired **Answer Override**. **Appeal Request**
and **Appeal Review** are the two ends of the **Appeal** flow (ADR-0027). Access modes are
`edit` / `read-only` / `hidden` only — the `override` mode is removed. **Conversation** is a
Section but not a tab — a floating overlay (ADR-0014). A Section that resolves to `hidden`
renders no tab, so the visible tab set differs by role (e.g. the **Adviser** sees only
Summary + Conversation).

**Summary**:
A read-only Section that rolls up the whole Case onto one page: the **Case Details** fields, pass/fail counts per question category, **Remediation Action** counts, each _failed_ **Answer** with its actions, key dates, and the computed **Outcome**. Composed from the other Sections by their per-Section `showInSummary` flag (**Notes** is excluded by default; **Case Details** is folded in, so the **Adviser**/Responsible Party needs no separate Details tab — ADR-0016). Never editable — only `read-only` or `hidden`. **Responsible Party gating widened** (ADR-0023): hidden while **`In-progress`**, visible `read-only` once the Case is **Reportable** (`Actions In Progress` _or_ `Completed`), so the Adviser can see the Summary while remediation is underway. Derivation is _hybrid_ and freezes at **Reportable**: live from current **Answers** while In-progress; once Reportable, the Outcome block reads the **Current Outcome** (`amendedOutcome?.outcome ?? outcomeAtCompletion`, ADR-0012/0026) while counts and the failed-Answer list recompute from the Case's frozen Answers, showing each action's `status`/`cancelReason` and the **Remediation Due Date**. **Outcome** is a block _within_ Summary, not its own Section or tab.
_Avoid_: Outcome (now a block inside Summary, not a standalone Section), Overview, Report

### Questions & answers

**Question Definition**:
The canonical question — stable ID, text, response type, options, conditional triggers, failure criteria, attached remediation actions. **Shared across Case Types**: the same definition can appear in many catalogues. Edits are live: in-progress Cases see updates immediately.
_Avoid_: Question (ambiguous between definition and instance), QuestionTemplate

**Question Bank**:
The curated, per-**Case Type** working set of **Question Definitions** — their text, response types, options, conditional triggers (`showWhen`), and failure criteria — assembled and edited in the question bank editor (`#/question-bank`) by **Case Type Owners**, then compiled into that Case Type's module and into its function-free **reporting export** (ADR-0015). One per Case Type.
_Avoid_: Catalogue (reserve for the runtime form — the bank joined to **Answers** to compute applicability), Question pool

**Applicable Question**:
A **Question Definition** that, given the current state of a Case's **Answers**, should be presented to the **Reviewer**. Computed live by evaluating conditional triggers — not a stored set.

**Answer**:
A **Reviewer**'s response to one **Question Definition** for one **Case**. Carries a value, an optional **Answer Justification**, and zero-to-many **Remediation Actions**.
_Avoid_: Response (overloaded — used in HTTP context elsewhere)

**Answer Justification**:
The per-**Answer** free-text rationale: why the **Reviewer** answered _one specific_ **Question Definition** the way they did. Lives inside the Answer (per-question scope). Always qualified — never the bare word "justification" — to keep it distinct from **Case Justification**.
_Avoid_: Justification (bare — ambiguous with Case Justification)

**Case Justification**:
A **case-level** free-text box in the **Notes** Section: the **Reviewer**'s overall rationale for the Case as a whole. Distinct from **Answer Justification** (which is per-question). One of the **Notes** Section's two fixed free-text boxes (the other being the general note); stored as its own plain-text field on the Case row (ADR-0007). Like the rest of Notes, deliberately excluded from the **Summary** Section.
_Avoid_: Justification (bare — ambiguous with Answer Justification)

**Remediation Action**:
A corrective action attached to a _failed_ **Answer**. A failed Answer can have many
Remediation Actions. Actions are _captured_ on the **Issues** Section through an **Issue
Capture Field** of type `actions` inside a **Issue Capture Group**, and _tracked_ to
resolution on the separate **Remediation** Section (ADR-0024). An action is a stateful
record `{ id, text, status: 'pending' | 'complete' | 'cancelled', cancelReason? }` — no
longer a bare string; `cancelReason` is required when `cancelled`. On **Send Actions** all
of a Case's actions acquire the case-level **Remediation Due Date**; the **Reviewer** (not
the **Responsible Party**) marks each `complete`/`cancelled` on the Remediation Section
during `Actions In Progress`.
_Avoid_: Remediation (ambiguous — refers to a Section, not the item)

**Remediation Due Date**:
A single **case-level** SLA date on the Case row (`remediationDueDate`), = **Reportable**
date + **10 working days**, stamped once when the **Reviewer** clicks **Send Actions**
(ADR-0024). Working days exclude weekends and public holidays from a maintained list
(ADR-0025). One date per Case (all actions share it), not per action; never recomputed
after it is set.
_Avoid_: Deadline, SLA (bare — reserve for the policy, not the concrete date)

**Issue**:
UI-only term for a **failed Answer** (a question whose value meets its failure criteria). Not a separate entity: an "Issue" _is_ a failed Answer. The **"Issues"** tab lists the Case's failed Answers; selecting one shows that Issue's **Issue Capture Group**s — the per-**Case Type** configured, collapsible groups of **Issue Capture Field**s, which now subsume **Attributed Party** (a `person` field) and **Remediation Actions** (an `actions` field) alongside free-form fields. Used because "the Issues for this Case" reads more naturally to **Reviewer**s than "the failed Answers".
_Avoid_: Issue as a distinct stored thing — there is no Issue record; it is a failed Answer viewed through the Issues Section.

**Issue Capture Group**:
A presentation-only container that groups **Issue Capture Field**s on the **Issues** Section, declared once per **Case Type** (`captureGroups`, ADR-0004). Each group has a label, a default `collapsed` state, and an ordered list of Issue Capture Fields. Grouping is _purely visual_ — it is **not** part of storage (Issue Capture Field values are stored flat by field key, so an Owner can move a field between groups without migrating data). Collapse/expand is **ephemeral UI state**, not persisted per Answer or **Reviewer**. Applies only to _failed_ **Answer**s (one Group set per Issue). Other Case Types declare different (or overlapping) Groups; some declare none.
_Avoid_: Section (the tab/area concept — a Issue Capture Group is not a Section), Field Group, Detail Group

**Issue Capture Field**:
A single configured input recorded against a _failed_ **Answer** (an **Issue**), one of the closed type set `text | textarea | select | radio | person | actions`. Declared inside a **Issue Capture Group** per **Case Type**; field keys are **unique within a Case Type**. Values are stored flat in `Answer.capture: Record<fieldKey, string | {loginName,displayName} | Action[]>` in the Answers JSON blob (ADR-0007), sharing the failed-Answer lifecycle (ADR-0013): **stripped** when the Answer is no longer a failure, **frozen** once the Case is **Completed**. A field may carry an **intra-group `showWhen`** (references a _sibling_ field's value on the same Answer); a hidden field's value is stripped and starts empty if it becomes visible again. `required` gates Case **completion** only while the field is _visible_. May carry an optional semantic `role` (e.g. `attributedParty`, `remediationOwner`) so cross-Case-Type reporting can find it regardless of its per-Case-Type key — _deferred, not yet built_. **Supersedes Remediation Detail**: the previously first-class **Attributed Party** (a `person` field) and **Remediation Action** set (an `actions` field) are now Issue Capture Fields of the corresponding type — there is one capture engine, not three special cases.
_Avoid_: Remediation Detail (too narrow — fields are no longer only about remediation), Custom field (overloaded), Metadata

**Remediation Detail** _(superseded)_:
Former name for a single configurable extra capture field on a failed **Answer** (ADR-0017, flat `remediationFields`, `Record<string,string>`). Replaced by **Issue Capture Field** / **Issue Capture Group** once attribution and actions were unified into one typed, grouped, conditional capture engine. Kept here only to redirect old references.

### People

**Reviewer**:
A SharePoint user with the Reviewer capability — held via the functional `Reviewers`
group **or** any per-Case-Type `Reviewers - <type>` list-access group, which _implies_ it
(ADR-0022). Eligible to be assigned **Cases** and produce **Answers**. Group membership
alone does not grant edit access to any particular Case — that's the **Assigned
Reviewer**. The reviewing side has a base role (**Reviewer**) and an elevated role
(**Case Type Owner**), mirroring the frontline side (**Adviser** → **Journey Owner**).
_Avoid_: Assessor, evaluator

**Assigned Reviewer**:
The single **Reviewer** currently assigned to a specific **Case** (the Case row's reviewer field). The role that grants edit access to that Case's **Answers**, **Conversation**, **Notes** and **Remediation Actions**. Reassignment is a single-user-field update; history comes from SharePoint's list version history, not stored explicitly.
_Avoid_: Owner (of the case), primary reviewer, lead

**Responsible Party**:
The SharePoint user whose work is being reviewed (e.g., the agent on a call being
assessed) — an **Adviser** by group membership, named on one specific **Case**. Distinct
from the **Reviewer**. One per **Case**. Distinct from an **Attributed Party** (which is
per-failure, not per-Case). The **Assigned Reviewer** _sets_ the Responsible Party in-app,
at the bottom of the **Issues** Section, before **Send Actions**; it cannot be changed
after send (ADR-0024). Once actions are sent the Responsible Party gains `read-only`
**Summary** and `edit` **Conversation** access (the only two Sections they see), and does
the remediation work off-system, communicating via the Conversation.
_Avoid_: Subject, owner (ambiguous), reviewee

**Adviser**:
The **frontline base role** — a SharePoint user in the `Advisers` group, eligible to be
named as a **Case**'s **Responsible Party** (ADR-0022). "Adviser" is the business word for
this population; **Responsible Party** remains the per-Case role name (the Adviser
_assigned to_ a Case), mirroring **Reviewer** vs **Assigned Reviewer**. Replaces the old
`CR-ResponsibleParty` / `Frontline - Complaints` groups.
_Avoid_: Responsible Party (that is the per-Case role, not the group), Agent (call-centre-specific)

**Journey Owner**:
The **elevated frontline role** for a **Case Type** — a SharePoint user in
`JourneyOwner - <type>` (ADR-0022). Sees the **Summary** of _every_ Case of their case
type(s) (a cross-case reach beyond a single Case's access, ADR-0027) and, where the Case
Type configures `appeal.raisedBy: 'journeyOwner'`, raises **Appeals** on the **Appeal
Request** Section. The frontline counterpart to the **Case Type Owner**. Not a Case Type
Owner (does not edit the Question Bank).
_Avoid_: Case Type Owner (the reviewing-side elevated role), Frontline Manager

**Controls**:
A SharePoint user in the `Controls` group. **Resolves Appeals** (agree/reject with
rationale) on the **Appeal Review** Section and authors the case-level **Amended Outcome**
on the **Amend Outcome** Section (ADR-0026/0027). **Replaces the QA Reviewer** for
post-completion outcome changes; the QA Check / **Answer Override** machinery is retired.
_Avoid_: QA Reviewer (retired), Auditor, Checker

**Attributed Party**:
The single SharePoint user identified as responsible for one specific _failed_ **Answer**. Optional and zero-or-one per failed Answer. Distinct from the **Responsible Party**: a Case has exactly one Responsible Party (whose work is under review), but multiple people may have had a hand in the process, and any single failure may be attributed to a different person. Stored inside the Answer as a bare account name plus a cached display name (`{ loginName, displayName }`); the claims prefix and AD domain are single constants reattached at lookup time. Resolved to an authoritative display name at page load via the User Profile read (`GetPropertiesFor`), with the cached name as fallback. Settable only by the **Assigned Reviewer**, only when the **Case Type** enables `attributeFailures`, and frozen once the Case is **Completed**. Stripped automatically when its Answer is no longer a failure. Does not affect the **Outcome**. As of the capture-engine unification, attribution is no longer a dedicated `attributedParty` Answer property: it is expressed as an **Issue Capture Field** of type `person` (optionally tagged `role: 'attributedParty'`), often shown conditionally via `showWhen` (e.g. Case Type A reveals it only when "Originator" = Distribution). The `{loginName, displayName}` storage and strip/freeze lifecycle are unchanged; only its declaration and storage location moved into `captureGroups` / `Answer.capture`.
_Avoid_: Responsible Party (case-level, a different concept), Owner, Culprit, Blame, Assignee

**Reviewer Manager**:
A SharePoint user in the Reviewer Managers **SharePoint Group** who manages a team of **Reviewers**. Sees the `#/reports/reviewer-team` report — their team's completed-Case volumes (7- and 30-day) and current assigned-Case queue health (outstanding, overdue), totalled and broken down by **Case Type**. The relationship "Reviewer X is managed by Reviewer Manager Y" is denormalised onto every **Case** row as `assignedReviewerManager` (a user field) so reports can be queried via a single server-side `$filter` per **Case Type** list. A user is either a Reviewer Manager _or_ a **Responsible Party Manager**, never both — enforced by Maintainer convention, not code.
_Avoid_: Team Lead, Reviewer Supervisor

**Responsible Party Manager**:
A SharePoint user in the Responsible Party Managers **SharePoint Group** who manages a team of **Responsible Parties** (e.g. the line manager of a group of call-centre agents being assessed). Sees the `#/reports/responsible-party-team` report — a 12-calendar-month view of their team's assessed Cases, broken down by pass / fail / had-remediation, totalled and per-Responsible-Party. The relationship "Responsible Party X is managed by Responsible Party Manager Y" is denormalised onto every **Case** row as `responsiblePartyManager` (a user field). Mutually exclusive with **Reviewer Manager**.
_Avoid_: Line Manager (overloaded), RP Manager (jargon abbreviation)

**Case Type Owner**:
The **elevated reviewing role** for a **Case Type** — a SharePoint group `CaseTypeOwner -
<type>` (ADR-0022) that "owns" the type and sees aggregate dashboard stats for it
(outstanding, overdue, completed today / last 7 days). Case Type Owners are the **authors**
of Question Bank changes — they propose additions, edits, and deprecations via the question
bank editor; Maintainers confirm (publish) those changes but do not author them. The
reviewing-side counterpart to the frontline-side **Journey Owner**; distinct from it (a
Case Type Owner does not raise Appeals or see all cases' Summaries by that power).

**QA Reviewer** _(retired — see **Controls**)_:
Former standalone role that selected **Completed Cases** for **QA Check** and authored
**Answer Overrides**. **Shelved pre-go-live** (ADR-0026): the QA Check and Answer Override
machinery is removed and post-completion outcome changes are now the **Controls** role's
**Amended Outcome**. QA will be re-designed later; this entry is kept only to redirect old
references.
_Avoid_: using this role in new work — use **Controls**.

**Maintainer**:
A platform administrator responsible for deploying and configuring the framework. When Question Bank changes are authored by a **Case Type Owner**, the Maintainer's role is to confirm (publish) the changes — not to author or approve them. Maintainers also handle SharePoint list/group provisioning and code deployments.
_Avoid_: Admin (overloaded with SharePoint admin), developer

**Visitor**:
A SharePoint user who is authenticated (browser NTLM/Kerberos passes) but does not belong to any named Case Review **SharePoint Group** — not a **Reviewer** (incl. any `Reviewers - <type>`), **Adviser**, **Reviewer Manager**, **Responsible Party Manager**, **Case Type Owner**, **Journey Owner**, **Controls**, or **Maintainer**. Cannot be an **Assigned Reviewer**, cannot produce **Answers**, has no ownership or management responsibilities. The `#/` landing page shows a Visitor a read-only explainer only — _no_ access-request affordance, because access is granted out-of-band via the team's centralised hierarchy record, outside this app; all other routes are inaccessible (enforced by SharePoint list ACLs, surfaced as UX by capability checks). Visitor is _derived_ from the absence of all other group memberships — there is no "Visitors" SharePoint group.
_Avoid_: Guest (collides with SharePoint's external-guest concept), Unenrolled (jargon), Anonymous (the user _is_ authenticated)

### Review of the review

**Appeal**:
A case-level objection to a **Completed Case**'s **Current Outcome**. **Raised** by a
_per-Case-Type-configured_ role (ADR-0027): the **Journey Owner** for Complaints
(`appeal.raisedBy: 'journeyOwner'`), defaulting to the **Responsible Party Manager** for
other types — via the **Appeal Request** Section. **Resolved** by **Controls** on the
**Appeal Review** Section. Stored as an additive `appeals[]` JSON blob on the original Case
row (ADR-0007); never mutates the frozen original. Lifecycle `raised → underReview →
resolved`, where resolved is `agreed | rejected`. Carries the **appellant's rationale**
(required on raise) and the **resolver's rationale** (required on resolve). May _cite_
specific failed **Answers**, but does not itself set Answer values. **Agreeing** means
Controls accepts the outcome was wrong and then authors a case-level **Amended Outcome**
(linked to the Appeal id); **rejecting** records rationale and changes nothing. At most one
open Appeal per Case; after resolution a new Appeal may be raised (full history kept).
_Avoid_: Dispute, Complaint, Grievance, Challenge

### Communication

**Conversation**:
The thread between **Reviewer** and **Responsible Party** for one **Case**. Stored as a JSON array of **Messages** in a single plain-text field on the Case row.

**Message**:
One entry in a **Conversation** — author, timestamp, body.

### Outcome

**Outcome**:
The computed verdict for a **Case**, derived by the **Case Type**'s algorithm from the Case's **Answers**. No longer has its own Section or tab — it is rendered as one block _within_ the **Summary** Section (the `computeOutcome` function and `cora-outcome` rendering survive; the standalone Outcome tab and its ADR-0011 matrix row do not). The _live_ Outcome is always re-derivable from Answers — it is not a stored entity. However, a **snapshot** (`outcomeAtCompletion`) is stamped onto the Case row at the moment the Case becomes a **Completed Case**, to support historical reporting. The snapshot is frozen: it is not updated if Question Definitions or the outcome function change afterwards. A pass Outcome implies no **Remediation Actions** were attached (Remediation Actions only attach to failed Answers, and a failing Answer cannot yield a pass Outcome). After completion, the Outcome may be displaced (not mutated) by a case-level **Amended Outcome** authored by **Controls** — see **Amended Outcome** and **Current Outcome**.

**Amended Outcome**:
A post-completion, **case-level** correction of a **Completed Case**'s **Outcome**,
authored by **Controls** on the **Amend Outcome** Section (ADR-0026, resolves #145).
Unlike the retired **Answer Override**, this is an **explicit, hand-set verdict**: Controls
chooses the new **Outcome** value directly, with a mandatory **justification**. Stored as
`amendedOutcome: { outcome, justification, amendedBy, amendedAt } | null` on the Case row —
additive, so the frozen `outcomeAtCompletion` and Answers are never mutated. `amendedBy` /
`amendedAt` are captured explicitly for **audit** (not mined from SharePoint version
history). Typically follows an **agreed Appeal** but does not require one. Drives the
`effectiveOutcome` reporting column (ADR-0019). This deliberately relaxes the old "Outcome
is always derived, never hand-set" rule — for amended Cases only.
_Avoid_: Answer Override (retired), Outcome Override, Amendment (bare), Revised Outcome

**Answer Override** _(retired — see **Amended Outcome**)_:
Former per-**Answer** post-completion correction with the **Current Outcome** re-derived
over **Effective Answers**. **Removed pre-go-live** (ADR-0026) together with the **QA
Check**; replaced by the case-level **Amended Outcome**. Kept only to redirect old
references.
_Avoid_: using in new work — use **Amended Outcome**.

**Effective Answers** _(retired)_:
Former concept: the frozen **Answers** with **Answer Override**s applied, used to re-derive
the **Current Outcome**. Gone with Answer Override (ADR-0026) — there is no per-Answer
override layer now; the corrected verdict is the **Amended Outcome** directly.
_Avoid_: using in new work.

**Effective Answers**:
The set of **Answers** for a **Case** with every **Answer Override** applied over the frozen original — the input to the **Current Outcome**. The original frozen Answers remain available alongside, so any view can show original-vs-override per question.

**Current Outcome**:
The Outcome in force now: `amendedOutcome?.outcome ?? outcomeAtCompletion` (ADR-0026).
Where no **Amended Outcome** exists it equals the frozen snapshot; where one exists, the
Controls-set value takes precedence. Shown in the **Summary** Outcome block and carried by
the `effectiveOutcome` reporting column.
_Avoid_: Overridden Outcome, Amended Outcome (that is the _record_; Current Outcome is the effective value)

## Relationships

- A **Case** belongs to exactly one **Case Type**.
- A **Case Type** has one **Question Bank**, compiled into its module and into its reporting export.
- A **Case Type** references many **Question Definitions** (a catalogue).
- A **Question Definition** can appear in many **Case Types**.
- A **Case** has many **Answers**, one per **Applicable Question**.
- An **Answer** has zero-to-many **Remediation Actions**.
- A _failed_ **Answer** has zero-or-one **Attributed Party**.
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
- "Outcome" was nearly modeled as a stored entity — resolved as a _computed_ property of a Case.
- "Reviewer" was being used for both group membership and per-Case assignment — resolved as **Reviewer** (group) vs **Assigned Reviewer** (per-Case role). See ADR-0011.
- "Visitor" is _derived_ (absence of all named-group memberships), not a SharePoint group — consistent with ADR-0010, capability flags are UX-only and the real boundary is SharePoint list ACLs.
- "Question Bank" vs "catalogue" — both name a Case Type's set of **Question Definitions**. Resolved: **Question Bank** is the _authoring_ form (edited in `#/question-bank`, compiled to a module + reporting export); _catalogue_ is the _runtime_ form (the same questions joined to **Answers** to compute applicability). One concept, two lifecycle stages.
