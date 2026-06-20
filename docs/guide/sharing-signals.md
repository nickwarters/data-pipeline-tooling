# Sharing Signals Between Components

## Quick reference

```js
// Create the signal in the parent (route handler or page component).
const answers = signal({});

// Pass it as a property to each component that needs it.
const questionList = document.createElement('cr-question-list');
questionList.answersSignal = answers;

const outcome = document.createElement('cr-outcome');
outcome.answersSignal = answers;

container.replaceChildren(questionList, outcome);

// Any component that calls answers.set(…) causes every subscriber to update.
```

---

## The pattern

Signals are plain objects (`{ get, set }`). To share a signal, create it in one place (typically the route handler or a parent page component) and pass it down to children as a typed property before the children are connected to the DOM.

This is the framework's substitute for a global store or prop-drilling through attributes. It keeps state co-located with the code that owns it, while allowing multiple components to react to the same value without knowing about each other.

---

## When to share vs. keep local

| Situation                                                       | Approach                                                        |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| A value is only relevant to one component                       | Create the signal inside `connectedCallback` — it's local state |
| Two sibling components need to read and/or write the same value | Create the signal in their common ancestor and pass it to both  |
| A child needs to write back to a parent                         | Pass the writable signal down; the child calls `.set()`         |

---

## Worked example: `<cr-question-list>` and `<cr-outcome>` sharing answers

Below is a simplified version of how the case review page wires two components together via a shared signal.

```js
// src/routes/case.js  (simplified)
// @ts-check
import { signal } from '../lib/signal.js';

export function register(router, context) {
  router.register('#/case/:id', {
    mount(container, { id }) {
      // The answers signal is owned by this route handler.
      // Both components below read and/or write it.
      const answers = signal(
        /** @type {Record<string, import('../sharepoint-client.js').Answer>} */ ({})
      );

      // Load the case and seed the signal once the data arrives.
      context.client.getCase(id).then((row) => {
        if (row) answers.set(row.answers ?? {});
      });

      // cr-question-list: displays questions, writes answers back via the signal.
      const questionList = document.createElement('cr-question-list');
      questionList.answersSignal = answers;
      questionList.saveQueue = context.saveQueue;
      questionList.caseId = id;

      // cr-outcome: recomputes the verdict whenever answers change.
      const outcome = document.createElement('cr-outcome');
      outcome.answersSignal = answers;

      container.replaceChildren(questionList, outcome);
    },
    unmount() {},
  });
}
```

Inside `cr-question-list`, when a Reviewer submits an answer:

```js
// src/components/cr-question-list.js  (excerpt)
connectedCallback() {
  // …build question DOM…

  this.addEventListener('cr-answer', (/** @type {CustomEvent} */ ev) => {
    // 1. Update the shared signal — cr-outcome reacts immediately.
    const next = { ...this.answersSignal.get(), [ev.detail.questionId]: ev.detail.answer };
    this.answersSignal.set(next);

    // 2. Persist to SharePoint (debounced, via SaveQueue — never fetch() directly).
    this.saveQueue.enqueue(this.caseId, 'answers', next);
  });
}
```

Inside `cr-outcome`, `subscribe` reacts without polling or events:

```js
// src/components/cr-outcome.js  (excerpt)
connectedCallback() {
  const verdictEl = document.createElement('span');

  this.subscribe(this.answersSignal, answers => {
    const { verdict } = this.computeOutcome(answers);
    verdictEl.textContent = verdict;
  });

  this.replaceChildren(verdictEl);
}
```

The two components never import each other. The signal object is the only shared interface.

---

## Typed property declarations

Always declare shared signal properties in the constructor so `tsc --checkJs` can type-check them:

```js
constructor() {
  super();
  /** @type {{ get: () => Record<string, import('../sharepoint-client.js').Answer>, set: (v: Record<string, import('../sharepoint-client.js').Answer>) => void }} */
  this.answersSignal = { get: () => ({}), set: () => {} };  // safe default; replaced at mount time
}
```
