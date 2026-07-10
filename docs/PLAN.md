# Implementation Plan

This document is the execution roadmap. The architectural decisions it depends on live in [`docs/adr/`](./adr/); the domain language lives in [`../CONTEXT.md`](../CONTEXT.md).

**Status:** Slices 1–10 are done. Current work is **Slice 11 — User groups & remediation workflow** (below). Slice numbers below are historical/sequential, not a live "next up" queue — check the tracking issues under Slice 11 for what's actually in flight.

## Approach

Build the framework via **vertical tracer-bullet slices**. Slice 1 exercises every architectural layer end-to-end against a tiny throwaway Case Type (`example-review`). Slices 2–7 add capability against that same throwaway. Slice 8 is the first real Case Type — the moment "the framework" becomes "an actual review tool."

The framework is built once, against a stand-in. Real Case Types are added later. This avoids the trap of co-evolving framework and first-real-case-type, which couples them and makes both worse.

## Open architectural questions deferred (by design)

These have **deliberately not** been decided up-front because they're better answered with code in hand:

- **Question Definitions SharePoint list schema** — concrete column names and types. Deferred to **Slice 2**, when we first integrate against real SharePoint and have used the mock schema in anger.
- **CSS naming, reset, design tokens** — `cora-` prefix is decided; the rest is detail. Deferred to **Slice 9** (visual polish).
- **Module/directory layout** — emerges from Slice 1 as primitives are written. Document the convention once it stabilises.
- **Conflict-resolution UI** — the SaveQueue handles the _logic_ in Slice 1; the _UI_ surface is Slice 9.
- **Network failure simulation in mock client** — defer to Slice 9 unless reviewers hit issues earlier.
- **`localStorage` queue persistence** — explicitly out for v1. Reconsider only if real outage data shows it's needed.

## Slice 1 — "Example Case" (tracer bullet)

**Goal:** prove every architectural layer works together end-to-end against a 3-question throwaway Case Type.

### In scope

**Framework primitives**

- `signal()` / `computed()` / `effect()` — ~50 LOC reactivity primitive
- `h()` plus `reactive()` / `defineView()` view primitives for plain function UI and shell boundaries
- `Router` — hash parsing, view registry (`#/dashboard`, `#/case/{id}`), mount/unmount
- `SharePointClient` JSDoc typedef — the interface every REST consumer codes against
- `MockSharePointClient` — in-memory store seeded from `dev/fixtures/`
- `SaveQueue` — 1500ms debounce, field-level PATCH, ETag tracking, exponential-backoff retry
- Boot logic in `app.js` that picks client based on `?mock=1`

**One Case Type**

- `case-types/example-review.js` — exports `default` Case Type config:
- 3 Question Definitions (Yes/No/NA only)
- One question with a `showWhen` rule (proves the applicability evaluator works)
- One question with a remediation action attached on failure (proves the data shape, even if remediation UI is deferred)
- Tiny `outcome` function (e.g., "fail if any No, else pass")

**Two views**

- `<cora-dashboard>` — lists outstanding example cases from fixtures, each row links to `#/case/{id}`
- `<cora-case-review>` — header (case ID + assigned reviewer name) + Questions section only

**One section component**

- `<cora-question-list>` rendering N `<cora-question>` instances
- `<cora-question>` — Yes/No/NA radio group, dispatches changes to SaveQueue via the case state signal

**Status logic**

- After each save, recompute "all applicable answered?"
- "Complete Case" button shows/hides accordingly
- On click: PATCHes `Status: Completed` + `CompletedAt`, redirects to `#/dashboard`

**Fixtures (`dev/fixtures/`)**

- 3 example cases: untouched, partially-answered, completable
- One Reviewer persona with a fixed user ID
- Question Definitions for the example case type (mock-only — schema for real SP list is deferred)

**Dev harness**

- `dev/index.html` — mount div + `<script type="module" src="../src/app.js">` + `?mock=1` default

**Tests (`node --test`)**

- Signal primitive: subscription, computed propagation, effect lifecycle
- Applicability evaluator: `showWhen` rules including `$and`/`$or`, cycle detection rejects bad configs
- SaveQueue: debounce, retry backoff, ETag conflict handling (mock 412 injection)
- Outcome function (the example one)
- MockSharePointClient: read/write/PATCH semantics, ETag generation, fixture loading

**CI**

- `tsc --noEmit --checkJs --allowJs` on PR
- `node --test` on PR
- Set up from day one. Cheap, catches drift early.

### Out of scope (deliberate)

- Conversation, Remediation UI, Outcome section UI, Notes section UI (data shapes designed; surfaces deferred)
- Single-choice / multi-choice question types (Yes/No/NA only)
- `HttpSharePointClient` (mock only — Slice 2 adds real SP)
- Case allocation ("Request next case")
- Dashboard aggregates for Case Type Owners
- Permissions enforcement (one persona, full access)
- Visual polish — minimal layout, semantic HTML
- Conflict-resolution UI surface
- Network failure injection in mock

### Validation / "done" criteria

- Open `dev/index.html?mock=1` → dashboard lists 3 cases
- Click a case → questions render; conditional question hidden until trigger answered
- Answer all applicable questions → "Complete Case" button appears
- Click Complete → redirected to dashboard, case no longer in outstanding list
- All unit tests pass; `tsc --checkJs` clean
- Mock 412 injection test demonstrates ETag concurrency working

### Estimated effort

~1–2 weeks for one focused developer.

---

## Slice 2 — Real SharePoint integration

**Goal:** swap `MockSharePointClient` for `HttpSharePointClient`, deploy to a dev SharePoint instance, prove the framework works against real REST.

**In:**

- `HttpSharePointClient` — `fetch` with `credentials: 'include'`, OData query construction, form digest fetch + refresh on 403, ETag on PATCH/DELETE, `Retry-After` honoring on 429
- Question Definitions SharePoint list — schema decided, list provisioned, fixtures replaced by real reads
- One `Cases-ExampleReview` SharePoint list — provisioned with the columns the framework needs
- Deploy mechanism documented (Style Library upload + Content Editor refresh runbook)
- Manual smoke-test checklist

**Out:**

- Automated deployment (manual upload acceptable for now)
- Multiple Case Types

**Validation:**

- Slice 1's behaviour reproduced against real SharePoint at `?mock=0` (default)
- ETag conflict reproducible by editing a Case row in SharePoint UI mid-review

---

## Slice 3 — Full question type set

**Goal:** support all response types described in the README.

**In:**

- `<cora-question>` extended for `single-choice` (radio with N options) and `multi-choice` (checkboxes with N options)
- Question Definition schema includes options array
- Remediation Action UI on failed answers (collapsible: "this question failed; add corrective actions")
- `<cora-remediation-section>` summarising all failed answers + their actions across the case

**Validation:**

- Example Case Type extended with one question of each type
- Saving multi-choice persists arrays correctly through the JSON blob
- Remediation summary updates live as failures are added/removed

---

## Slice 4 — Remaining Case Review sections

**Goal:** Conversation, Notes, Outcome.

**In:**

- `<cora-conversation>` — message thread, send-on-button, polling on focus, JSON-array PATCH semantics
- `<cora-notes>` — multi-line text field, debounced save
- `<cora-outcome>` — invokes Case Type's `outcome` function on the current Answers, displays the verdict + summary; updates reactively as Answers change

**Validation:**

- All Case Review sections from the README render and persist
- Conversation poll-on-focus picks up messages added by another tab without clobbering in-progress edits

---

## Slice 5 — Dashboard for Case Type Owners

**Goal:** aggregate views for owners.

**In:**

- Cross-case REST queries (count by status, completed today, completed last 7 days, overdue)
- `<cora-owner-summary>` per Case Type the user owns
- Dashboard composition shows owner cards alongside reviewer outstanding-cases card

**Validation:**

- Owner persona sees their Case Type counts; non-owners don't
- Counts match SharePoint list views directly

---

## Slice 6 — Case allocation

**Goal:** "request next available case" workflow.

**In:**

- Allocation rules per Case Type (declared in the Case Type module — e.g., "any unassigned case where reviewer is in group X")
- `<cora-allocation>` button that calls a framework allocation function
- Allocation function: queries unassigned cases, picks one (FIFO by `Created`), PATCHes `AssignedReviewer`, returns the case

**Validation:**

- Two reviewers concurrently requesting next case never get the same case (ETag-protected PATCH; loser retries)
- Reviewer's outstanding-cases list updates immediately

---

## Slice 7 — Permissions enforcement

**Goal:** sections gate on group membership.

**In:**

- `_api/web/currentUser/groups` read at boot, cached for session
- `permissions.js` config module mapping groups → capabilities
- Section visibility driven by capabilities
- Persona switching in dev (`?asUser=reviewer | owner | admin` against mock)

**Validation:**

- Reviewer persona doesn't see owner sections; owner persona doesn't see allocation button (unless also a reviewer); admin sees everything
- Real SharePoint 403 on disallowed write surfaces a graceful error

---

## Slice 8 — First real Case Type

**Goal:** replace `example-review` with the first real Case Type (likely "Sales Call Review" or whichever is most operationally pressing).

**In:**

- Real Case Type module: 50–100 Question Definitions, real `showWhen` graph, real `outcome` algorithm
- Real SharePoint list provisioning for that Case Type
- Real SharePoint groups configured
- Migration / import of existing in-flight cases if any (or fresh start)

**Validation:**

- One real Reviewer completes one real Case end-to-end
- One Case Type Owner sees correct aggregates
- Dogfooding feedback collected

---

## Slice 9+ — Hardening

**Goal:** production-readiness for full rollout.

- 500-question stress test (perf, focus management, scroll, virtualization if needed)
- Accessibility audit (keyboard nav, screen reader labels, focus order)
- Visual design pass — `cora-` prefixed CSS, design tokens, theme
- Conflict-resolution UI surface (the "case was edited elsewhere" banner)
- Network failure simulation in mock client + manual test scripts
- Case Type onboarding documentation for adding new types
- Admin runbook for SharePoint list/group provisioning

---

## Slice 10 — Issue Capture engine + canonical tab restructure (Jun 2026 refinement)

**Goal:** realize the Case Type Owners' workshopped consolidation — a canonical tab skeleton and a single, flexible **Issue Capture** engine that absorbs attribution, remediation actions, and free-form fields into one per-Case-Type-configurable model. Demo-driven: the next demo must show the Owners _their_ requirements (a real Case Type configured end-to-end), not just a renamed tab bar.

**Decisions:** use the unified **Issue Capture Group** / **Issue Capture Field** model in [`../CONTEXT.md`](../CONTEXT.md). Full grill record: [`refinement-grilling-session-plan.md`](./refinement-grilling-session-plan.md).

The implementation cuts through the tab skeleton, `captureGroups`, `Answer.capture`, the supported field types (`text`/`textarea`/`select`/`radio`/`person`/`actions`), collapsible groups, intra-group `showWhen`, visible-only `required`, autosave, Summary rendering, and Case Type configuration.

The standalone **Remediation** tab is the tracking surface for sent actions. **Amend Outcome** is a case-level Controls surface.

---

## Slice 11 — User groups & remediation workflow (Jul 2026, September go-live)

**Goal:** land the pre-go-live workflow the testers asked for — a two-axis role model, a
multi-stage case lifecycle with a **remediation loop**, a redefined **Remediation** tab, a
**Controls**-driven appeal + outcome-amendment flow, and the retirement of the unproven QA
subsystem. Grilled 2026-07-01; full decision record in
[`user-groups-workflow-grilling-session-plan.md`](./user-groups-workflow-grilling-session-plan.md).

**Decisions:** two-axis roles, lifecycle with **reportable**, Remediation tracking, working-day due dates, Amend Outcome with QA retirement, and Appeals. Domain language: **Adviser · Journey Owner · Controls ·
Amended Outcome · Reportable** in [`../CONTEXT.md`](../CONTEXT.md).

Each slice cuts config → storage → UI → autosave → tests, 100% coverage per CLAUDE.md:

1. **#230** — Two-axis role model & permissions rework. _Foundation._
2. **#235** — Rip out QA Check & Answer Override. _Clears the matrix/storage._
3. **#231** — Case lifecycle & the reportable milestone. _The spine._
4. **#232** — Split Issues/Remediation Sections + per-action model.
5. **#233** — Working-day SLA due dates.
6. **#234** — Rebuild the section access matrix. _Blocked by #230, #232._
7. **#236** — Amend Outcome tab. _Blocked by #235, #234._
8. **#237** — Appeal flow: Appeal Request / Appeal Review. _Blocked by #234, #236._
9. **#238** — Journey Owner cross-case Summary view. _Blocked by #230._
10. **#239** — Storage & SharePoint provisioning updates. _Threaded through._

**Suggested order:** #230 + #235 first (they clear the way); then #231 / #232 / #233 in
parallel; #234 once #230 + #232 land; #236 → #237 after the matrix; #238 alongside; #239
provisions storage as each consumer needs it.

**Everything here is September-must** (grill D18) — one delivery, no A/B split. **Fast-follow
(post-September):** QA **re**design/implementation (was #43/#50/#51), report solidification,
root-cause analysis, and broader Case Type expansion.

**~8 Case Types are live for September** — Example Review, Complaints, and ~6 more that are
structurally like Complaints. The framework work above is built once; the extra types are
**config + Question Bank + group/list wiring only**. #239 (provisioning) and the
appeal-raiser config must therefore cover **all** live types, not just two.
**Notifications** (Send-Actions / SLA reminders to the Adviser) are **out of scope — already
handled by existing infra.** No notification work and no new coupling in this frontend.

**Reverses #40** ("RP can mark Remediation Actions complete") — remediation completion is the
Reviewer's, not the Responsible Party's (grill D10). Close #40 when #232 lands.

---

## Notes that span multiple slices

- **Every slice merges with `tsc --checkJs` clean and `node --test` green.** Non-negotiable from slice 1.
- **No third-party runtime dependencies, ever.** Dev/CI dependencies (tsc, prettier) are fine.
- **Components never call `fetch()` directly** — always through the `SharePointClient` interface. The mock-first dev loop depends on this hard rule.
- **Case Type modules are the seam between framework and product.** Adding a new Case Type should be: write a new JS module in `case-types/`, no framework changes required.
