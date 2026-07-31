# User Groups & Remediation Workflow — Grilling-Session Plan

**Status:** GRILLED & WRITTEN UP 2026-07-01 — decisions D1–D18 below are now captured in
**ADRs 0022–0027** (+ amendments to 0007/0010/0011/0012/0014/0016/0018/0019/0021), the
**CONTEXT.md** domain language, and **PLAN.md Slice 11**. Tracked for build as epic
**#229** with sub-issues **#230–#239**. Open confirmations for Nick are in the
"Clarifications for Nick" section at the end. Created from live-testing feedback ahead of
the September go-live.
**Created:** 2026-07-01
**Driver:** Pre-go-live tester feedback + a role/case-list pivot an agent recently
started (half-landed in `permissions.js`, `section-access.js`, `sharepoint-client.js`,
and `case-types/example-review.js`). This session locks the role model, the case
lifecycle/status machine, the Remediation tab's purpose (resolves the parked #144),
and a **second appeal flow** (Appeal Request → Appeal Review) that contradicts the
current QA-based **Appeal**.

> How to use this doc: each item is a decision we must land or a question we must
> answer. Walk it top-to-bottom in the grill. **Bold ⚠️** items are the high-stakes
> ones where the new request _contradicts_ something already documented (CONTEXT.md
> or an ADR) or already half-built in code — resolve those first, because the rest
> depends on them.

---

## Decisions landed — 2026-07-01 grill (running log)

Recorded as we go; the numbered sections below carry the detail.

- **D1. Base + elevated roles are two parallel sides of the review.** _Reviewing side:_
  **Reviewers** (base) → **CaseTypeOwner - `<type>`** (elevated). _Frontline side:_
  **Advisers** (base) → **JourneyOwner - `<type>`** (elevated). CaseTypeOwner and
  JourneyOwner are the two elevated, per-Case-Type roles.
- **D2. `Reviewers - <type>` (list-access) implies the Reviewer capability.** No need to
  hold both `Reviewers` and `Reviewers - <type>`; the list group is sufficient to be a
  Reviewer. (`isReviewer` = in `Reviewers` **or** in any `Reviewers - <type>`.)
- **D3. Group naming corrected.** The Example type's owner group is the **existing**
  `CaseTypeOwner - Example Review` (not "Example Case Type"). The code is already right;
  no rename. §1d's "mismatch" is withdrawn.
- **D4. Status casing/terms:** keep the existing code casing — `In-progress`,
  `Actions In Progress`, `Completed`. (§2 "pick a casing" is resolved to these.)
- **D5. Appeal raiser is per-Case-Type config.** Complaints: the **JourneyOwner** raises
  (Appeal Request tab). Other types: default to the **Responsible Party Manager**. This
  is declared with the rest of the Case Type config. **Controls** resolves (Appeal
  Review). See §3.
- **D6. QA Check + Answer-level Override are SHELVED** in favour of the **Amend Outcome**
  tab. **Controls replaces the QA Reviewer** for now.
- **D7. Amend Outcome = a case-level, hand-set verdict** (not derived). Controls picks
  the new **Outcome** explicitly with a **justification** box. Store an
  **amended-outcome record** on the Case row capturing **who** (`amendedBy`) and **when**
  (`amendedAt`) for audit — do **not** rely on SharePoint item version history. This
  overturns the old "Outcome is always derived, never overridden" principle
  (CONTEXT.md) for the amended case. **Current Outcome** = amended record if
  present, else `outcomeAtCompletion`.
- **D8. Rip QA out now** (not leave dormant): remove `qaReviewer` role, `qa-*` Case
  Types (`qa-example-review.js`), `cora-override-editor.js`, and mark the Answer
  Override and QA-snapshot decisions **superseded**. QA is redesigned later, closer to when its requirements are known.
- **D9. Remediation Action becomes an object** — elevate from plain string to
  `{ id, text, status: 'pending'|'complete'|'cancelled', cancelReason? }`. The **due
  date is a single case-level field** on the Case row (not per action), **stamped when
  the Reviewer clicks "Send Actions"** = send date + 10 working days.
- **D10. RP (Adviser) sees only Summary + Conversation.** No Case Details tab for the RP
  — Case Details is **rolled into the Summary** (same content shown in the Details tab
  and inside Summary), so the RP needs only: **Summary (read-only)** + **Conversation
  (edit during `Actions In Progress`)**. RP does **not** edit Remediation.
- **D11. Reviewer sets the Responsible Party at the bottom of the Issues tab.** Must be
  set before "Send Actions"; **cannot be changed after send**.
- **D12. Working-day calendar** = a small maintained list of holiday dates — either a
  small SharePoint list or an in-code array is acceptable (pick at build time).
- **D13. New concept: "reportable".** A Case becomes **reportable** at the moment
  **actions are sent** (if any exist) **or the case is completed** (if none). This is the
  single freeze point (D14) and snapshot point (D15). New Case-row timestamp
  **`reportableAt`**: on the no-actions path it equals the completed timestamp; on the
  actions path it equals the **Send Actions** timestamp. (Distinct from `completedAt`,
  which is only the final Complete on the actions path.)
- **D14. Questions/Answers freeze at reportable**, not at final Complete. Once a Case is
  reportable (actions sent, or completed), the Answers are frozen — a newly-applicable
  Question can **no longer reopen** it. While still `In-progress` (pre-reportable), a new
  applicable Question applies as today.
- **D15. Outcome snapshot stamped at reportable** (= at Send Actions on the actions path;
  at Complete on the no-actions path), together with `hadRemediation`. (Naming note: the
  existing field is `outcomeAtCompletion`; consider renaming to reflect "at reportable",
  or keep the name and document that "completion" here means the reportable moment.)
- **D16. Appeal config shape** on the Case Type module:
  `appeal: { raisedBy: 'journeyOwner' | 'responsiblePartyManager', resolvedBy: 'controls' }`.
  `resolvedBy` is always `controls` today but kept explicit so tab-gating stays
  data-driven.
- **D17. CaseTypeOwner stays read-only on live cases** (elevated _reviewing_ role =
  oversight/observer view); their only authoring power is the question bank, off the case
  page. Unchanged from today.
- **D18. Everything in this doc is September-must** — one delivery, no A/B split. **Fast-
  follow (post-September)** = solidifying reports, the QA **re**design/implementation,
  root-cause analysis, and broader Case Type expansion.

---

## 0. Framing / why are we doing this

- [ ] One sentence per pain point: what did testers actually trip over? (So every
      decision below is checked against real pain, not a nicety.)
- [ ] Which of these ship for **September go-live** vs. which are "after"? This is a
      lot; the lifecycle + role gating is probably the must-have, the second appeal
      flow (Appeal Request / Appeal Review / Amend Outcome by Controls) may be a fast
      follow.
- [ ] Confirm this supersedes / interacts with the recent half-landed pivot. Several
      code files already carry a partial version of these ideas (see §7 "Pre-existing
      inconsistencies"). We either finish that model or replace it — decide which.

---

## 1. The role & group model ⚠️ contradicts current docs + code

The request lists **eight** group families. They fall on **two different axes** that
the current `permissions.js` blurs. Pin the axes first, then every group slots in.

**Straw-man two-axis model (confirm or reject):**

- **Functional role groups** — gate _what a user can do_ anywhere: `Reviewers`,
  `Advisers`, `CaseTypeOwner - <type>`, `JourneyOwner - <type>`, `Controls`.
- **List-access groups** — gate _which Case Type's SharePoint list a user can open_:
  `Reviewers - <type>` (e.g. `Reviewers - Example Case Type`, `Reviewers - Complaints`).
  These are the real ACL boundary; the functional groups are UX-only
  capability flags.

Under this model a Reviewer needs **both** `Reviewers` (functional) **and**
`Reviewers - Complaints` (list access) to actually review a Complaints case.

- [ ] **Confirm the two-axis split** (functional vs list-access), or state the real
      relationship if it's different.
- [ ] **Does a Reviewer need both groups**, or does `Reviewers - Complaints` alone
      imply Reviewer? (Affects `resolveCapabilities` + `resolveRoles`.)

### 1a. `Advisers` — new name, collides with **Responsible Party** ⚠️

The request: `Advisers` "defines the user as an Adviser (responsible party)". Today
CONTEXT.md's **Responsible Party** is "the SharePoint user whose work is being
reviewed", `permissions.js` has `responsibleParty: 'CR-ResponsibleParty'`, and
`section-access.js` matches the role off the **Case row field**, not group membership.

- [ ] **Is "Adviser" simply the business word for "Responsible Party"?** If yes: do we
      rename the domain term, or keep "Responsible Party" internally and treat
      "Adviser" as a UI label + the `Advisers` group is the new source for
      `responsibleParty`? (CONTEXT.md avoid-list already forbids several synonyms;
      adding "Adviser" needs a ruling.)
- [ ] **Group vs per-case field.** Being _in_ `Advisers` makes you eligible to be a
      Responsible Party; being _named on a Case_ makes you the RP for that case (cf.
      Reviewer vs Assigned Reviewer). Confirm this mirrors the Reviewer/Assigned split.
- [ ] **`CR-ResponsibleParty` and `Frontline - Complaints`** — the recent pivot left
      both in `permissions.js`. Are these dead now (replaced by `Advisers`), or
      distinct? `frontlineComplaints` has no home in the new spec — kill or keep?

### 1b. `JourneyOwner - <type>` — new role, currently mis-modelled ⚠️

The request: one group per Case Type name; gates functionality; lets holders (1) see
the **Summary tab for _all_ cases in their case type(s)** and (2) see a new **Appeal
Request** tab. Today `permissions.js` files `JourneyOwner - Complaints` **inside the
`caseTypeOwners` map** — so a Journey Owner is wrongly resolved as a Case Type Owner.

- [ ] **JourneyOwner is its own capability**, not a Case Type Owner. New capability
      field (e.g. `ownedJourneyCaseTypes: string[]`), new Role in the access matrix.
      Confirm.
- [ ] **"Summary for all cases in their case type"** is a **cross-case** power, not a
      single-Case section grant. That's a list/dashboard query capability
      (`#/reports/...` or a JourneyOwner dashboard), _separate_ from the per-Case
      section access. Where does this surface — a new route, or an existing dashboard?
- [ ] Does JourneyOwner get **read-only** Summary on any case of its type, even cases
      they aren't assigned to / aren't RP on? (Yes per request — confirm the mode.)

### 1c. `Controls` — new role ⚠️

The request: gates the **Appeal Review** tab; Controls agree/reject an appeal with
justification; if the appeal changes the outcome they use the **Amend Outcome** tab.

- [ ] New capability (`isControls`) + new Role in the matrix. Confirm.
- [ ] **Controls vs QA Reviewer.** Today the **QA Reviewer** resolves Appeals and is
      the _only_ role that may author **Answer Overrides** / use Amend Outcome
      (CONTEXT.md). The request hands appeal-resolution **and** Amend Outcome
      to **Controls**. So: **does Controls replace QA Reviewer for appeals + overrides,
      or coexist?** (This is the single biggest role contradiction — see §3.)

### 1d. Group naming convention (locks SharePoint provisioning) ⚠️

- [x] **~~Which case-type name in the group?~~** RESOLVED (D3): use the **existing**
      names — `CaseTypeOwner - Example Review`, not "Example Case Type". Code is already
      correct; no rename needed.
- [ ] **The slug↔display mapping still needs a home.** Code keys on slug
      `example-review`; ACLs key on the group display name `Example Review`. Every
      per-type group name (`Reviewers - X`, `CaseTypeOwner - X`, `JourneyOwner - X`)
      derives from one per-Case-Type display name. Decide where that name lives.
- [ ] Where does the slug↔group-name mapping live? (A per-Case-Type field in the
      module? A table in `permissions.js`?) Every per-type group name
      (`Reviewers - X`, `CaseTypeOwner - X`, `JourneyOwner - X`) derives from it.
- [ ] Final enumerated group list for **provisioning** (Maintainer runbook): list all
      groups for the two live types (Example, Complaints) so nothing is invented later.

---

## 2. Case lifecycle & status machine ⚠️ contradicts CONTEXT.md + case-machine.js

The request describes a **multi-stage** lifecycle that replaces today's binary
`In-progress → Completed` (`case-machine.js`, CONTEXT.md "Completed Case"). Draw the
full state diagram in the grill; straw-man:

```
In-progress ──(Issues done, no actions)────────────────► Complete
     │
     └──(Issues done, actions exist → "Send Actions")──► Actions in progress
                                                              │
                     (Remediation tab: every sent action     │
                      marked complete / cancelled+reason)    │
                                                              ▼
                                              ("Complete Case") Complete
```

- [ ] **Lock the exact status strings** — they become SharePoint list column values
      and ETag-guarded PATCH payloads, so casing matters. The request says
      "Actions in progress" and "Complete"; the code already has `'Actions In Progress'`
      (title case) and `'Completed'`. **Pick one casing for each and one terminal
      name** (`Complete` vs `Completed`). CONTEXT.md's "Completed Case" +
      `completedAt` must be reconciled to the chosen term.
- [ ] **Redefine "Completed Case".** Today it means "every applicable Question has an
      Answer" (CONTEXT.md). Under the new flow, reaching the terminal state also
      requires either _no actions_ or _all remediation resolved_. Rewrite the
      definition (and the "In-progress ↔ Completed" example dialogue in CONTEXT.md).
- [ ] **The Summary bottom button.** One button, two labels:
- [ ] Label = **"Send Actions"** iff ≥1 Remediation Action exists across the case;
      else **"Complete Case"**. Confirm the exact condition (any action on any failed
      Answer? only non-cancelled? — but nothing is cancelled yet at this point).
- [ ] **"Send Actions"** → status `Actions in progress`, stamps a send timestamp,
      computes remediation due dates (§4), grants RP access (§5). Confirm all four
      side-effects fire atomically on that one PATCH (ETag/SaveQueue).
- [ ] **"Complete Case" (no-actions path)** → status `Complete`. Confirm the
      `outcomeAtCompletion` snapshot is stamped **here**.
- [ ] **When is the outcome snapshotted** on the actions path — at **Send Actions**
      (answers are frozen then) or at final **Complete**? Answers don't change during
      remediation, so leaning "at Send Actions", but `completedAt` is at final Complete.
      Decide both timestamps.
- [ ] **Definition of "Issues tab complete"** (the precondition for showing the
      button). Every failed Answer's **required** Issue Capture Fields filled
      ? Confirm this is the gate, unchanged.
- [ ] **Reopen semantics.** If a new Question Definition becomes applicable while
      `Actions in progress`, does the case fall back to `In-progress` (today's rule)?
      What if it's already `Complete`? Define.
- [ ] **`CaseRow.status` union** currently `'In-progress' | 'Completed'` — widen to the
      final set. `CaseMachine.transitionToCompleted` needs sibling transitions
      (`transitionToActionsInProgress`, final complete). Note in the ADR.

---

## 3. Appeals: a second flow that contradicts the QA appeal ⚠️⚠️

This is the deepest contradiction. **Two appeal models now exist:**

|                    | CONTEXT.md (today)                                             | New request                                 |
| ------------------ | -------------------------------------------------------------- | ------------------------------------------- |
| Raised by          | Responsible Party or their Manager                             | ? (JourneyOwner sees "Appeal Request")      |
| Resolved by        | **QA Reviewer**                                                | **Controls** ("Appeal Review")              |
| Outcome change via | **Answer Override** (per-Answer, QA authors)                   | **Amend Outcome** tab (Controls)            |
| Tabs               | Appeal Section (overlay-ish), Amend Outcome = QA override home | **Appeal Request** + **Appeal Review** tabs |

**Landed (D5/D6):** appeal-raiser is **per-Case-Type config** — Complaints ⇒
**JourneyOwner**; other types default to **Responsible Party Manager**. **Controls**
resolves via **Appeal Review**. **QA Check + Answer Override are shelved**; **Amend
Outcome** is the outcome-change surface; **Controls replaces QA Reviewer**. Remaining
open questions below.

Resolve, in order:

- [ ] **Who raises an appeal now?** The request only says JourneyOwner _sees_ the
      "Appeal Request" tab. Do JourneyOwners **raise** appeals, or is "Appeal Request"
      where they **triage/see** appeals raised by Advisers/RPs? Name the initiator
      explicitly.
- [ ] **Is this the same `appeals[]` entity** (an additive blob on the Case row,
      lifecycle `raised → underReview → resolved{agreed|rejected}`) with different
      _actors_, or a genuinely new entity? Strong preference: **same storage, new role
      wiring** — but confirm.
- [ ] **Does `Controls` replace `QA Reviewer` for resolution?** And does the
      **QA Reviewer / QA Check / Answer Override** machinery
      (`qa-example-review.js`, `cora-override-editor.js`) **survive at all** for
      September, or is it out of scope / superseded? (Big blast radius — decide
      before touching the matrix.)
- [ ] **"Amend Outcome" ownership.** Today Amend Outcome is the canonical **Answer
      Override** authoring surface (QA). The request gives it to **Controls**, used
      "if the appeal results in a case outcome changing". This overlaps the **parked
      #145** (case-level override vs per-Answer override).
      Decide: does Amend Outcome stay **per-Answer override re-derived** (`computeOutcome`
      over Effective Answers, CONTEXT.md), or does Controls **hand-set a verdict**?
      (CONTEXT.md avoid-lists "Outcome Override" — a hand-set verdict breaks that.)
- [ ] **Appeal timing vs status.** Appeals today only exist on a **Completed** Case.
      With the new terminal name `Complete`, and the `Actions in progress` interlude,
      when can an appeal be raised/reviewed? (Presumably only after `Complete`.)
- [ ] **Access modes** for the two new sections (`appealRequest`, `appealReview`) — see
      §6 matrix.

---

## 4. Remediation tab — resolves the parked #144 ⚠️

The request finally **defines** the standalone Remediation tab (previously #144,
"purpose undefined"): the **Reviewer** fills it in, **per question/action**, marking
each Remediation Action **complete** or **cancelled** (cancelled ⇒ justification
required). Plus each action carries a **due date = 10 working days after Send Actions**.

This forces a storage-shape change: today a Remediation Action is a **plain string**
(`remediationActions: string[]` on the Answer; and the `actions` Issue Capture
Field is `Action[]`). It now needs per-action **state**.

- [ ] **Two distinct Sections now exist** — reconcile with CONTEXT.md, which says
      "Issues" _is_ the Remediation-capture Section (Section key `remediation`):
- **Issues** tab = _capture_ actions on failed Answers (Reviewer, pre-send).
- **Remediation** tab = _track completion_ of sent actions (Reviewer, post-send).
- [ ] Do we **split the Section key** (`issues` for capture, `remediation` for
      tracking), or keep one key with mode depending on status? The current single
      `remediation` Section key (in `SECTIONS`, the matrix, `showInSummary`) can't be
      both. **Name the two sections** and update CONTEXT.md's "Issues = UI label for
      the Remediation Section" claim.
- [ ] **Per-action data shape.** Straw-man: promote each action to
      `{ id, text, status: 'pending'|'complete'|'cancelled', cancelReason?, dueDate }`.
      Where does it live — widen the Issue Capture `Action` type? A parallel
      `remediationStatus` map on the Answer?
- [ ] **Cancelled ⇒ justification required** — a completion gate: can't reach
      `Complete` with a cancelled-but-unjustified action. Confirm.
- [ ] **"Remediation complete"** = every _sent_ action is `complete` or
      `cancelled(+reason)`. This **gates the "Complete Case" button, but only when
      actions were sent** (request). Confirm the gate is inert on the no-actions path.
- [ ] **Access.** Remediation tab = **Reviewer edit only**. The **Responsible Party
      does NOT edit** it — they do the work off-system and reply via **Conversation**;
      the Reviewer records the result. Confirm (this is explicit in the request).
- [ ] **Does Remediation feed Summary?** (`showInSummary`.) The failed-Answer detail
      block already shows actions; should it now show each action's
      complete/cancelled state + due date?

---

## 5. Responsible Party (Adviser) assignment & access ⚠️ contradicts section-access.js

- [ ] **Reviewer sets the Responsible Party _within_ the case review.** Today
      `responsibleParty` is just a Case-row field (assumed set at creation). Now it's an
      **editable field in the UI** — **which tab/section**, and **when** (must be set
      before "Send Actions", since send grants them access)? New editable person-field
      surface + PATCH.
- [ ] **RP gains access on Send Actions, not on Complete.** Today `section-access.js`
      hides **Summary** from the RP unless `status === 'Completed'`. The request needs
      the RP to see **Summary + Conversation** during **`Actions in progress`**. So the
      Summary gate must change to something like "visible read-only when status ∈
      {`Actions in progress`, `Complete`}". Confirm the exact status set.
- [ ] **Conversation** — the recent pivot already set
      `conversation.allowMessagesWhen: ['Actions In Progress']` in the example config,
      which lines up: RP can post during remediation. Confirm this is intended and the
      RP's conversation mode is `edit` during `Actions in progress`.
- [ ] **Exact RP tab set.** Straw-man: **Case Details (read-only) + Summary
      (read-only) + Conversation (edit, during actions)** — and _nothing_ of
      Review / Issues / Remediation / Notes. Confirm.
- [ ] **RP identity plumbing.** Is the RP a plain user field, or does it (like the
      Managers) get denormalised for reporting? Any manager-of-RP relationship needed
      here, or out of scope?

---

## 6. Access matrix — new Sections & Roles

Everything above lands as edits to `MATRIX` in `section-access.js`. Fill this grid in
the grill (modes: `edit` / `read-only` / `hidden`, possibly status-conditional):

**New/renamed Sections:** `review` (=questions), `issues` (=capture), `remediation`
(=NEW completion tracking), `appealRequest`, `appealReview`, `amendOutcome`.
**New Roles:** `journeyOwner`, `controls`, plus existing `assignedReviewer`,
`otherReviewer`, `responsibleParty` (Adviser), `caseTypeOwner`, `qaReviewer?`, `none`.

| Section \ Role         | assignedReviewer | responsibleParty           | journeyOwner                      | controls | caseTypeOwner |
| ---------------------- | ---------------- | -------------------------- | --------------------------------- | -------- | ------------- |
| details                | read-only        | read-only                  | ?                                 | ?        | read-only     |
| review (questions)     | edit             | hidden                     | ?                                 | ?        | read-only     |
| issues (capture)       | edit             | hidden                     | ?                                 | ?        | read-only     |
| remediation (tracking) | edit             | **hidden**                 | ?                                 | ?        | ?             |
| summary                | read-only        | read-only _(status-gated)_ | **read-only (all cases in type)** | ?        | read-only     |
| appealRequest          | ?                | ?                          | **read-only/edit**                | ?        | ?             |
| appealReview           | hidden           | hidden                     | ?                                 | **edit** | hidden        |
| amendOutcome           | ?                | hidden                     | ?                                 | **edit** | ?             |
| conversation           | edit             | edit _(status-gated)_      | ?                                 | ?        | read-only     |
| notes                  | edit             | hidden                     | ?                                 | ?        | read-only     |

- [ ] Fill every `?`. Note which cells are **status-conditional** (function-valued in
      the matrix) vs constant.
- [ ] **Default tab & fallback order** with the new tab set — still `details` default?
- [ ] **`showInSummary`** for the new/renamed Sections (which feed the Summary rollup).
- [ ] **JourneyOwner cross-case Summary** is _not_ expressible in the per-Case matrix
      alone (it spans cases they have no per-case role on). Decide how the matrix + a
      list-scope capability combine (see §1b).

---

## 7. Pre-existing inconsistencies from the half-landed pivot (clean these up)

Not new decisions — defects to fix as part of this work, called out so we don't build
on sand:

- [ ] `permissions.js`: `JourneyOwner - Complaints` is wrongly nested in
      `caseTypeOwners` → must become its own capability (§1b).
- [ ] `sharepoint-client.js`: `CaseRow.status` is `'In-progress' | 'Completed'` but
      `SectionConfig.allowMessagesWhen` already allows `'Actions In Progress'`, and
      `example-review.js` uses it — the status union is out of sync with the config
      type (§2).
- [ ] Casing mismatch: `'Actions In Progress'` (code) vs "Actions in progress"
      (request); `'Completed'` (code/CONTEXT) vs "Complete" (request) — one canonical
      set (§2).
- [ ] Group-name mismatch: `'CaseTypeOwner - Example Review'` (code) vs
      `'CaseTypeOwner - Example Case Type'` (request) (§1d).
- [ ] `responsibleParty: 'CR-ResponsibleParty'` and
      `frontlineComplaints: 'Frontline - Complaints'` vs the new `Advisers`
      group — reconcile/retire (§1a).
- [ ] `case-machine.js` only knows `transitionToCompleted`; `canComplete`/`canAttribute`
      hard-code `status === 'In-progress'` — needs the new intermediate state (§2, §4).

---

## 8. Docs to update (outputs of this grill)

- [ ] **CONTEXT.md** — new/changed terms: **Adviser** (vs Responsible Party),
      **Journey Owner**, **Controls**, **Appeal Request** vs **Appeal Review**,
      **Remediation** (tab redefined — per-action complete/cancelled), **status set**
      (`Actions in progress`, terminal name), **remediation due date / working days**;
      reconcile **Appeal** (QA vs Controls) and the **Completed Case** definition.
- [ ] **New ADR — case lifecycle / status machine** (multi-stage: In-progress →
      Actions in progress → Complete; button semantics; snapshot timing).
- [ ] **New ADR — working-day due dates** (10 working days: which calendar? England &
      Wales bank holidays, or plain Mon–Fri? No third-party deps — a small internal
      calculator + holiday list; where does the holiday list live?).
- [ ] **Amend the section-access ADR** — add Sections (appealRequest,
      appealReview, amendOutcome; split issues/remediation) and Roles (journeyOwner, controls); Summary RP gate change.
- [ ] **Amend the answer-override ADR / #145** — settle Amend Outcome ownership (Controls) and whether
      outcome change stays per-Answer-derived or becomes case-level/hand-set.
- [ ] **Amend the case-storage ADR** — storage deltas: per-action
      status/reason/dueDate, `responsibleParty` now Reviewer-set, new status column, send timestamp.
- [ ] **Resolve #144** (Remediation tab) with §4; touch **#145** (Amend Outcome).
- [ ] **docs/PLAN.md** — sequence this as its own slice(s); flag what's September-must
      vs fast-follow (§0).

---

## 9. Resolve-first short list

If we only get through five things in the grill, these are them:

1. [x] **~~Two-axis role model~~** RESOLVED (D1/D2): base↔elevated on each side —
       Reviewers→CaseTypeOwner (reviewing), Advisers→JourneyOwner (frontline);
       `Reviewers - <type>` implies Reviewer.
2. [x] **~~The status machine~~** RESOLVED (D4/D9/D13/D14/D15): states/casing fixed;
       button + due-date stamp fixed; **`reportableAt`** freeze/snapshot point; Answers
       freeze (no reopen) once reportable.
3. [x] **~~QA Reviewer vs Controls~~** RESOLVED (D6/D7/D8): Controls replaces QA; QA
       Check + Answer Override ripped out; **Amend Outcome = case-level hand-set
       verdict + justification + who/when audit**.
4. [x] **~~Remediation tab~~** RESOLVED (D9): per-action `status`/`cancelReason`,
       actions elevated to objects, one case-level due date stamped at Send Actions.
5. [x] **~~RP (Adviser) access~~** RESOLVED (D10/D11): RP sees Summary + Conversation
       (Details folded into Summary); Reviewer sets RP at bottom of Issues, locked after
       send.

---

## Clarifications for Nick — RESOLVED 2026-07-01

All confirmed. Answers folded into the docs where they change scope:

1. **Working-day calendar** — ✅ **in-code array**, holiday list as chosen.
2. **`outcomeAtCompletion` name** — ✅ keep the name; no column rename.
3. **#40 reversal** — ✅ confirmed: remediation completion is the **Reviewer**'s; **close #40
   as superseded** when #232 lands.
4. **Adviser vs Responsible Party** — ✅ both coexist (group/population word vs per-Case role).
5. **QA removal** — ✅ confirmed as a real deletion (not dormant).
6. **Journey Owner Summary** — ✅ a **new dedicated view**.
7. **Notifications** — ✅ **out of scope, already handled by existing infra.** No
   notification work in this frontend and no new coupling to build — nothing to design
   around here. (`reportableAt` / `remediationDueDate` are stamped for the lifecycle and
   reporting regardless.)
8. **Live Case Types for September** — ✅ **at least ~8** (Example Review + Complaints + ~6
   more), where the ~6 are **structurally like Complaints**, so onboarding each is
   **config + Question Bank + group/list wiring only** — no framework changes (the
   "one module per Case Type" promise). Provisioning and the appeal-raiser config
   (`appeal.raisedBy` — the Complaints-like types will typically set `'journeyOwner'`) must
   cover all live types, not just two.

## 10. Parking lot (raise if time allows)

- [ ] Working-day calendar source & maintenance (bank-holiday list refresh).
- [ ] Overdue-remediation surfacing (past due date) — a report? a badge? Managers'
      dashboards already compute case overdue via `overdue-evaluator.js`.
- [ ] Notifications when actions are sent to the RP (email? in-app only?). SharePoint
      list alerts vs framework-driven — likely out of scope for a no-backend frontend.
- [ ] JourneyOwner "see all cases in type" — new route/dashboard vs extending an
      existing owner dashboard.
- [ ] Multiple open appeals / re-appeal after Controls rejects (today's model
      allows one open appeal at a time — does that hold under the Controls flow?).
      </content>
      </invoke>
