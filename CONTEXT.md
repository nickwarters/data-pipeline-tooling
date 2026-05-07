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
A SharePoint user in a Reviewer **SharePoint Group** who is assigned **Cases** and produces **Answers**. Can be reassigned — assignment is a single user field on the Case row; history comes from SharePoint's list version history, not stored explicitly.

**Responsible Party**:
The SharePoint user whose work is being reviewed (e.g., the agent on a call being assessed). Distinct from the **Reviewer**.
_Avoid_: Subject, owner (ambiguous), reviewee

**Case Type Owner**:
A SharePoint group that "owns" a **Case Type** and sees aggregate dashboard stats for it (outstanding, overdue, completed today / last 7 days).

### Communication

**Conversation**:
The thread between **Reviewer** and **Responsible Party** for one **Case**. Stored as a JSON array of **Messages** in a single plain-text field on the Case row.

**Message**:
One entry in a **Conversation** — author, timestamp, body.

### Outcome

**Outcome**:
The computed verdict for a **Case**, derived by the **Case Type**'s algorithm from the Case's **Answers**. Not a stored entity in its own right — re-derivable. Can be accompanied by reviewer-added notes/justification stored on the Case row.

## Relationships

- A **Case** belongs to exactly one **Case Type**.
- A **Case Type** references many **Question Definitions** (a catalogue).
- A **Question Definition** can appear in many **Case Types**.
- A **Case** has many **Answers**, one per **Applicable Question**.
- An **Answer** has zero-to-many **Remediation Actions**.
- A **Case** has one **Conversation** (= many **Messages**).
- A **Case** has one current **Reviewer** and one **Responsible Party**.

## Example dialogue

> **Dev:** "When the **Reviewer** finishes the last question, do we auto-complete the **Case**?"
> **Domain expert:** "No — completion is an explicit action by the Reviewer. We just unlock the 'Complete Case' button once every **Applicable Question** has an **Answer**."
> **Dev:** "And if an admin adds a new **Question Definition** to the **Case Type** after the Reviewer has answered everything else?"
> **Domain expert:** "The Case goes back to **In-progress**. The new question becomes **Applicable** and must be answered."

## Flagged ambiguities

- "Question" was being used for both the canonical definition and the per-Case instance — resolved as **Question Definition** vs **Answer**.
- "Remediation" was being used for both the section and the corrective action — resolved as **Remediation Action** for the item; the section is just a UI concern.
- "Outcome" was nearly modeled as a stored entity — resolved as a *computed* property of a Case.
