# Refinement Grilling-Session Plan

**Status:** Grilled 2026-06-17 — capture engine + tab skeleton landed (CONTEXT.md updated,
the architecture decision written, the architecture decision/0014/0016/0017 amended). Two items parked with tickets: Remediation
tab and Amend Outcome → case-level override. See "To grill later" below.
**Created:** 2026-06-16
**Driver:** Demo feedback. We're restructuring the case review tabs and generalising
per-question extra data capture from a flat field list into fully flexible,
per-Case-Type, grouped/collapsible field sets.

> How to use this doc: each item is a decision we must land or a question we must
> answer. Walk it top-to-bottom in the grill. **Bold** items are the high-stakes
> ones where the new request _contradicts_ something already documented (CONTEXT.md
> or an ADR) — resolve those first, because the rest depends on them.

---

## 0. Framing / why are we doing this

- [ ] One sentence: what did the demo audience trip over that motivated this? (So we
      can sanity-check every decision against the actual pain.)
- [ ] Who are the personas in the room for the demo (Reviewer, Case Type Owner,
      Responsible Party, QA Reviewer)? Whose feedback is driving which change?
- [ ] What's MVP for the _next_ demo vs. what's "later"? (We don't have to land the
      whole flexible-capture engine at once.)

---

## 1. Tab structure & naming ⚠️ contradicts current docs

The request says the tabs become: **Case Details · Review · Issues · Remediation · Summary**.
Today (CONTEXT.md "Section", the architecture decision, the architecture decision) the tabs are:
**Details · Questions · Notes · Issues · Summary**, with Conversation as a floating
overlay and Remediation surfacing _as_ the "Issues" tab.

So three things move at once. Pin each down:

- [ ] **Confirm the final, exact tab set and left-to-right order.** Is it exactly
      these five, or do we keep a Notes tab too?
- [ ] **Where do Notes go?** The current Notes Section holds the **Case Justification**
      and the general note (CONTEXT.md). The new tab list drops "Notes". Did we
      intend to remove the Notes tab, fold it into another tab, or keep it and just
      not mention it? Case Justification must live _somewhere_.
- [ ] **"Review" vs "Questions" — same thing renamed, or different scope?** The
      request says Review = "question responses only, not selection of
      actions/remediation". That _is_ today's Questions tab. Is "Review" purely a
      rename of Questions?
- [ ] **Terminology collision on the word "Review".** CONTEXT.md explicitly lists
      "Review" as an _avoid_ term for **Case** ("review is the activity, not the
      thing"). Now a tab is literally labelled "Review". Are we OK overloading it as
      a UI label only (domain concept stays "Questions"/"Answers"), or pick a
      different label (e.g. "Questions", "Assessment")?
- [ ] **Issues vs Remediation — what is each tab FOR?** _(Single most important
      question in this doc.)_ Today they're the same Section. The request now lists
      them as two separate tabs, AND says Issues does the action selection + extra
      data capture. So:
- [ ] What does the **Issues** tab contain? (Stated: all failed questions; select
      relevant action / free-format action / "no action"; plus the new extra data
      capture.)
- [ ] What does the **Remediation** tab then contain that Issues doesn't? Options to
      decide between:
      (a) Remediation = a rolled-up, read-only view of all chosen actions across
      the case; (b) Remediation = where the configurable extra-data _groups_ live
      (and Issues stays attribution + action only); (c) something else.
- [ ] Does this split mean the domain concept "Remediation Action" now lives under
      the **Issues** tab while the **Remediation** tab is something new? That inverts
      CONTEXT.md's current "Issues = UI label for the Remediation Section".
- [ ] **Conversation** — still a floating overlay, unchanged? Confirm it's
      not becoming one of these five tabs.
- [ ] **Per-role access for the new tabs.** Each Section has an access mode
      (edit/read-only/hidden) per viewer-role. For the new split:
- [ ] What are Review / Issues / Remediation access modes for each role?
- [ ] Does the Responsible Party see Issues/Remediation while In-progress, or only
      via Summary once Completed (as Outcome is gated today)?
- [ ] **Default tab & fallback** — still Case Details as default (read-only, never
      hidden)? Fallback order if a tab is hidden?
- [ ] **`showInSummary` flags** — the per-Section Summary inclusion flags
      (CONTEXT.md/the architecture decision) need re-mapping to the new Section set. Which of
      Review/Issues/Remediation feed Summary?

---

## 2. Flexible extra-data capture ⚠️ extends/contradicts the architecture decision

The request: each Case Type has a configurable set of extra data to capture "for each
question"; flexible; **groups of fields**; each group a **collapsed section** that
**expands** on click; fields of **different input types** (select, textarea, radio,
etc.); all captured data **attached to the question data**. We already have
"attribution" + flat `remediationFields`.

### 2a. Scope: which questions, and where declared

- [ ] **"For each question" — all Answers, or only _failed_ Answers?** the architecture decision's
      capture (Remediation Details) is per _failed_ Answer only, and lives in the
      Issues Section. The request phrase "extra data capture for each question" is
      ambiguous. Decide: capture on every Answer, or only failures?
- [ ] **Declared per Case Type, not per Question Definition — confirm.** the architecture decision
      deliberately declares fields per _Case Type_, not per Question Definition,
      because Question Definitions are shared cross-Case-Type (a per-question field
      would leak into every Case Type using that question). The request says
      "configurable... by case type" (good) but also "for each question" and
      "attached to the question data" (sounds per-question). Reconcile: declared once
      per Case Type, _captured_ per Answer? Or genuinely per-Question-Definition now
      (and accept the cross-Case-Type leakage / override the architecture decision)?
- [ ] If per-question variation IS wanted, how? (e.g. fields target specific question
      ids / categories / response types via a `showWhen`-style selector?)

### 2b. The grouping / collapsible model (new)

- [ ] **Data shape for groups.** Sketch the declaration. Straw man:
      `js
captureGroups: [
{ key, label, collapsed: true, showWhen?, fields: [
{ key, label, type, options?, required?, showWhen? }
]}
]
`
      Confirm the shape, and what replaces today's flat `remediationFields`.
- [ ] **What do we name this concept?** (Domain term needed for CONTEXT.md.) Today:
      "Remediation Detail" (a single field). New container = "Capture Group"? "Detail
      Group"? "Field Group"? Avoid "Section" (already a domain term).
- [ ] **Default collapsed state** — all collapsed by default? Per-group configurable?
- [ ] **Is collapse/expand purely UI, or persisted** per Answer / per Reviewer?
- [ ] **Nesting depth** — groups of fields only (one level), or groups-in-groups? (Keep
      to one level unless there's a real need.)

### 2c. Field types & storage

- [ ] **Enumerate the supported input types.** Stated: select, textarea, radio. Likely
      also: text, checkbox/multi-select, number, date, yes/no. Lock the exact list —
      each type is rendering + validation + storage work.
- [ ] **Storage shape.** Today `Answer.remediationDetails:
Record<string,string>` — string-keyed strings. Multi-select / checkbox groups
      need arrays; numbers/dates may want typing. Do we keep `Record<string,string>`
      (serialise everything to string) or widen to `Record<string, string|string[]>`?
- [ ] **One blob or extend Answers?** the architecture decision stored inline on the Answer to avoid a
      second source of truth. Same here, or a new structure given groups?
- [ ] **Validation** — `select`/`radio` validated against `options` at capture time
      (per the architecture decision). What validation for number/date/free text? Max length?
- [ ] **Required fields & the completion gate.** the architecture decision: a `required` field blocks
      Case completion until filled on every failed Answer. Keep that? Does
      "required" now apply per group/field across the new model? If capture extends
      to non-failed Answers, does required gate completion there too?

### 2d. Lifecycle & reporting

- [ ] **Lifecycle (mirror the architecture decision/0017?).** Today Remediation Details are _stripped_
      when an Answer stops being a failure, and _frozen_ at completion. If capture now
      spans all Answers (not just failures), the "strip when not a failure" rule
      breaks. Define the lifecycle for the new model.
- [ ] **Answer Overrides.** An Override carries a complete replacement set
      of remediation actions / attributed party / Remediation Details. Do the new
      capture groups participate in override replacement the same way? Confirm
      "replace, never merge" still holds for grouped fields.
- [ ] **Reporting export.** The function-free reporting export and
      `effectiveOutcome` column — do captured field values need to surface in
      reporting? If so, which fields, and how keyed?

---

## 3. Summary tab ⚠️ mostly confirmation, one new bit

Request: Summary stays a read-only rollup — # successful, # failed, # not-applicable,
the Case Details, every failed question with its issues + captured data, and the
Outcome. Plus a _refined_ QA override section. This largely matches CONTEXT.md
"Summary" + the architecture decision; confirm and pin the deltas.

- [ ] **Count definitions.** Precisely define each count:
- [ ] "Successful" = answered and not meeting failure criteria?
- [ ] "Failed" = Answer meets failure criteria (an "Issue")?
- [ ] "Not applicable" = which? (a) question answered as N/A value (yes-no-na), or
      (b) question not currently Applicable because `showWhen` is false, or both?
      These are different numbers — decide what we count.
- [ ] **Failed-question detail block** — shows each failed Answer with its remediation
      actions + the captured extra data from the Issues tab. Read-only mirror of
      Issues. Confirm it renders the new grouped fields (collapsed? expanded in
      Summary?).
- [ ] **Derivation timing.** Hybrid: live while In-progress, frozen
      `outcomeAtCompletion` once Completed; counts/failed-list recompute from frozen
      Answers. Unchanged? Confirm.
- [ ] **Outcome block** stays a block _within_ Summary (not its own tab) — confirm.
- [ ] **QA override section — what's the "refinement"?** This is the new bit. Against
      the architecture decision (Answer Override) / the architecture decision (effectiveOutcome) / CONTEXT.md
      (Answer Override, Effective Answers, Current Outcome), specify exactly what
      changes:
- [ ] What does the refined QA override section _show_ (original vs overridden per
      Answer, Current Outcome, who/when/source)?
- [ ] What can be _done_ from it, and by whom (QA Reviewer only, per CONTEXT.md)?
- [ ] Is it embedded here in Summary, or still authored on the original Case page /
      in the QA Check?
- [ ] Does it now surface the new captured field groups in the override replacement
      set?

---

## 4. Cross-cutting: ADRs & CONTEXT.md to update

Decide which documents change and whether we write new ADRs or amend existing ones.

- [ ] **the architecture decision / the architecture decision (tabs)** — amend or supersede for the new five-tab set
      (Review/Issues/Remediation split, Notes disposition).
- [ ] **the architecture decision (Remediation Details)** — supersede with a new ADR for flexible,
      grouped, multi-type capture? Or amend in place? (Leaning: new the architecture decision that
      supersedes 0017, given the model change.)
- [ ] **the architecture decision (section access)** — add the new Sections to the role×Section matrix.
- [ ] **the architecture decision (storage shape)** — if storage widens beyond `Record<string,string>`.
- [ ] **CONTEXT.md** — new/changed terms to define or revise:
- [ ] "Review" tab vs the avoid-listed "Review"
- [ ] "Issues" vs "Remediation" now being two tabs (the Issue / Remediation
      Action / Remediation Detail entries all need re-checking)
- [ ] the new grouping concept's name
- [ ] Notes/Case Justification location if it moved
- [ ] **docs/PLAN.md** — does this become its own slice(s)? Sequence vs current
      roadmap.

---

## 5. Open contradictions to resolve first (the short list)

If we only get through five things in the grill, these are them:

1. [ ] **Issues vs Remediation** — what is each tab, given they used to be one?
2. [ ] **"For each question"** — capture on all Answers or only failed ones; declared
       per Case Type or per Question Definition (vs the architecture decision's deliberate choice)?
3. [ ] **Notes / Case Justification** — where does it live now that "Notes" isn't in
       the tab list?
4. [ ] **"Review" the label** vs the avoid-listed domain term — keep or rename?
5. [ ] **Storage shape** — do multi-value field types force us off
       `Record<string,string>`?

---

## To grill later (raised, deliberately parked — tickets filed)

- **Remediation tab — purpose undefined.** Confirmed it is NOT per-Issue remediation
  capture (that's the "Issue Remediation" Issue Capture Group on the Issues tab). Leading
  hypothesis: a cross-Issue aggregate view of all remediation actions + owners. Access,
  editability, Summary inclusion, lifecycle all open.

- **Override moving from per-Answer to CASE-LEVEL.** The "Amend Outcome" tab is confirmed
  as the canonical authoring surface for the existing override behaviour (QA Check links to
  it; same-row write), BUT the workshop wants the override to operate at the **Case level**
  rather than per-question/per-**Answer**. ⚠️ This **directly contradicts the architecture decision and
  CONTEXT.md**, which deliberately made overrides per-**Answer** with the **Outcome
  _derived_, never directly edited** (CONTEXT avoid-lists "Outcome Override"). A case-level
  override implies editing the verdict directly. Must grill: does **Current Outcome** still
  re-derive via `computeOutcome`, or become a stored hand-set verdict? What happens to the
  per-Answer **replacement sets** (actions / attribution / **Issue Capture Field**s)? How do
  **Appeal** links (`source: 'appeal'`) and the pass→fail completion gate work at case level?
  Until resolved, CONTEXT.md's **Answer Override / Effective Answers / Current Outcome**
  entries are left as-is. "Amend Outcome" is a **UI label only** for now; domain term stays
  **Answer Override** pending this grill.

## Deferred gaps (decided during grill — revisit later)

- **Cross-Case-Type attribution reporting.** After unifying attribution/actions into the
  capture-group engine (see §2), there is no longer a fixed `attributedParty` key for
  reporting to aggregate "who was blamed" across Case Types. Proposed fix:
  optional **semantic `role` tag** on a field (`role: 'attributedParty' | 'remediationOwner'`)
  that reporting keys off instead of the per-Case-Type field `key`. **Deferred** —
  reporting is not on management's agenda. Safe to defer: a `role` tag is additive config
  on a field declaration, so it can be added later by editing Case Type modules, with no
  stored-data migration.

## 6. Parking lot (raise if time allows)

- [ ] Conditional capture groups/fields (`showWhen` on a field) — needed now or later?
- [ ] Per-Reviewer persistence of expand/collapse state.
- [ ] Accessibility of collapsible groups (keyboard, ARIA) — matches `cora-` patterns?
- [ ] Field ordering / reordering in the Case Type Owner authoring flow (question bank
      editor) — do Owners author capture groups too, or Maintainers only?
- [ ] Validation UX: where do required-but-empty errors surface (Issues drawer vs
      completion gate)?
      </content>
      </invoke>
