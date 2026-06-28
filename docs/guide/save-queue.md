# SaveQueue

## Quick reference

```js
// Receive saveQueue as a property; never construct one inside a component.
this.saveQueue.enqueue(caseId, 'answers', updatedAnswers); // debounced PATCH
this.saveQueue.enqueue(caseId, 'notes', newNotes);

// Show save status in the UI:
this.subscribe(this.saveQueue.status, (s) => {
  // s is 'saved' | 'saving' | 'reconnecting' | 'conflict'
  statusEl.textContent = s;
});

// Seed the ETag after loading a case row:
this.saveQueue.loadCase(row);
```

**Rule: components never call `fetch()` directly. All persistence goes through `SaveQueue.enqueue`.**

---

## Why SaveQueue exists

Components don't know about ETags, concurrency conflicts, retry backoff, or debouncing. Those concerns belong in one place so they can be tested and reasoned about independently. `SaveQueue` is that place.

This design also makes mock-first development work: in test and `?mock=1` mode, the same `SaveQueue` is wired to `MockSharePointClient`, which never makes a real HTTP request. Components don't need to know or care which client is behind the queue.

---

## How it works

### Debounce (1500 ms)

`enqueue(caseId, fieldName, value)` sets a 1500 ms timer. If the same field is enqueued again before the timer fires, the timer resets. Only the last value is sent. This prevents a flood of PATCH requests while a Reviewer is typing.

### ETag concurrency

Every PATCH is sent with an `If-Match` header containing the current ETag. If the server returns `412 Precondition Failed`, `SaveQueue` fetches the latest row and checks whether the remote answers have changed since the last save. If the remote answers match the baseline (i.e., a concurrent writer only changed a different field), `SaveQueue` refreshes the ETag and retries automatically. If answers differ, it sets status to `'conflict'` and stops — the component (or a `<cr-status-banner>`) must prompt the Reviewer to reload.

### Retry backoff

Non-412 errors (network timeouts, throttling) trigger exponential backoff using the schedule `[1s, 2s, 4s, 8s, 16s, 30s]`. Status is set to `'reconnecting'` during retries.

### Status signal

`saveQueue.status` is a read-only signal. Subscribe to it in `<cr-status-banner>` or any component that needs to display save state.

---

## Using `loadCase`

Call `saveQueue.loadCase(row)` whenever you fetch or re-fetch a case row. This updates the internal ETag and baseline answers so that subsequent PATCHs use the correct precondition.

```js
const row = await context.client.getCase(id);
if (row) {
  context.saveQueue.loadCase(row);
  answersSignal.set(row.answers ?? {});
}
```

---

## Adding a new saveable field

No changes to `SaveQueue` are needed. `enqueue` accepts any `fieldName` string and passes it as the key in the PATCH body. On the `HttpSharePointClient` side, make sure `itemFromRow` in `http-sharepoint-client.js` maps the new field to the correct SharePoint column name.

---

## Worked example: a component that saves notes

> TODO(simplify-ui): Rewrite this example as a plain `Notes(props)` function
> that returns `h()` nodes and wires input events to `SaveQueue`; class-backed
> `CRElement` examples should become an advanced integration-shell pattern only.

```js
// src/components/cr-notes.js  (simplified)
// @ts-check
import { CRElement } from './cr-element.js';

/** @typedef {import('../services/save-queue.js').SaveQueue} SaveQueue */

export class CRNotes extends CRElement {
  constructor() {
    super();
    this.notes = '';
    /** @type {SaveQueue | null} */
    this.saveQueue = null;
    this.caseId = '';
  }

  connectedCallback() {
    const textarea = document.createElement('textarea');
    textarea.value = this.notes;

    textarea.addEventListener('input', (ev) => {
      if (!this.saveQueue || !this.caseId) return;
      const value = /** @type {HTMLTextAreaElement} */ (ev.target).value ?? '';
      // Enqueue the save — SaveQueue handles debounce, ETag, and retry.
      this.saveQueue.enqueue(this.caseId, 'notes', value);
    });

    this.replaceChildren(textarea);
  }
}

customElements.define('cr-notes', CRNotes);
```

The component never calls `fetch()`. It never knows the ETag. It never retries. That's all `SaveQueue`'s responsibility.
