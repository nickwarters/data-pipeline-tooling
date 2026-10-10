# SaveQueue

`SaveQueue` owns debounced writes, ETag concurrency, retry backoff, and save
status, for Cases and for anything else a save target describes (an HR Form).
Views never use it directly. A route effect or focused action module enqueues
persistence and dispatches observable results back into page state.

## Quick reference

```js
// At the effect boundary, after loading a Case:
saveQueue.loadCase(row, { listName });

// Debounced field-level writes:
saveQueue.enqueue(caseId, 'answers', updatedAnswers);
saveQueue.enqueue(caseId, 'notes', newNotes);

// Bridge queue status, and when it last saved, into route state:
const unsubscribe = saveQueue.subscribeStatus((status) =>
  dispatch({
    type: 'case/save-status-changed',
    status,
    lastSavedAt: saveQueue.lastSavedAt,
  })
);

// Return unsubscribe from start(...) or its focused binding helper.
return unsubscribe;
```

All persistence goes through `SaveQueue` and `SharePointClient`; no view calls
`fetch()` or mutates the queue.

## Why it exists

Page code should not duplicate transport rules. Centralising them means the
same behaviour is used with `HttpSharePointClient` in SharePoint and
`MockSharePointClient` under `?mock=1` and in tests.

### Debounce

`enqueue(caseId, fieldName, value)` starts a 1500 ms timer. Enqueuing the same
field again resets that timer, so only the last value is sent while a Reviewer
is typing.

### ETag concurrency

Every PATCH uses the current ETag. After a `412 Precondition Failed`, the queue
fetches the latest row. If the server changed only another field, it refreshes
the ETag and retries. If Answers changed remotely, it moves to `conflict` and
does not overwrite them.

That last rule belongs to the **save target**, not the queue. A target is
`{ patch, get, baseline, isConflict }`: the field-level ETag-guarded write, the
re-read after a 412, what to remember of a loaded item, and whether a 412 is a
real conflict. `new SaveQueue(client)` uses the Case target
(`src/services/case-save-target.js`), whose rule is the Answers comparison
above, so every Case caller is unchanged. `new SaveQueue(client, { target })`
saves something else through the same debounce, retries and status. The HR
Form target arrives with the Form page that first saves one; its rule is that a
412 conflicts only when a field being saved changed remotely, because an
Employee and their manager each write their own fields of the same Form.
`loadCase(item)` loads any target's item (it needs only `id` and `etag`).

`loadCase(item, { readOnly: true })` marks an item the viewer may not edit, and
`enqueue` and `enqueueFields` then throw for it. The page keeps read-only items
away from the queue; the refusal makes a mistake there loud instead of a write
the access rule forbids.

### Retry backoff

Network and throttling failures retry with `[1s, 2s, 4s, 8s, 16s, 30s]` delays.
The queue reports `reconnecting` during retries.

### Status bridge

`subscribeStatus(listener)` immediately reports the current status and then
each transition: `saved`, `saving`, `reconnecting`, or `conflict`. Bind it in a
route effect and dispatch the value into page state. The view renders that
state like any other value. On Case Review that renderer is
`src/components/base/cora-status-banner.js` — the saving/reconnecting indicators,
the conflict banner with its Reload button, and once anything has saved, a quiet
"Last saved 15:32" in the reader's local 24-hour time. `lastSavedAt` is the ISO
instant of the last successful write, set before `saved` is announced, so a
listener reading it on `saved` sees the save that settled.

## Loading and list context

Call `loadCase(row, { listName })` after every successful fetch or re-fetch.
This seeds the ETag, baseline Answers, and the per-Case-Type list context used by
later writes.

```js
const options = { listName };
const row = await client.getCase(caseId, options);
if (!row) throw new Error(`Case ${caseId} was not found`);

saveQueue.loadCase(row, options);
dispatch({ type: 'case/loaded', case: row });
```

Use `whenIdle()` when an effect or flow must observe completion without forcing
the debounce early. Use `flushCase(caseId)` only at a deliberate transition
that must persist pending writes before continuing.

## Adding a saveable field

`enqueue` accepts any Case field name. No queue change is normally required.
Update the client mapper for the corresponding SharePoint column, then prove the
round trip and concurrency behaviour at the public client/queue seam.

## Focused action example

```js
export function changeNotes({ dispatch, saveQueue, caseId, notes }) {
  dispatch({ type: 'case/notes-changed', notes });
  saveQueue.enqueue(caseId, 'notes', notes);
}
```

The view dispatches `case/notes-changed`. The page action updates state and
enqueues the write. `SaveQueue` owns the debounce, ETag, retry, and conflict
rules.
