# Auto-save semantics and concurrency

The framework auto-saves Case mutations through a single `SaveQueue` primitive — every Web Component that mutates Case data goes through it; nothing calls REST directly.

### Save trigger
**Per-field, debounced 1500ms** after the last edit. No "Save" button. Applies uniformly to Answer changes, Justification text, Notes — one consistent rule. Conversation messages are send-on-button-press (no debounce).

### What's PATCHed
**Field-level only.** SharePoint REST `MERGE` semantics; the body contains only the changed field. Conversation polling can't clobber an in-progress Answer save and vice versa.

### Concurrency
**ETag-based optimistic.** Every fetch captures the row's ETag; every PATCH sends `If-Match`. On 412:
- If only non-conflicting fields changed remotely (e.g., Conversation), silently re-fetch, merge, retry our PATCH with the new ETag.
- If `Answers` changed remotely, surface a non-disruptive "case was edited elsewhere — reload" banner. Don't auto-overwrite the reviewer's edits.

### Network failure
**In-memory retry queue, exponential backoff** (1s, 2s, 4s, ... capped ~30s). UI indicator: `Saved` / `Saving…` / `Reconnecting…` / `Conflict — reload`. **No `localStorage` persistence in v1** — the complexity (per-case keys, eviction, stale merges) outweighs the rare benefit on a corporate intranet.

### Status transitions
Recomputed client-side after each save by invoking the Case Type's `outcome`/applicability logic. The "Complete Case" button shows/hides accordingly. The `Status` field itself only changes when the Reviewer explicitly clicks Complete.

### Polling
**Refresh on tab focus** for Conversation and Question Definitions. No periodic polling in v1.

### Behavioural rules worth being explicit about
- An answer to a now-orphaned question (its trigger was un-toggled) **stays in the blob**; the UI just hides it. Preserves intent if the trigger flips back.
- Admin adds a Question Definition mid-review → next focus refresh, the new question becomes applicable, "Complete Case" hides, a subtle "new question added" hint shows.
