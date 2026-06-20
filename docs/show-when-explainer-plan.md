# Plan: showWhen Applicability Graph — Interactive Explainer

## Goal

Create `docs/show-when-explainer.html` — a self-contained interactive visual
explainer for the `showWhen` applicability system, matching the style of the
two existing explainers:

- `docs/signal-explainer.html` — reactivity primitives
- `docs/save-queue-explainer.html` — autosave + ETag

Same aesthetic: Bebas Neue + JetBrains Mono, dark `#080b10` background,
dot-grid, amber/cyan/violet color palette, scene/card structure.

---

## What to read first

Before writing any code, read these files in full:

| File                                                        | Why                                                                                                               |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/applicability-evaluator.js`                            | The full implementation: `evaluate()`, `evalCondition()`, `evalOp()`, `detectCycles()`, `allApplicableAnswered()` |
| `docs/adr/0006-applicability-graph-and-outcome-function.md` | Design constraints: why showWhen is per-Case-Type not per-Question, cycle rejection policy, schema growth rules   |
| `case-types/hello-review.js`                                | The reference dataset — 5 real questions including one with `showWhen` — use these questions throughout the page  |
| `src/sharepoint-client.js` lines 1–46                       | The `QuestionDefinition` and `Answer` typedefs that define the schema                                             |
| `docs/signal-explainer.html`                                | Copy the header, legend, concept-card, scene, walkthrough patterns exactly                                        |

---

## Concepts to explain (one section each)

### 1. The showWhen schema (concept cards)

Three cards:

**Leaf operators** (amber)

```js
showWhen: { 'q-needs': { equals: 'Yes' } }
showWhen: { 'q-channel': { in: ['Phone', 'Chat'] } }
showWhen: { 'q-notes': { answered: true } }
```

A leaf condition names exactly one question ID and one operator.
`evalOp()` handles all three.

**Logical combinators** (cyan)

```js
showWhen: { $and: [
  { 'q-needs': { equals: 'Yes' } },
  { 'q-channel': { in: ['Phone'] } }
]}
showWhen: { $or: [...] }
```

`$and` / `$or` are recursive — each element is itself a full condition.

**No showWhen = always applicable** (violet)
Questions without a `showWhen` key are always in the applicable set.
The framework checks `!q.showWhen || evalCondition(...)` — absence is
treated as unconditional truth, not an error.

---

### 2. Interactive dependency graph (the main demo)

This is the centrepiece. Use the `hello-review.js` questions as the dataset.
Render a node graph where:

- Each question is a node (rounded rectangle)
- A directed edge `A → B` means "B has a showWhen that references A"
- Applicable questions are highlighted (full color, solid border)
- Hidden questions are dimmed (muted, dashed border)
- The applicable Set re-evaluates live as the user changes answers

**Node layout** for hello-review questions:

```
[q-welcome]   [q-needs]   [q-channel]   [q-products]
                  │
                  ↓
              [q-resolve]
              showWhen: q-needs equals 'Yes'
```

`q-resolve` has an edge FROM `q-needs`. The other four have no `showWhen`
so they always appear.

**Interactions required:**

- Clicking a node opens an inline panel showing its `showWhen` JSON and the
  current evaluation trace (which operator ran, what value was checked,
  true or false)
- Each applicable node shows answer controls inline (yes/no/na radio buttons
  for yes-no-na type; the hello-review questions are all yes-no-na)
- Changing `q-needs` to "Yes" → `q-resolve` lights up (applicable)
- Changing `q-needs` back to "" (unanswered) or "No" → `q-resolve` dims
- A live "Applicable set" badge in the corner lists the current Set<string>
- A "Complete Case?" indicator showing `allApplicableAnswered()` result

**Implementation notes:**

- No canvas/SVG required for the graph — CSS flexbox with manually positioned
  nodes works fine given the small, static topology
- The edge arrow is a simple CSS border + pseudo-element pointing down
- The evaluation runs synchronously in JS using an inline version of
  `evalCondition()` / `evalOp()` (copy the logic, don't import the module
  since the page must be self-contained)

---

### 3. Step-through: how evaluate() walks the catalogue

A walkthrough (same Prev/Next/Play pattern as the other explainers) stepping
through a single call to `evaluate(catalogue, answers)`.

Use a scenario where `q-needs = 'Yes'` so `q-resolve` becomes applicable.

**Simplified code to show** (left panel):

```js
function evaluate(catalogue, answers) {
  const applicable = new Set();

  for (const q of catalogue) {
    if (!q.showWhen) {
      // ← no condition → always in
      applicable.add(q.id);
      continue;
    }
    if (evalCondition(q.showWhen, answers)) {
      applicable.add(q.id); // ← condition passed
    }
    // else: question stays hidden
  }

  return applicable;
}

function evalCondition(cond, answers) {
  if ('$and' in cond) return cond.$and.every((c) => evalCondition(c, answers));
  if ('$or' in cond) return cond.$or.some((c) => evalCondition(c, answers));

  // leaf: { questionId: { operator } }
  for (const [qId, op] of Object.entries(cond)) {
    if (!evalOp(op, answers[qId])) return false;
  }
  return true;
}

function evalOp(op, answer) {
  const value = answer?.value ?? '';
  if ('equals' in op) return value === op.equals;
  if ('in' in op) return op.in.includes(value);
  if ('answered' in op) return value !== '';
  return false;
}
```

**Steps** (one per catalogue entry, showing the loop iteration):

1. `q-welcome` — no `showWhen` → `applicable.add('q-welcome')`
2. `q-needs` — no `showWhen` → `applicable.add('q-needs')`
3. `q-resolve` — has `showWhen: { 'q-needs': { equals: 'Yes' } }` → `evalCondition()` called
4. Inside `evalCondition`: leaf node — loop over entries → `evalOp()` called for `q-needs`
5. Inside `evalOp`: `'equals' in op` → `value === 'Yes'` → `true` → condition passes
6. `applicable.add('q-resolve')`
7. `q-channel` — no `showWhen` → added
8. `q-products` — no `showWhen` → added
9. Return `Set { 'q-welcome', 'q-needs', 'q-resolve', 'q-channel', 'q-products' }`

State panel (right side) should show:

- Current catalogue index (which question is being processed)
- The `applicable` Set growing as entries are added
- `evalCondition` call stack depth when processing nested `$and`/`$or`

---

### 4. Step-through: cycle detection (detectCycles)

A second walkthrough tab showing the DFS WHITE/GRAY/BLACK algorithm.

Use a toy catalogue with a 3-question cycle: A→B→C→A.

**Simplified code**:

```js
function detectCycles(catalogue) {
  const deps = buildDepsMap(catalogue); // { id → Set<referencedIds> }

  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map(); // all start WHITE

  function dfs(id) {
    color.set(id, GRAY); // ← currently visiting
    for (const dep of deps.get(id)) {
      if (color.get(dep) === GRAY) return true; // ← back edge = cycle!
      if (color.get(dep) === WHITE && dfs(dep)) return true;
    }
    color.set(id, BLACK); // ← fully explored
    return false;
  }

  for (const id of deps.keys()) {
    if (color.get(id) === WHITE && dfs(id)) return true;
  }
  return false;
}
```

**Steps** showing DFS coloring on the node graph:

1. All nodes start WHITE — graph shown with all nodes dim
2. DFS visits A → color A = GRAY (amber border glow)
3. A's deps: {B} → visit B → color B = GRAY
4. B's deps: {C} → visit C → color C = GRAY
5. C's deps: {A} → A is GRAY → **back edge detected = CYCLE**
6. `detectCycles` returns true → framework refuses to mount, throws error

The cycle graph should visually show: nodes colored WHITE/GRAY/BLACK with the
back edge highlighted in red when the cycle is found.

**Also show the happy path**: a 4th node D with no deps → DFS completes,
all nodes go BLACK, function returns false.

---

## Color assignments

Reuse the existing CSS variables from signal-explainer:

| Entity                                   | Variable                           | Color           |
| ---------------------------------------- | ---------------------------------- | --------------- |
| Always-applicable question (no showWhen) | `--signal`                         | amber `#f59e0b` |
| Conditionally-applicable question        | `--computed`                       | cyan `#22d3ee`  |
| Hidden / not-yet-applicable question     | `--muted`                          | `#4a6080`       |
| Cycle / error state                      | `--conflict` (from save-queue)     | `#f87171`       |
| DFS GRAY                                 | `--reconnecting` (from save-queue) | `#fb923c`       |
| DFS BLACK (complete)                     | `--saved` (from save-queue)        | `#4ade80`       |

The page does NOT need to import any JS modules. Inline the logic.

---

## File output

**Output path:** `docs/show-when-explainer.html`

Single self-contained HTML file. No ES module imports. Copy the
`evalCondition`, `evalOp`, and `detectCycles` logic verbatim from
`src/applicability-evaluator.js` as plain functions inside a `<script>` tag.

Serve with `python3 -m http.server 7777` from the repo root and open
`http://localhost:7777/docs/show-when-explainer.html` to verify.

---

## Page structure (in order)

```
<header>
  <h1>Applicability Graph</h1>
  <p>showWhen · evaluate() · detectCycles() — src/applicability-evaluator.js</p>
  <legend> always-applicable | conditional | hidden | cycle </legend>
</header>

<main>
  <!-- Section 1 -->
  <section class="concepts">  <!-- 3 concept cards: leaf ops, $and/$or, no-showWhen -->

  <!-- Section 2 -->
  <section class="scene" id="scene-graph">
    <h2>Interactive Dependency Graph</h2>
    <!-- hello-review 5-question graph, live answer toggles, applicable Set badge -->

  <!-- Section 3 -->
  <section class="scene" id="scene-evaluate">
    <h2>How evaluate() Walks the Catalogue</h2>
    <!-- wt-tabs: one tab only (or two: "with match" / "without match") -->
    <!-- wt-layout: code left, state right (catalogue index, applicable Set) -->
    <!-- Prev/Next/Play nav -->

  <!-- Section 4 -->
  <section class="scene" id="scene-cycles">
    <h2>Cycle Detection — DFS at Load Time</h2>
    <!-- wt-tabs: "Cycle detected" | "No cycle" -->
    <!-- Node graph with DFS coloring per step + code panel -->
    <!-- Prev/Next/Play nav -->

</main>
<footer>
```

---

## Key implementation details

**Interactive graph (Section 2):**

- Hardcode the 5 hello-review questions as a JS array (don't import the module)
- Use a `answers` plain object as state, updated by radio button `change` events
- After each change, call `evaluate(catalogue, answers)` and re-render node classes
- Node classes: `q-applicable` (full color) vs `q-hidden` (muted, dashed)
- Edge arrow: absolute-positioned `<div>` between the `q-needs` and `q-resolve`
  nodes using CSS `::after` for the arrowhead; keep it simple

**eval walkthrough (Section 3):**

- Pre-compute all steps statically; no live evaluation during step transitions
- Each step object: `{ hl, title, desc, applicable: ['q-welcome', ...], currentQ: 'q-resolve', highlight: 'evalOp' }`
- Right panel shows: catalogue list (current item highlighted), growing applicable Set chips, call-stack depth indicator when inside nested evalCondition

**Cycle walkthrough (Section 4):**

- Use a 3-node cycle: `A (no showWhen) → B (showWhen: A answered) → C (showWhen: B answered) → A (showWhen: C answered)`
- Wait — that's a cycle declared incorrectly in the showWhen keys, not the questions referencing each other. Correct: A has `showWhen: { C: { answered: true } }`, B has `showWhen: { A: { answered: true } }`, C has `showWhen: { B: { answered: true } }` — this creates the cycle C→A→B→C in dependency terms.
- Per step: update each node's color class (`dfs-white`, `dfs-gray`, `dfs-black`)
- When back edge found: flash the edge in `--conflict` red, show error banner

**allApplicableAnswered indicator:**

- At the bottom of Section 2, a "Complete Case?" badge that goes green when
  all currently-applicable questions have non-empty answers
- Implement as: after each answer change, run `allApplicableAnswered()` inline
  and update the badge
