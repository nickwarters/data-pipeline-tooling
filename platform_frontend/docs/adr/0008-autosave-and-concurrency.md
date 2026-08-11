# Auto-save semantics and concurrency

## Status

Accepted. Still current; [ADR-0034](./0034-store-driven-views-supersede-component-owned-state.md)
moves orchestration into effects without changing `SaveQueue`, debounce, retry,
or ETag semantics.

The framework auto-saves Case mutations through a single `SaveQueue` primitive — every Web Component that mutates Case data goes through it; nothing calls REST directly.

### Save trigger

**Per-field, debounced 1500ms** after the last edit. No "Save" button. Applies uniformly to Answer changes, Justification text, Notes — one consistent rule. Conversation messages are send-on-button-press (no debounce).

### What's PATCHed

**Field-level only.** SharePoint REST `MERGE` semantics; the body contains only the changed field. Conversation polling can't clobber an in-progress Answer save and vice versa.

### Concurrency

**ETag-based optimistic.** Every fetch captures the row's ETag; every PATCH sends `If-Match`. That holds for single-item reads only — a collection read under the client's `odata=nometadata` Accept header carries no ETag on any row, so a flow that writes a row it found by listing (self-allocation's claim) re-reads that one row to obtain the ETag its `If-Match` needs. On 412:

- If only non-conflicting fields changed remotely (e.g., Conversation), silently re-fetch, merge, retry our PATCH with the new ETag.
- If `Answers` changed remotely, surface a non-disruptive "case was edited elsewhere — reload" banner. Don't auto-overwrite the reviewer's edits.

The Dashboard's self-allocation claim has a narrower read boundary. It re-reads
each listed candidate immediately before its PATCH because the collection row has
no ETag. A transport rejection from one candidate's re-read is recorded and that
candidate is skipped so later candidates can be checked. A `null` or otherwise
non-claimable re-read remains an ordinary skip. If every candidate re-read rejects,
the first read error is surfaced and no empty availability state is published;
the allocation guard is reset so a later request can retry. PATCH failures keep
their existing semantics and are not absorbed by this per-candidate read boundary.

### Network failure

**In-memory retry queue, exponential backoff** (1s, 2s, 4s, ... capped ~30s). UI indicator: `Saved` / `Saving…` / `Reconnecting…` / `Conflict — reload`. **No `localStorage` persistence in v1** — the complexity (per-case keys, eviction, stale merges) outweighs the rare benefit on a corporate intranet.

### Status transitions

Recomputed client-side after each save by invoking the Case Type's `outcome`/applicability logic. The "Complete Case" button shows/hides accordingly. The `Status` field itself only changes when the Reviewer explicitly clicks Complete.

### Polling

**Refresh on tab focus** for Conversation. Question Definitions come from the per-Case-Type bank text artifact loaded with the Case Type config; changing that artifact requires the normal publish/deploy path and a reload, not list polling. No periodic polling in v1.

### Behavioural rules worth being explicit about

- An answer to a now-orphaned question (its trigger was un-toggled) **stays in the blob**; the UI just hides it. Preserves intent if the trigger flips back.
- A newly published bank version is used when an In-progress Case next reloads its Case Type config. Any newly-applicable Question Definition then blocks completion until answered. Reportable Cases remain pinned to their stamped version (ADR-0021).
