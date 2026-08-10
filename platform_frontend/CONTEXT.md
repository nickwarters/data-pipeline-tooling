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

**Case Reference**:
The **Case**'s human-facing identifier — what a person quotes when they ask where a Case
is. Held in the `Title` column, which exists for nothing else, and searchable **by prefix
only**: an unanchored contains cannot be served from a column index, so the app never
offers one.

Uniqueness is scoped to the **Case Type**: each Case Type has its own list and its own
numbering, so two Case Types may hold the same Reference and a Reference on its own does
not identify a Case across the app — the pair (Case Type, Reference) does. _This is an
assumption to confirm with the business, not an observed rule._

The Reference **is** the `Title`. Where a Case row carries no Title the Case tables fall
back to showing its `id`, which is a display-only degradation and not a second kind of
Reference: a Case shown by `id` has no Reference, and the prefix filter can never find it.
_Avoid_: Case number, ID (the `id` is the SharePoint row key, not the Reference)

**In-progress Case**:
A **Case** with one or more applicable unanswered **Question Definitions**. Cannot be marked complete.

**Completed Case**:
A **Case** in the terminal `Completed` **status** with a `completedAt` timestamp. Reaching
it requires every applicable **Question Definition** to have an **Answer** _and_ either no
**Remediation Actions** exist (the Reviewer clicks **Complete Case** directly, which
requires every _failed_ Answer to carry an explicit **Remediation Required** decision) or
every sent action has been resolved on the **Remediation** Section (the actions path — see
**Case Status** and **Reportable**). Not the same as **Reportable**: on the
actions path a Case is Reportable (its Answers frozen, Outcome snapshotted) at **Send
Actions**, then only later Completed.
_Avoid_: Closed, finished, done

**Void Case**:
A **Case** in the terminal `Void` **status**: abandoned before it could be reviewed to a
conclusion, and stamped with a **Void Reason**, `voidedAt` and `voidedBy` (the account of
whoever voided it). Voided by its **Assigned Reviewer** alone, from `In-progress` or
`Actions In Progress`, through a two-step control that names the consequences and demands
a reason. **Deliberately carries no Outcome** — it is not reviewed work and must not count
as any — and there is no un-void: a Case voided in error is raised again. Its Answers,
Issues and Notes freeze, and its **Conversation** stops accepting messages for everyone —
a terminal **status** (`Void` or `Completed`) closes the thread regardless of the
**Case Type**'s `allowMessagesWhen` gate, which only chooses when the thread is open
during a live review.
_Avoid_: Cancelled, deleted, closed (a Case is never removed — voiding is a status)

**Void Reason**:
Why a **Case** was voided, chosen from a framework-owned vocabulary of six —
_Duplicate of another Case_, _Raised in error_, _Out of scope for review_, _Evidence
unavailable_, _Superseded by another Case_, _Withdrawn by the business_. A **Case Type**
may narrow which of them it offers (`voidReasons`) but may not add one: the **Reviewer
Manager**'s report groups reasons across Case Types, which only means something while a
key means the same everywhere. Stored as the key; a key no longer in the vocabulary
renders as itself rather than blank.
_Avoid_: Void code, cancellation reason

**Case Status**:
The lifecycle state on the Case row: **`In-progress`** → (**Send Actions** if any
Remediation Actions exist) **`Actions In Progress`** → **`Completed`**, or `In-progress`
→ (**Complete Case** when no actions) → `Completed`. One button at the bottom
of **Summary** drives the transition, labelled **"Send Actions"** when actions exist and
**"Complete Case"** otherwise. A third, terminal exit leaves either live status: **`Void`**
(see **Void Case**), reached from the Void control beside that button and never returned
from.
_Avoid_: State (overloaded), phase

**Reportable**:
The milestone at which a Case's **Answers** freeze and its **Outcome** snapshots
(`outcomeAtCompletion`, `hadRemediation`, `questionBankVersion` all stamped) — reached
when actions are **sent** (`Actions In Progress`) or, with no actions, when the Case is
**Completed**. Equivalently `status ∈ { Actions In Progress, Completed }`. Timestamped as
`reportableAt`. Past this point a newly-applicable **Question Definition** no longer
reopens the Case. Distinct from `completedAt`, which marks final closure only.

A **Void Case** is frozen but was **not** necessarily Reportable: voiding freezes the
Answers without stamping an Outcome, so "the Answers are frozen" (`isFrozen`) and "a
snapshot was taken" (`reachedReportable` — Reportable, or Void with a `reportableAt`) are
two questions now. A Case voided from `Actions In Progress` reached the milestone and
keeps everything stamped at it; a Case voided from `In-progress` never did and has no
Outcome at all.
_Avoid_: Frozen (describes the effect, not the milestone), Locked

**QA Check** _(shelved — see **Amended Outcome**)_:
Former separate `qa-{slug}` **Case** that meta-reviewed a **Completed Case** and could
append **Answer Overrides**. **Removed pre-go-live**: QA is being re-designed
later, so the QA Check Case Types, the embedded override editor, and the cross-row write
are gone. Post-completion corrections are now the **Controls** role's case-level **Amended
Outcome**. Kept here only to redirect old references. The **Amendment Reason** labelled
_QA Check_ is unrelated display copy for one reason an amendment may be filed under; it
does not revive this Case Type.
_Avoid_: reusing this in new work — there is no QA Check surface today.

**Case Details**:
The **Section** that displays the **Case Type**-specific descriptive fields that frame a Case — e.g. customer name, account numbers, relevant dates. The set of fields is declared per **Case Type**, so different types show different details. Read-only for every role and never hidden: visible to anyone who can open the Case. One of the six Sections (alongside Questions, Conversation, Notes, Remediation, Summary) and the default view on the case review page.
_Avoid_: Metadata, header, summary (the latter is now a distinct Section — see **Summary**)

**Section**:
One of the role-gated areas of a Case. Each Section has an access mode (`edit` /
`read-only` / `hidden`) resolved per viewer-role, and a **Case Type** declares
per-Section config (membership + `showInSummary`, which is either a flag or a list of
the roles the Summary block is composed for). As of the Jul 2026 workflow
changes the Section set is: `details` · `questions` · `issues` · `summary` ·
`remediation` · `notes` · `conversation` · `appealRequest` · `appealReview` ·
`amendOutcome`. A Section's display copy is one per-Section descriptor carrying
two spellings — a `tab` caption and a `heading` — which a **Case Type** may
rename via `sectionLabels` (`src/lib/section-labels.js`). The **Reviewer**'s tab
row is **Details · Review · Issues · Remediation · Summary · Notes · Amend
Outcome**; the `questions` Section is tabbed **Review** but headed
**Questions**, and `details` is tabbed **Details** but headed **Case Details**.
Two Sections that used to be one: **Issues** _captures_ failed-Answer
detail + **Remediation Actions** (Reviewer-edit until **Reportable**); the standalone
**Remediation** Section _tracks_ each failed Answer's remediation to a **Remediation
Resolution** (resolves #144), and shows the same breakdown — without the Reviewer's
fields, and with a pointer to the **Conversation** — to the **Responsible Party**, their
**Manager** and the **Journey Owner**. **Amend Outcome** is the **Controls** surface for a case-level **Amended Outcome**
— it is _not_ the retired **Answer Override**. **Appeal Request**
and **Appeal Review** are the two ends of the **Appeal** flow. Access modes are
`edit` / `read-only` / `hidden` only — the `override` mode is removed. **Conversation** is a
Section but not a tab — a floating overlay. A Section that resolves to `hidden`
renders no tab, so the visible tab set differs by role (e.g. the **Adviser** sees only
Summary + Conversation).

**Summary**:
A read-only Section that rolls up the whole Case onto one page: the **Case Details** fields, pass/fail counts per **Question Group**, **Remediation Action** counts, each _failed_ **Answer** with its actions, key dates, and the computed **Outcome**. Composed from the other Sections by their per-Section `showInSummary`, either a flag or a list of the roles that block is composed for — a role list can only narrow, since the Section's access mode is checked first (**Notes** is excluded by default; **Case Details** is folded in, so the **Adviser**/Responsible Party needs no separate Details tab). Never editable — only `read-only` or `hidden`. **Responsible Party gating widened**: hidden while **`In-progress`**, visible `read-only` once the Case is **Reportable** (`Actions In Progress` _or_ `Completed`), so the Adviser can see the Summary while remediation is underway. Derivation is _hybrid_ and freezes at **Reportable**: live from current **Answers** while In-progress; once Reportable, the Outcome block reads the **Current Outcome** (`amendedOutcome?.outcome ?? outcomeAtCompletion`) while counts and the failed-Answer list recompute from the Case's frozen Answers, showing each action's `status`/`cancelReason` and the **Remediation Due Date**. **Outcome** is a block _within_ Summary, not its own Section or tab.
_Avoid_: Outcome (now a block inside Summary, not a standalone Section), Overview, Report

### Questions & answers

**Question Definition**:
The canonical question — stable ID, text, response type, options, conditional triggers, failure criteria, attached remediation actions. It is owned by one per-**Case Type** Question Bank text artifact in SharePoint and loaded through that Case Type's config. A stable definition ID may be reused deliberately, but there is no shared Question Definitions list or runtime join. In-progress Cases use the current published artifact when reloaded; reportable Cases resolve their stamped version.
_Avoid_: Question (ambiguous between definition and instance), QuestionTemplate

**Question Bank**:
The curated, per-**Case Type** working set of **Question Definitions** — their text, response types, options, conditional triggers (`showWhen`), and failure criteria — assembled and edited in the question bank editor (`#/question-bank`) by **Case Type Owners**, then compiled into that Case Type's module and into its function-free **reporting export**. One per Case Type.
_Avoid_: Catalogue (reserve for the runtime form — the bank joined to **Answers** to compute applicability), Question pool

**Question Group**:
The inner of the two grouping levels on a **Question Definition** (`questionGroup` — what the `category` field meant before #390). Progress counts, **Summary** pass/fail counts, and the bulk **Group Outcome** all operate per Question Group. Optional; ungrouped questions fall back to `General` on the case review page and `Uncategorised` in the bank editor.
_Avoid_: Section (reserved for the role-gated tab areas), Category (now the level above)

**Category**:
The top, presentation-only grouping level on a **Question Definition** (`category`, #390). Displayed to **Reviewers** under whatever name the **Case Type** gives it (e.g. "COGG Section") as a heading above its nested **Question Groups**. Never touches applicability or the **Outcome**. Optional.
_Avoid_: COGG Section (a per-Case-Type display label, not a code/domain term), Section

**General Question**:
A **Case Type**-configured field a **Reviewer** answers on the Review tab above or beneath every **Applicable Question** (`generalQuestionsPlacement`, default beneath), behind a rule and its own section title (`generalQuestions` in the Case Type module, using a subset of the **Issue Capture Field** type vocabulary: `text`, `textarea`, `select`, `radio` — the subset whose answer is a plain string, since `person` needs per-field people-search state the Review tab does not carry). A Case Type builds its list with `resolveGeneralQuestions()`, including **shared General Questions** by key from `case-types/general-questions.js` and declaring anything Case Type-specific inline beside them; a shared question's key is fixed by the catalogue, so the same question means the same answer key in every Case Type and cannot be reworded per Case Type. Deliberately _not_ outcome-driving: General Questions carry no `showWhen` and no failure criteria, and their answers — namespaced `general:<key>` in the Case's **Answer** blob — reach no evaluator, so applicability, **Question Group** progress, completion gating and the **Outcome** are all unaffected. Answered General Questions also roll up read-only on the Summary tab (same `generalQuestionsPlacement` side, unanswered ones omitted), so the **Case Type Owner** reads what the Reviewer wrote. Both tabs render the _configured_ fields, so removing a General Question from a **Case Type** hides answers already given to it: the `general:<key>` entries stay in the **Answer** blob (the pruning loop leaves non-catalogue keys alone) but appear nowhere in the UI — restoring the field with the same key brings them back. Never a **Question Definition**: General Questions do not live in the **Question Bank** and are not editable in the bank editor.
_Avoid_: General Question Group (collides with the `General` fallback **Question Group**), Free-text question, Metadata question

**Group Outcome**:
The bulk-marking control on a **Question Group** a **Case Type** has opted in — Case Type-wide with `allowBulkOutcome: true`, per group with `questionGroups: { <group>: { allowBulkOutcome: true } }`, where a group's own setting overrides the Case Type-wide one in either direction. One selection — a configured **Outcome** wording or N/A — writes that value to every applicable, non-deprecated `outcome`-type **Question Definition** in the group, through the normal **Answer** path. A write shortcut, not a lock: no group-level state is stored on the Case, and each Answer stays individually editable afterwards. Never the Case's **Outcome**: this writes Answers, and the Outcome is then re-derived from them like any other Answer change — a Group Outcome is a way of answering, not a way of scoring.
_Avoid_: Group Verdict (the former name), Bulk outcome, Group answer

**Applicable Question**:
A **Question Definition** that, given the current state of a Case's **Answers**, should be presented to the **Reviewer**. Computed live by evaluating conditional triggers — not a stored set.

**Answer**:
A **Reviewer**'s response to one **Question Definition** for one **Case**. Carries a value, an optional **Answer Justification**, and zero-to-many **Remediation Actions**.
_Avoid_: Response (overloaded — used in HTTP context elsewhere)

**Answer Justification**:
The per-**Answer** free-text rationale: why the **Reviewer** answered _one specific_ **Question Definition** the way they did. Lives inside the Answer (per-question scope). Always qualified — never the bare word "justification" — to keep it distinct from **Case Justification**.
_Avoid_: Justification (bare — ambiguous with Case Justification and Amendment Justification)

**Case Justification**:
A **case-level** free-text box in the **Notes** Section: the **Reviewer**'s overall rationale for the Case as a whole. Distinct from **Answer Justification** (which is per-question). One of the **Notes** Section's two fixed free-text boxes (the other being the general note); stored as its own plain-text field on the Case row. Like the rest of Notes, deliberately excluded from the **Summary** Section.
_Avoid_: Justification (bare — ambiguous with Answer Justification and Amendment Justification)

**Remediation Action**:
A corrective action attached to a _failed_ **Answer**. A failed Answer can have many
Remediation Actions. Attaching any of them is preceded by the **Remediation Required**
decision: the controls below only render once the **Reviewer** has answered _Yes_. Actions
are _captured_ on the **Issues** Section — the **Reviewer**
ticks the ones the **Question Definition** configures (`answer.remediationActions`) and may
add free-form text (`answer.freeFormRemediation`) — and the resulting remediation is
_tracked_ to resolution on the separate **Remediation** Section, **per Question rather
than per action** (see **Remediation Resolution**). On **Send Actions** all of a Case's
actions acquire the case-level **Remediation Due Date**. The `actions`-typed **Issue Capture Field** — whose stateful
`{ id, text, status, cancelReason? }` records were once the store for this — is
declared by no live Case Type and read by nothing: neither the **Remediation**
Section nor the **Summary**'s remediation block renders such a record.
_Avoid_: Remediation (ambiguous — refers to a Section, not the item)

**Remediation Required**:
The **Reviewer**'s explicit decision, per _failed_ **Answer**, on whether the failure needs
**Remediation Actions** at all. Three states — `yes`, `no`, and **absent** (undecided) —
stored on the Answer as `remediationRequired`, deliberately not a boolean so that "not yet
decided" survives serialisation. Recorded on the **Issues** Section ("Is remediation
required?"); `yes` reveals the Remediation Action controls, `no` hides them and clears
anything already recorded, so an Answer marked `no` never carries remediation. `No` needs
no justification. A Case cannot leave **`In-progress`** while any applicable failed
Question is undecided, or while a `yes` records no action and no free-form text on a
Question that offers either — the
pre-send counterpart of **Remediation Resolution**'s hold on the close. Shares the failed-
Answer lifecycle: stripped when the Answer stops failing.
_Avoid_: Remediation flag, Needs remediation (bare — it is a recorded decision, not a
derived property)

**Remediation Resolution**:
How the **Reviewer** records that a _failed_ **Answer**'s remediation ended up, on the
**Remediation** Section once the actions have been sent: **`complete`**, **`partial`**
(partially complete) or **`cancelled`**. Recorded **per Question**, not per **Remediation
Action** — one row per applicable, failed Question that carries remediation; failed
Questions with no remediation attached never appear, because attaching actions is
optional. `partial` requires _details_ and `cancelled` requires a _justification_ (both
stored in the same `details` field); `complete` carries neither. Stored on the Answer as
`remediationStatus: { status, details? }`. A row is **resolved** only once it has a status
_and_ any text that status requires, and the Case cannot reach **Completed** while any row
is unresolved. Only the **Assigned Reviewer** writes it; everyone who can see the Section
reads the same breakdown.
A **Case Type may offer a subset** of the three via `remediationStatuses` (Complaints
offers `complete` and `cancelled` only). The narrowing is display-only: what is **stored**
is always validated against the full framework vocabulary, so a row resolved before its
Case Type narrowed its offer keeps that resolution.
_Avoid_: Action status (that is the separate `actions`-capture-field record), Sign-off

**Overdue**:
A **Case** past its review due date (`dueDate` on the Case row) while it is
still under review — i.e. not yet
**Reportable**, which in status terms is `In-progress` alone. Derived, never
stored: no column holds it, every surface re-derives it from the row's status and
Due Date, and a row that carries an `overdue` value has had it derived on read.
Once the Case is Reportable the review clock stops and says nothing further about
it — the **Remediation Due Date** governs the `Actions In Progress` phase, and a
Case past _that_ date is "past its Remediation Due Date", a different statement
about a different clock.
_Avoid_: Late, breached (reserve "breach" for the imminent-breach look-ahead),
"overdue" for the remediation clock (say **past its Remediation Due Date**)

**Remediation Due Date**:
A single **case-level** SLA date on the Case row (`remediationDueDate`), = **Reportable**
date + **10 working days**, stamped once when the **Reviewer** clicks **Send Actions**.
Working days exclude weekends and public holidays from a maintained list. One date per
Case (all actions share it), not per action; never recomputed after it is set.
_Avoid_: Deadline, SLA (bare — reserve for the policy, not the concrete date)

**Issue**:
UI-only term for a **failed Answer** (a question whose value meets its failure criteria). Not a separate entity: an "Issue" _is_ a failed Answer. The **"Issues"** tab lists the Case's failed Answers; selecting one shows that Issue's **Issue Capture Group**s — the per-**Case Type** configured, collapsible groups of **Issue Capture Field**s, which now subsume **Attributed Party** (a `person` field) alongside free-form fields. **Remediation Actions** are not among them: they keep their own controls on the same Section. Used because "the Issues for this Case" reads more naturally to **Reviewer**s than "the failed Answers".
_Avoid_: Issue as a distinct stored thing — there is no Issue record; it is a failed Answer viewed through the Issues Section.

**Issue Capture Group**:
A presentation-only container that groups **Issue Capture Field**s on the **Issues** Section, declared once per **Case Type** (`captureGroups`). Each group has a label, a default `collapsed` state, and an ordered list of Issue Capture Fields. Grouping is _purely visual_ — it is **not** part of storage (Issue Capture Field values are stored flat by field key, so an Owner can move a field between groups without migrating data). Collapse/expand is **ephemeral UI state**, not persisted per Answer or **Reviewer**. Applies only to _failed_ **Answer**s (one Group set per Issue). Other Case Types declare different (or overlapping) Groups; some declare none.
_Avoid_: Section (the tab/area concept — a Issue Capture Group is not a Section), Field Group, Detail Group

**Issue Capture Field**:
A single configured input recorded against a _failed_ **Answer** (an **Issue**), one of the closed type set `text | textarea | select | radio | person`. Declared inside a **Issue Capture Group** per **Case Type**; field keys are **unique within a Case Type**. Values are stored flat in `Answer.capture: Record<fieldKey, string | {loginName,displayName} | Action[]>` in the Answers JSON blob — a `person` field's `{loginName, displayName}` pair is always directory-resolved, chosen from the people picker's search results, since typed text is never offered as an account — sharing the failed-Answer lifecycle: **stripped** when the Answer is no longer a failure, **frozen** once the Case is **Completed**. A field may carry an **intra-group `showWhen`** (references a _sibling_ field's value on the same Answer); a hidden field's value is stripped and starts empty if it becomes visible again. `required` gates Case **completion** only while the field is _visible_. May carry an optional semantic `role` (e.g. `attributedParty`, `remediationOwner`) so cross-Case-Type reporting can find it regardless of its per-Case-Type key — _deferred, not yet built_. The previously first-class **Attributed Party** is now a `person` field — there is one capture engine, not two special cases. `actions` is **not** a declarable type: the verify gate rejects it, and the `Action[]` arm of the stored shape describes values already on disk, not something a Case Type can declare today.
_Avoid_: Remediation Detail (too narrow — fields are no longer only about remediation), Custom field (overloaded), Metadata

**Remediation Detail** _(superseded)_:
Former name for a single configurable extra capture field on a failed **Answer**. Replaced by **Issue Capture Field** / **Issue Capture Group** once attribution and actions were unified into one typed, grouped, conditional capture engine. Kept here only to redirect old references.

### People

**Reviewer**:
A SharePoint user with the Reviewer capability — held via the functional `Reviewers`
group **or** any per-Case-Type `Reviewers - <type>` list-access group, which _implies_ it.
Eligible to be assigned **Cases** and produce **Answers**. Group membership
alone does not grant edit access to any particular Case — that's the **Assigned
Reviewer**. The reviewing side has a base role (**Reviewer**) and an elevated role
(**Case Type Owner**), mirroring the frontline side (**Adviser** → **Journey Owner**).
Reviewers can reach `#/my-stats`, which loads their Report Feed by lower-cased
bare account from the SharePoint document library; it is not available to a
**Reviewer Manager** who lacks the Reviewer capability. A missing feed is an
empty report, and the view keeps `No data yet.` until a separate mapper supplies
the optional grouped chart view model. On route creation the page snapshots the
browser-local calendar into four comparison ranges: the previous complete
Monday–Sunday week plus this week through today, the previous complete month
plus this month through today, three complete months plus the current month,
and twelve complete months plus the current month. Day-grain ranges use daily
buckets and the longer ranges use monthly buckets; totals end at browser-local
yesterday while the current display bucket extends through today. The page owns
this range state and defaults to Week, but does not yet render the picker. It
does not load a second data path or map the Report Feed itself. Settled marks are
solid and provisional marks are hollow, preserving Report Feed provenance rather
than treating hollow as zero or excluded.
_Avoid_: Assessor, evaluator

**Assigned Reviewer**:
The single **Reviewer** currently assigned to a specific **Case** (the Case row's reviewer field). The role that grants edit access to that Case's **Answers**, **Conversation**, **Notes** and **Remediation Actions**. Reassignment is a single-user-field update. The _current_ assignment carries its own timestamp — `assignedAt` on the Case row, stamped by the client whenever a write sets the Reviewer and cleared when the Reviewer is cleared — which is what the Case tables' **Assigned** column shows. Only the current one: the full reassignment history is still SharePoint's list version history, not stored explicitly.
_Avoid_: Owner (of the case), primary reviewer, lead

**Responsible Party**:
The SharePoint user whose work is being reviewed (e.g., the agent on a call being
assessed) — an **Adviser** by group membership, named on one specific **Case**. Distinct
from the **Reviewer**. One per **Case**. Distinct from an **Attributed Party** (which is
per-failure, not per-Case). The **Assigned Reviewer** _sets_ the Responsible Party in-app,
at the bottom of the **Issues** Section, before **Send Actions**; it cannot be changed
after send. The field only appears — and is only required — once at least one failed
**Answer**'s "Is remediation required?" decision is `yes`: with nothing to send there is
nobody to send it to (#677). A Responsible Party already named persists if that decision
is later withdrawn, and stays visible to the **Assigned Reviewer**. The accepted
consequence is that a Case needing no remediation now completes with no Responsible Party
at all, so it carries none in the Case tables' Responsible Party column, appears under
nobody on the Responsible Party dashboard, and grants nobody the `responsibleParty`
Section-access role. Once actions are sent the Responsible Party gains `read-only`
**Summary**, `read-only` **Remediation** and `edit` **Conversation** access (the only
three Sections they see), and does the remediation work off-system, communicating via
the Conversation.
_Avoid_: Subject, owner (ambiguous), reviewee

**Adviser**:
The **frontline base role** — a SharePoint user in the `Advisers` group, eligible to be
named as a **Case**'s **Responsible Party**. "Adviser" is the business word for
this population; **Responsible Party** remains the per-Case role name (the Adviser
_assigned to_ a Case), mirroring **Reviewer** vs **Assigned Reviewer**. Replaces the old
`CR-ResponsibleParty` / `Frontline - Complaints` groups.
_Avoid_: Responsible Party (that is the per-Case role, not the group), Agent (call-centre-specific)

**Journey Owner**:
The **elevated frontline role** for a **Case Type** — a SharePoint user in
`JourneyOwner - <type>`. Sees the **Summary** of _every_ Case of their case
type(s) (a cross-case reach beyond a single Case's access) and, where the Case
Type configures `appeal.raisedBy: 'journeyOwner'`, raises **Appeals** on the **Appeal
Request** Section. The frontline counterpart to the **Case Type Owner**. Not a Case Type
Owner (does not edit the Question Bank).
_Avoid_: Case Type Owner (the reviewing-side elevated role), Frontline Manager

**Controls**:
A SharePoint user in the `Controls` group. **Resolves Appeals** (agree/reject with
rationale) on the **Appeal Review** Section and authors the case-level **Amended Outcome**
on the **Amend Outcome** Section. **Replaces the QA Reviewer** for
outcome changes once the Case is **Reportable**; the QA Check / **Answer Override** machinery is retired.
_Avoid_: QA Reviewer (retired), Auditor, Checker

**Attributed Party**:
The single SharePoint user identified as responsible for one specific _failed_ **Answer**. Optional and zero-or-one per failed Answer. Distinct from the **Responsible Party**: a Case has exactly one Responsible Party (whose work is under review), but multiple people may have had a hand in the process, and any single failure may be attributed to a different person. Stored inside the Answer as a bare account name plus a cached display name (`{ loginName, displayName }`), always directory-resolved — the pair only ever comes from a people-picker search result, never from typed text; the claims prefix and AD domain are single constants reattached at lookup time. Resolved to an authoritative display name at page load via the User Profile read (`GetPropertiesFor`), with the cached name as fallback. Settable only by the **Assigned Reviewer** of a Case that has not yet reached **Reportable**, and frozen once the Case is **Completed**. Stripped automatically when its Answer is no longer a failure. Does not affect the **Outcome**. As of the capture-engine unification, attribution is no longer a dedicated `attributedParty` Answer property: it is expressed as an **Issue Capture Field** of type `person` (optionally tagged `role: 'attributedParty'`), often shown conditionally via `showWhen` (e.g. Case Type A reveals it only when "Originator" = Distribution). The `{loginName, displayName}` storage and strip/freeze lifecycle are unchanged; only its declaration and storage location moved into `captureGroups` / `Answer.capture`.
_Avoid_: Responsible Party (case-level, a different concept), Owner, Culprit, Blame, Assignee

**Reviewer Manager**:
A SharePoint user in the Reviewer Managers **SharePoint Group** who manages a team of **Reviewers**. They have **two** pages, split by which half of the question they answer: `#/my-team` for the live present — Current Workload and Voided Cases, both read from the Case lists — and `#/team-stats` for settled history, the manager-side twin of `#/my-stats`. The intended `#/team-stats` page renders a hierarchy-attributed **Report Feed** the data pipeline publishes per manager; the currently shipped route is only an empty shell showing “No data yet.” The feed and live-tail work is staged in existing follow-ups #478, #471, and #472. That split is the same one [ADR-0048](./docs/adr/0048-my-stats-renders-a-report-feed-with-a-live-tail.md) draws for a Reviewer: processed history comes from a file, and only the days the file cannot yet cover are computed in the browser. The manager-only route and navigation checks are UX-only; SharePoint ACLs remain the security boundary: Case-list ACLs protect live Case data, while the Report Feed document-library ACL protects the settled-history file. _(This entry previously promised a single `#/reports/reviewer-team` report carrying both halves. No such route ever existed, there is no `#/reports/` namespace in `setup/register-routes.js`, and the two halves are different reads on different cadences — so it is replaced by the two routes above rather than kept as an aspiration.)_ ([ADR-0049](./docs/adr/0049-team-stats-renders-the-team-report-feed.md)) The relationship "Reviewer X is managed by Reviewer Manager Y" is denormalised onto every **Case** row as `assignedReviewerManager` (a user field) as an allocation-time operational cache/query input for live team Case queries and the scoped `reviewerManager` Role. Self-allocation resolves the current Reviewer's manager once after availability confirms the Reviewer is not at capacity and a candidate exists, then stamps both people in the same PATCH; a missing, unusable, or rejected lookup writes explicit `null`, and a manager-bearing write can fall back to explicit `null` if the manager person cannot be written. It is not frozen into a **Reportable** or planned reporting snapshot. Settled `#/team-stats` history remains **Staff Hierarchy** authoritative; any repair or reconciliation policy is future and conditional, not current behavior. A user is either a Reviewer Manager _or_ a **Responsible Party Manager**, never both — a Maintainer convention, not code, and no longer load-bearing: both roles are resolved per Case and compose safely if one user ever holds both. On a Case that names them in `assignedReviewerManager` they hold a **Section** access role of their own (`reviewerManager`), observing read-only whatever a non-assigned **Reviewer** observes — including the **Remediation** Section's reviewer-side breakdown. The role is scoped to the Case by that field, exactly as the **Responsible Party Manager**'s is: group membership alone grants nothing, so a manager reads the Cases of the **Reviewers** they manage rather than every Case of every **Case Type**.
The User Profile Manager lookup is now available through `SharePointClient.resolveManagers` and is used by allocation; repair and reconciliation remain future/conditional work, not current behavior. On `#/my-team` they read two tables: **Current Workload**, and beneath it **Voided Cases**
— the **Void Case** volumes of their team over 7 and 30 days, grouped by whoever voided
each Case, broken down by **Case Type** and naming each Reviewer's leading **Void Reason**.
_Avoid_: Team Lead, Reviewer Supervisor

**Responsible Party Manager**:
A SharePoint user in the Responsible Party Managers **SharePoint Group** who manages a team of **Responsible Parties** (e.g. the line manager of a group of call-centre agents being assessed). Sees the `#/reports/responsible-party-team` report — a 12-calendar-month view of their team's assessed Cases, broken down by pass / fail / had-remediation, totalled and per-Responsible-Party. The relationship "Responsible Party X is managed by Responsible Party Manager Y" is denormalised onto every **Case** row as `responsiblePartyManager` (a user field), and **today that field is the authority**: `resolveRoles` grants the Role by matching it. The decision on the manager fields is that this is wrong and _is to change_ — because this role posts in the **Conversation** it is an access-control input and must be _current_, so it is to be resolved live from the directory at Case load, failing closed if the lookup fails, with the column retained as a written record rather than the authority. `SharePointClient.resolveManagers` now resolves the directory edge, but `resolveRoles` does not yet consume it and no manager column is written, so a stale row currently decides who may post. Once `resolveRoles` consumes the lookup the two manager fields will look alike and behave differently: `assignedReviewerManager` is an allocation-time operational cache/query input for live reads, not the settled-history authority; `responsiblePartyManager` is always now — and when a Responsible Party's manager changes mid-Case the outgoing manager will lose posting rights at the next Case load, with their existing **Messages** staying in the thread, attributed to them. Conventionally distinct from **Reviewer Manager**, though nothing in code depends on that. On a Case they read the **Remediation** Section's breakdown (without the Reviewer's fields) and, like the **Responsible Party** they manage, post in the **Conversation** — their interface for chasing remediation with the **Reviewer**.
_Avoid_: Line Manager (overloaded), RP Manager (jargon abbreviation)

**Case Type Owner**:
The **elevated reviewing role** for a **Case Type** — a SharePoint group `CaseTypeOwner -
<type>` that "owns" the type and sees aggregate dashboard stats for it
(outstanding, overdue, completed today / last 7 days). Case Type Owners are the **authors**
of Question Bank changes — they propose additions, edits, and deprecations via the question
bank editor; Maintainers confirm (publish) those changes but do not author them. The
reviewing-side counterpart to the frontline-side **Journey Owner**; distinct from it (a
Case Type Owner does not raise Appeals or see all cases' Summaries by that power).

**QA Reviewer** _(retired — see **Controls**)_:
Former standalone role that selected **Completed Cases** for **QA Check** and authored
**Answer Overrides**. **Shelved pre-go-live**: the QA Check and Answer Override
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
_per-Case-Type-configured_ role: the **Journey Owner** for Complaints
(`appeal.raisedBy: 'journeyOwner'`), defaulting to the **Responsible Party Manager** for
other types — via the **Appeal Request** Section. **Resolved** by **Controls** on the
**Appeal Review** Section. Stored as an additive `appeals[]` JSON blob on the original Case
row; never mutates the frozen original. Lifecycle `raised → underReview →
resolved`, where resolved is `agreed | rejected`. Carries the **appellant's rationale**
(required on raise) and the **resolver's rationale** (required on resolve). May _cite_
specific failed **Answers**, but does not itself set Answer values. **Agreeing** means
Controls accepts the outcome was wrong and then authors a case-level **Amended Outcome**
(linked to the Appeal id); **rejecting** records rationale and changes nothing. At most one
open Appeal per Case; after resolution a new Appeal may be raised (full history kept).
_Avoid_: Dispute, Complaint, Grievance, Challenge

### Communication

**Conversation**:
The thread between the **Reviewer** and the responsible-party side of one **Case** — the **Responsible Party** and their **Manager**, both of whom post. Stored as a JSON array of **Messages** in a single plain-text field on the Case row.

**Message**:
One entry in a **Conversation** — author, timestamp, body.

### Outcome

**Outcome**:
The computed verdict for a **Case**, derived by the **Case Type**'s algorithm from the Case's **Answers**. No longer has its own Section or tab — it is rendered as one block _within_ the **Summary** Section (the `computeOutcome` function and `cora-outcome` rendering survive; the standalone Outcome tab and its row in the Section access matrix do not). The _live_ Outcome is always re-derivable from Answers — it is not a stored entity. However, a **snapshot** (`outcomeAtCompletion`) is stamped onto the Case row at the moment the Case becomes **Reportable**, to support historical reporting. The snapshot is frozen: it is not updated if Question Definitions or the outcome function change afterwards. A pass Outcome implies no **Remediation Actions** were attached (Remediation Actions only attach to failed Answers, and a failing Answer cannot yield a pass Outcome). Once the Case is **Reportable**, the Outcome may be displaced (not mutated) by a case-level **Amended Outcome** authored by **Controls** — see **Amended Outcome** and **Current Outcome**.

**Amended Outcome**:
A **case-level** correction of a **Reportable** Case's **Outcome**,
authored by **Controls** on the **Amend Outcome** Section.
Unlike the retired **Answer Override**, this is an **explicit, hand-set verdict**: Controls
chooses the new **Outcome** value directly, with a mandatory **Amendment Reason** and
**Amendment Justification**. Stored as
`amendedOutcome: { outcome, reason, justification, amendedBy, amendedAt } | null` on the Case
row — additive, so the frozen `outcomeAtCompletion` and Answers are never mutated. `reason`
holds the Amendment Reason's _key_, and is absent on amendments authored before the field
existed and on appeal-derived ones, which carry `fromAppealId` instead. `amendedBy` /
`amendedAt` are captured explicitly for **audit** (not mined from SharePoint version
history). Typically follows an **agreed Appeal** but does not require one. Drives the
`effectiveOutcome` reporting column. This deliberately relaxes the old "Outcome
is always derived, never hand-set" rule — for amended Cases only.
_Avoid_: Answer Override (retired), Outcome Override, Amendment (bare), Revised Outcome

**Amendment Reason**:
Why **Controls** amended a Case's **Outcome**, chosen on the **Amend Outcome** Section from
a shared vocabulary of three — _QA Check_, _TM Check_, _Appeal_ — that every **Case Type**
offers. Unlike the **Void Reason** vocabulary, a Case Type _may add_ to it
(`extraAmendmentReasons`), because nothing aggregates amendment reasons across Case Types
today while the checks that prompt an amendment genuinely differ by type; the three shared
keys stay framework-owned so a future report still has a common spine. A declared key that
collides with a shared one does not displace it. Stored as the key on the **Amended
Outcome** record; a key no longer offered renders as itself rather than blank.
_Avoid_: the label _QA Check_ standing in for the shelved **QA Check** Case Type — this is
display copy for one Amendment Reason and revives no meta-review surface; Amendment type,
amendment category

**Amendment Justification**:
The free-text rationale on the **Amended Outcome** record: why **Controls** set this
verdict on this Case, beyond the **Amendment Reason** it was filed under. Its on-screen
label is the bare word "Justification" only because the **Amend Outcome** Section is its
whole context; in writing it is always qualified, like its two siblings.
_Avoid_: Justification (bare — ambiguous with Answer Justification and Case Justification)

**Answer Override** _(retired — see **Amended Outcome**)_:
Former per-**Answer** post-completion correction with the **Current Outcome** re-derived
over **Effective Answers**. **Removed pre-go-live** together with the **QA
Check**; replaced by the case-level **Amended Outcome**. Kept only to redirect old
references.
_Avoid_: using in new work — use **Amended Outcome**.

**Effective Answers** _(retired)_:
Former concept: the frozen **Answers** with **Answer Override**s applied, used to re-derive
the **Current Outcome**. Gone with Answer Override — there is no per-Answer
override layer now; the corrected verdict is the **Amended Outcome** directly.
_Avoid_: using in new work.

**Effective Answers**:
The set of **Answers** for a **Case** with every **Answer Override** applied over the frozen original — the input to the **Current Outcome**. The original frozen Answers remain available alongside, so any view can show original-vs-override per question.

**Current Outcome**:
The Outcome in force now: `amendedOutcome?.outcome ?? outcomeAtCompletion`.
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
- "Reviewer" was being used for both group membership and per-Case assignment — resolved as **Reviewer** (group) vs **Assigned Reviewer** (per-Case role).
- "Visitor" is _derived_ (absence of all named-group memberships), not a SharePoint group. Capability flags are UX-only and the real boundary is SharePoint list ACLs.
- **Case Reference** uniqueness is assumed to be per **Case Type** (one list, one numbering sequence each) and needs confirming with the business. If References turn out to be globally unique, a Reference alone identifies a Case and search could resolve straight to it.
- "Question Bank" vs "catalogue" — both name a Case Type's set of **Question Definitions**. Resolved: **Question Bank** is the _authoring_ form (edited in `#/question-bank`, compiled to a module + reporting export); _catalogue_ is the _runtime_ form (the same questions joined to **Answers** to compute applicability). One concept, two lifecycle stages.
