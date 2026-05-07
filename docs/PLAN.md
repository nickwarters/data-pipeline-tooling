# Implementation Plan

This document is the execution roadmap. The architectural decisions it depends on live in [`docs/adr/`](./adr/); the domain language lives in [`../CONTEXT.md`](../CONTEXT.md).

## Approach

Build the framework via **vertical tracer-bullet slices**. Slice 1 exercises every architectural layer end-to-end against a tiny throwaway Case Type (`hello-review`). Slices 2–7 add capability against that same throwaway. Slice 8 is the first real Case Type — the moment "the framework" becomes "an actual review tool."

The framework is built once, against a stand-in. Real Case Types are added later. This avoids the trap of co-evolving framework and first-real-case-type, which couples them and makes both worse.

## Open architectural questions deferred (by design)

These have **deliberately not** been decided up-front because they're better answered with code in hand:

- **Question Definitions SharePoint list schema** — concrete column names and types. Deferred to **Slice 2**, when we first integrate against real SharePoint and have used the mock schema in anger.
- **CSS naming, reset, design tokens** — `cr-` prefix is decided (ADR-0003); the rest is detail. Deferred to **Slice 9** (visual polish).
- **Module/directory layout** — emerges from Slice 1 as primitives are written. Document the convention once it stabilises.
- **Conflict-resolution UI** — the SaveQueue handles the *logic* in Slice 1; the *UI* surface is Slice 9.
- **Network failure simulation in mock client** — defer to Slice 9 unless reviewers hit issues earlier.
- **`localStorage` queue persistence** — explicitly out for v1 (ADR-0008). Reconsider only if real outage data shows it's needed.

## Slice 1 — "Hello Case" (tracer bullet)

**Goal:** prove every architectural layer works together end-to-end against a 3-question throwaway Case Type.

### In scope

**Framework primitives**
- `signal()` / `computed()` / `effect()` — ~50 LOC reactivity primitive
- `CRElement` base class (extends `HTMLElement`, light DOM, lifecycle wires signal subscriptions, auto-unsubscribe on disconnect)
- `Router` — hash parsing, view registry (`#/dashboard`, `#/case/{id}`), mount/unmount
- `SharePointClient` JSDoc typedef — the interface every REST consumer codes against
- `MockSharePointClient` — in-memory store seeded from `dev/fixtures/`
- `SaveQueue` — 1500ms debounce, field-level PATCH, ETag tracking, exponential-backoff retry
- Boot logic in `app.js` that picks client based on `?mock=1`

**One Case Type**
- `case-types/hello-review.js` — exports `default` Case Type config:
  - 3 Question Definitions (Yes/No/NA only)
  - One question with a `showWhen` rule (proves the applicability evaluator works)
  - One question with a remediation action attached on failure (proves the data shape, even if remediation UI is deferred)
  - Tiny `outcome` function (e.g., "fail if any No, else pass")

**Two views**
- `<cr-dashboard>` — lists outstanding hello cases from fixtures, each row links to `#/case/{id}`
- `<cr-case-review>` — header (case ID + assigned reviewer name) + Questions section only

**One section component**
- `<cr-question-list>` rendering N `<cr-question>` instances
- `<cr-question>` — Yes/No/NA radio group, dispatches changes to SaveQueue via the case state signal

**Status logic**
- After each save, recompute "all applicable answered?"
- "Complete Case" button shows/hides accordingly
- On click: PATCHes `Status: Completed` + `CompletedAt`, redirects to `#/dashboard`

**Fixtures (`dev/fixtures/`)**
- 3 hello cases: untouched, partially-answered, completable
- One Reviewer persona with a fixed user ID
- Question Definitions for the hello case type (mock-only — schema for real SP list is deferred)

**Dev harness**
- `dev/index.html` — mount div + `<script type="module" src="../src/app.js">` + `?mock=1` default

**Tests (`node --test`)**
- Signal primitive: subscription, computed propagation, effect lifecycle
- Applicability evaluator: `showWhen` rules including `$and`/`$or`, cycle detection rejects bad configs
- SaveQueue: debounce, retry backoff, ETag conflict handling (mock 412 injection)
- Outcome function (the hello one)
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
- One `Cases-HelloReview` SharePoint list — provisioned with the columns the framework needs
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
- `<cr-question>` extended for `single-choice` (radio with N options) and `multi-choice` (checkboxes with N options)
- Question Definition schema includes options array
- Remediation Action UI on failed answers (collapsible: "this question failed; add corrective actions")
- `<cr-remediation-section>` summarising all failed answers + their actions across the case

**Validation:**
- Hello Case Type extended with one question of each type
- Saving multi-choice persists arrays correctly through the JSON blob
- Remediation summary updates live as failures are added/removed

---

## Slice 4 — Remaining Case Review sections

**Goal:** Conversation, Notes, Outcome.

**In:**
- `<cr-conversation>` — message thread, send-on-button, polling on focus, JSON-array PATCH semantics
- `<cr-notes>` — multi-line text field, debounced save
- `<cr-outcome>` — invokes Case Type's `outcome` function on the current Answers, displays the verdict + summary; updates reactively as Answers change

**Validation:**
- All Case Review sections from the README render and persist
- Conversation poll-on-focus picks up messages added by another tab without clobbering in-progress edits

---

## Slice 5 — Dashboard for Case Type Owners

**Goal:** aggregate views for owners.

**In:**
- Cross-case REST queries (count by status, completed today, completed last 7 days, overdue)
- `<cr-owner-summary>` per Case Type the user owns
- Dashboard composition shows owner cards alongside reviewer outstanding-cases card

**Validation:**
- Owner persona sees their Case Type counts; non-owners don't
- Counts match SharePoint list views directly

---

## Slice 6 — Case allocation

**Goal:** "request next available case" workflow.

**In:**
- Allocation rules per Case Type (declared in the Case Type module — e.g., "any unassigned case where reviewer is in group X")
- `<cr-allocation>` button that calls a framework allocation function
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

**Goal:** replace `hello-review` with the first real Case Type (likely "Sales Call Review" or whichever is most operationally pressing).

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
- Visual design pass — `cr-` prefixed CSS, design tokens, theme
- Conflict-resolution UI surface (the "case was edited elsewhere" banner)
- Network failure simulation in mock client + manual test scripts
- Case Type onboarding documentation for adding new types
- Admin runbook for SharePoint list/group provisioning

---

## Notes that span multiple slices

- **Every slice merges with `tsc --checkJs` clean and `node --test` green.** Non-negotiable from slice 1.
- **No third-party runtime dependencies, ever.** Dev/CI dependencies (tsc, prettier) are fine.
- **Components never call `fetch()` directly** — always through the `SharePointClient` interface. The mock-first dev loop depends on this hard rule.
- **Case Type modules are the seam between framework and product.** Adding a new Case Type should be: write a new JS module in `case-types/`, no framework changes required.
