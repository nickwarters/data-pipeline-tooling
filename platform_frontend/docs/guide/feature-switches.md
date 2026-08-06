# Feature switches

A feature switch here is a **hard-coded boolean in `src/config/features.js`**,
read by a small, named set of `if` statements. It is not runtime configuration:
there is no URL parameter, no SharePoint column and no per-environment override
behind it. The value in the file is the value everywhere, and changing it means
editing the source and deploying it.

That is the whole design, and it is deliberate.

## Why a constant, and why deletion rather than a flip

A switch with a runtime toggle is a promise to keep two code paths working
forever. Both have to be tested, both have to be reasoned about in every
subsequent change, and the "off" path quietly rots because nobody runs it. A
hard-coded switch makes the same shape cost far less: one live path, and a
stated end.

The end is what matters. **Turning a feature on is deleting the switch, not
setting it to `true`.** A flipped switch leaves every `if` standing —
permanently true, permanently unremarkable — and a conditional whose condition
can no longer be false is indistinguishable from one that is still doing work.
Six months on, nobody can tell whether it is safe to remove, so it stays; that
is how a temporary switch outlives by years the decision it was hiding.

So the rule is:

> **To enable a feature, delete its constant and delete every `if` that reads
> it — leaving the code the `if` was wrapping.** Never leave `= true` in
> `features.js`.

This also means a switch must be written so that it _can_ be deleted
mechanically. Each gate below is one of two shapes: a plain `if` that returns or
skips early, or a leading `APPEALS_ENABLED &&` conjunct whose deletion leaves
the original condition verbatim. No gate uses a ternary to select between two
behaviours, and none fuses the flag into a larger boolean it would have to be
untangled from. Removing a gate is always a deletion that restores the original
expression exactly, which is what makes the removal reviewable as a diff.

## The switches in force

| Constant          | Feature                         | State |
| ----------------- | ------------------------------- | ----- |
| `APPEALS_ENABLED` | The Appeals journey (see below) | Off   |

## `APPEALS_ENABLED` — the Appeals journey

Appeals are complete, tested code that is switched off because the **operating
model** is unsettled: who raises an Appeal, what Controls owes in response, and
how long they have to give it. Nothing is wrong with the implementation. It
stays in the tree so the decision can be taken against something real rather
than reconstructed from scratch.

With the switch off, no Appeal can be raised, so no Case ever carries one. Every
gated surface is therefore **empty**, not merely hidden — which is why the
dashboard surfaces are removed rather than left to render a permanent zero.

### What is gated

Five call sites read the constant. Nothing else does, and nothing else should.

| File                                       | Gate                                             | Effect when off                                                                                                           |
| ------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `src/services/section-access.js`           | `evaluateAccess()`, ahead of the `MATRIX` lookup | The **Appeal** and **Appeal Review** tabs resolve `hidden` for every role on every Case, so neither tab nor panel appears |
| `src/pages/dashboard/panel-descriptors.js` | the `appeals` descriptor's `visible()`           | The Controls **Appeals** panel is not composed                                                                            |
| `src/pages/cora-dashboard.js`              | the `loadAppeals` effect in `start()`            | The fan-out behind that panel is not requested                                                                            |
| `src/evaluators/kpi-strip-model.js`        | the Controls lane in the lane assembly           | The **"Appeals to work"** KPI lane is omitted                                                                             |
| `src/services/action-centre-model.js`      | the `appeals` reason's `requires()`              | The **"Appeals to work"** Action Centre group is omitted, for every capability                                            |

### What is deliberately _not_ gated

Knowing what was left alone matters as much as knowing what was wrapped —
re-gating something on the way back in is as much a defect as missing a gate.

- **The Appeal modules themselves.** `evaluators/appeal-state.js`,
  `pages/cora-case-review/appeal-actions.js`, `appeal-effects.js`,
  `appeal-view.js` and `appeal-review-view.js` are untouched, still imported,
  still type-checked, still covered by their own tests. They are unreachable
  through the UI, not absent. This is the point of the exercise: the code has to
  survive intact, or switching it back on is a rewrite.
- **The Amend Outcome tab** (`amendOutcome` in the Section registry and access
  matrix). Controls amends a reportable Case's Outcome whether or not an Appeal
  prompted it, so it is a standalone capability that happens to sit in the same
  ADR cluster. It stays live.
- **The Section registry** (`src/lib/section-registry.js`). The `appealRequest`
  and `appealReview` entries stay. The registry says which Sections _exist_ and
  in what order; access says who may _see_ one. Filtering the registry would
  also erase the `Section` id union those entries project into, breaking `tsc`
  for the access matrix and the Case Type `sections` allow-list — so the gate
  belongs at the access seam, which already has `hidden` as a first-class
  answer.
- **The write-path flag pairing** (`openAppealFields` in
  `src/services/action-centre-flags.js`) and the `hasOpenAppeal` /
  `appealRaisedAt` SharePoint columns. The pairing is only ever called by the
  Appeal transitions, so with no Appeal raised it cannot fire. Leaving the
  columns provisioned means historical Appeal data — from any Case that carried
  one before the switch landed — is still readable the moment the switch is
  removed.

### Enabling Appeals: the procedure

Do these in one commit. A half-removed switch is worse than either state.

1. **Delete the constant.** Remove `APPEALS_ENABLED` from
   `src/config/features.js`. If it was the last switch in the file, delete the
   file too, and its entry in the `CLAUDE.md` Directory layout block.

2. **Delete each `if`, keeping its body.** Work through the five files in the
   table above. In every case the removal is the same shape — take out the
   condition and the braces, leave what they contained:

   - `src/services/section-access.js` — delete the whole
     `if (!APPEALS_ENABLED) { … }` block at the top of `evaluateAccess()`. The
     `MATRIX` rows below it already carry the real access policy and need no
     edit.
   - `src/pages/dashboard/panel-descriptors.js` — delete the
     `if (!APPEALS_ENABLED) return false;` line, leaving a body of
     `return c.isControls;`. Collapsing that back to the original one-line
     descriptor — `{ key: 'appeals', visible: (c) => c.isControls }` — is a
     separate, optional tidy; prettier will not do it for you.
   - `src/services/action-centre-model.js` — likewise; `requires` is left as a
     block returning `c.isControls`, optionally collapsed to
     `(c) => c.isControls`.
   - `src/pages/cora-dashboard.js` — drop the `APPEALS_ENABLED &&` conjunct,
     leaving `if (capabilities.isControls)`.
   - `src/evaluators/kpi-strip-model.js` — the same, leaving
     `if (capabilities.isControls)`.

3. **Delete the import line** from all five files.

4. **Delete the gates' comments.** Each of the five gates carries a comment
   saying Appeals are switched off in this build. Those are now false.

5. **Delete the switch's own test.** `tests/appeals-feature-switch.test.js`
   asserts the gated behaviour and exists only to hold the switch honest. It
   goes when the switch does.

6. **Restore the displaced tests.** Every test this switch changed carries a
   comment saying what to put back — the grep in step 8 finds all of them.
   There are three kinds, and the last two are easy to overlook:

   - **Assertions weakened to the switched-off result**, each naming the value
     to restore: the Appeal tab access cases, the Controls dashboard panel and
     Action Centre reason lists, the KPI lane, the dashboard's dispatched
     actions and its last-navigation hash.
   - **The test helper.** Delete `matrixMode` and `assertMatrixGrid` from
     `tests/helpers/section-access.js` and move their callers back to
     `evaluateAccess` / `assertGrid` — in `section-access-lifecycle.test.js`,
     `section-access-matrix.test.js` and `cora-case-review-slice.test.js`. The
     expectations do not change; only the function called does.
   - **The flow harness.** In `tests/_in-memory-flow-runner.js`, delete
     `appealPolicyMode` and take both Appeal guards back to reading
     `loader.access.appealRequest` / `loader.access.appealReview`.

7. **Remove this section** and the table row above, and delete this file if
   `APPEALS_ENABLED` was the last switch in it.

8. **Grep, then run the gates.** Search the tree for `APPEALS_ENABLED` and for
   `switched off`: once steps 1–7 are done, both must return nothing outside
   `docs/`. Then `npm run check`, `npm run verify`, `npm run test:coverage`.
   `verify`'s dead-code half is the useful one here: it reads the import graph
   backwards, so a leftover import of a deleted `features.js` fails loudly.

9. **Amend the ADRs.** ADR-0027 (the Appeal flow) and ADR-0030's appeals reason
   carry a note that the journey is unreachable behind this switch. Remove it —
   they are live decisions again.

10. **Provision nothing.** The `HasOpenAppeal` and `AppealRaisedAt` columns and
    their indexes already exist on every Case list — see
    [provisioning-runbook.md](provisioning-runbook.md). Confirm rather than
    re-create.

### What the switch costs while it stands

Two stretches of production code are unreachable and therefore uncovered:
`buildControlsLane` in `kpi-strip-model.js`, and the `loadAppeals` effect plus
the `appeals` panel entry in `cora-dashboard.js`. Nothing can reach them with
the constant `false`, so no test can cover them without an injection seam this
design deliberately refuses. The global floor still passes comfortably (96%+
branch against a 95% gate), and both come back into coverage the moment the
switch is removed. If the floor is ever at risk, raise it by covering something
else — do not add a runtime toggle to make this code reachable from a test.

Everything else stayed covered: the Appeal access policy is exercised at the
`MATRIX` rows via `matrixMode` in the section-access suites, the panel view via
`dashboard-controls-view.test.js`, and the full raise → resolve → amend journey
via the in-memory flow runner, whose Appeal guards read the same rows.

### Before you enable it

The switch is off for a reason that is not technical. Settle these first, since
each one may change the code you are about to unwrap:

- **Who raises an Appeal.** Per Case Type, `appeal.raisedBy` selects the
  Responsible Party Manager or the Journey Owner. The default is the former.
- **What Controls owes.** The Action Centre reason carries a
  `defaultSlaDays: 5` cadence that no one has agreed to.
- **What "resolved" means downstream.** Resolving an Appeal in agreement offers
  Controls the Amend Outcome path; nothing currently reconciles an amended
  Outcome with reporting that has already gone out.
