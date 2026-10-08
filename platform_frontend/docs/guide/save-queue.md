# SaveQueue

`SaveQueue` owns debounced Case writes, ETag concurrency, retry backoff, and save
status. Views never use it directly. A route effect or focused action module
enqueues persistence and dispatches observable results back into page state.

## Quick reference

```js
// At the effect boundary, after loading a Case:
saveQueue.loadCase(row, { listName });

// Debounced field-level writes:
saveQueue.enqueue(caseId, 'answers', updatedAnswers);
saveQueue.enqueue(caseId, 'notes', newNotes);

// Bridge queue status into route state:
const unsubscribe = saveQueue.subscribeStatus((status) =>
  dispatch({ type: 'case/save-status-changed', status })
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

### Retry backoff, and failures that are not retried

A failed write is classified by `src/services/save-failure.js` before the queue
decides anything. The client attaches the classification to the `PatchResult`
as `failure`; a result without one is classified from its `status`.

| Failure            | Typical cause                                                | What the queue does                            |
| ------------------ | ------------------------------------------------------------ | ---------------------------------------------- |
| `network`          | no response at all (offline, VPN dropped)                    | retries on the backoff, reports `reconnecting` |
| `unavailable`      | 502 / 503 / 504                                              | same as `network`                              |
| `invalid-value`    | 400 / 413, or a 500 whose message says the value was refused | gives up at once                               |
| `person-not-found` | `EnsureUser` could not resolve a Person column's account     | gives up at once                               |
| `forbidden`        | 401 / 403 after the form digest was refreshed                | gives up at once                               |
| `not-found`        | 404: the Case or its list is gone                            | gives up at once                               |
| `unknown`          | anything else                                                | two more attempts, then gives up               |

Connection failures retry with `[1s, 2s, 4s, 8s, 16s, 30s]` delays, the last
repeating for as long as the tab is open. Once the attempts run past the end of
the schedule the outage is reported as long, and the banner adds "check your
connection or VPN". Throttling (429) never reaches the queue: the client waits
out `Retry-After` itself.

Giving up records a failure notice — the Case, the fields the write carried and
the classification — and settles the queue on `failed`. Sending the same write
again would fail the same way, so it is not retried; a later write carrying any of the same fields that
succeeds clears the notice. A recorded failure no longer keeps the queue busy,
so other fields still save and `flushCase` returns `false` straight away rather
than waiting.

Before the first attempt the client removes the invisible control characters
SharePoint refuses (`src/lib/storable-text.js`): vertical tab and form feed, the
soft line breaks Word and Outlook paste, become newlines, and the rest are
dropped. So `invalid-value` is the backstop, not the usual path.

### Status bridge

`subscribeStatus(listener)` immediately reports the current status and then
each transition: `saved`, `saving`, `reconnecting`, `failed`, or `conflict`.
The listener's second argument is the detail behind it: the recorded failure
notices and whether a connection outage has run long. Bind it in a route effect
and dispatch the value into page state. The view renders that state like any
other value. On Case Review that renderer is
`src/components/base/cora-status-banner.js` — the saving/reconnecting
indicators, the failure banner saying what was not saved and why (worded by
`describeSaveFailure`), and the conflict banner with its Reload button. A
Responsible Party that could not be found is put back, by the page rather than
the queue, to the person the picker showed before the pick, so the picker never
shows someone who was not saved; text is never put back,
because the person needs it to fix the problem.

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
