# 21. Versioned Question Bank snapshots for Completed Cases

Date: 2026-06-25

## Status

Accepted (amended by [ADR-0023], Jul 2026)

> **Amendment ([ADR-0023]).** `questionBankVersion` is stamped at the **reportable**
> milestone (Send Actions, or Complete Case on the no-actions path) rather than at final
> `Completed` — the freeze this ADR protects now begins when the Case becomes reportable
> and its Answers freeze. "A Completed Case resolves its catalogue from the versioned
> file" reads as "a **reportable** Case." Everything else (the hash contract, manifest,
> miss/fallback behaviour) is unchanged.
>
> [ADR-0023]: ./0023-case-lifecycle-and-reportable-milestone.md

## Context

A **Case** loads its **Question Bank** live: `CaseReviewViewModel.load()` imports the
current `case-types/{slug}.js`, filters out `deprecated` questions, and recomputes
the **Applicable Question** set from that catalogue against the Case's stored
**Answers** every time the Case is opened. For an **In-progress Case** this is
correct and intended ([ADR-0004], [ADR-0006]): bank edits propagate live, and the
CONTEXT.md example dialogue explicitly wants a newly-added Question Definition to
make the Case In-progress again.

For a **Completed Case** this is wrong. Re-opening a Case months after completion
renders **today's** bank, not the bank that was reviewed: questions added since
completion appear (blank), questions since `deprecated` vanish from the list, and
changed wording/options/`failureCriteria` are shown against the frozen Answers. A
Completed Case must be **frozen as-reviewed** — the questions, wording, and failure
logic that were in force when it completed are its definitive content.

This mirrors a gap already flagged on the reporting side: [ADR-0015] reads the
**latest** `case-types/{slug}.json` and derives per-question failure against
*today's* `failureCriteria`, documented there as an accepted v1 caveat with the
deferred fix being "a per-question failure snapshot at completion." Both surfaces —
the case-review UI and the Python reporting pipeline — need the same point-in-time
guarantee, and should be solved once.

Two framings of "freeze as-reviewed" were considered:

- **Embed a full question snapshot on each Case row.** Self-contained, but
  duplicates the entire question content onto every Case row ([ADR-0007] blob
  growth), and yields **no bank history** — "what did the bank look like in March?"
  becomes unanswerable because the answer is scattered across case rows.
- **Version the bank; reference it by hash.** Each published bank version is an
  immutable artifact with a content-derived identity; a Case stamps the version
  hash in force at completion and resolves content by lookup. Same as-reviewed
  guarantee, no per-row duplication, and a real stateful history falls out.

We choose the second. It also reuses identity machinery that already exists: the
compile drawer computes a `sha256` of the compiled output, and [ADR-0015]'s export
envelope already carries `hash` + `generatedAt`. This ADR promotes those two fields
from "nice provenance" to the durable lookup contract.

## Decision

### Artifacts and file layout

The publish/compile flow emits, per **Case Type**, into the Style Library beside
the module (`/Style Library/case-review/case-types/`):

| File | Role | Mutability |
| --- | --- | --- |
| `{slug}.js` | Runtime module ([ADR-0004]) — includes `computeOutcome` | overwritten on publish |
| `{slug}.json` | **Current** data-only export ([ADR-0015]) — the latest version | overwritten on publish |
| `{slug}.{hash}.json` | **Immutable** versioned export — one per distinct bank version | append-only, never overwritten or deleted |
| `{slug}.history.json` | **Manifest** — the ordered timeline of versions | append-only |

`{slug}.json` always equals the newest `{slug}.{hash}.json` (the same content; the
unhashed name is the "current" pointer). Versioned files and the manifest are
**append-only**, consistent with the deprecate-don't-delete posture: a version any
Completed Case might reference can never be removed.

### The hash contract

The version identity is a content hash, subject to four rules:

1. **Hash a canonical *data* form, not the pretty-printed file.** Compute the digest
   over a normalized content model (stable key order, canonical option handling),
   decoupled from human-readable file formatting, so that re-formatting the emitter
   never silently re-hashes identical content.
2. **Hash only the semantic content** — the `questions` array and `slug`. Explicitly
   **exclude** `generatedAt`, `label`, and the `hash` field itself, so that
   re-publishing identical questions yields the *same* hash (dedup) regardless of
   timestamp.
3. **Store the full digest**, not a display truncation. The compile drawer's 6-byte
   (`.slice(0, 6)`) form is a UI badge only; the durable `questionBankVersion`,
   filename, and manifest entries use the full digest (or a ≥128-bit prefix). A
   collision here silently resolves a Case to the wrong content.
4. **Produced once by the compiler, opaque to all readers.** Only the compile step
   authors the hash; the app and the Python pipeline treat it as an opaque label and
   **never recompute** it (JS and Python will not agree byte-for-byte on a canonical
   form). The envelope's `hash` is the single source of truth.

A content hash gives identity and dedup but **no ordering**; ordering is the
manifest's job (below).

### `generatedAt` and ordering

- `generatedAt` lives authoritatively **inside each version file's envelope**
  (`{slug}.{hash}.json`). It is *not* required on the Case row (derivable via the
  hash); a denormalized `questionBankGeneratedAt` on the row is an optional
  readability convenience only.
- `{slug}.history.json` is the **timeline**: an ordered, append-only list of
  `{ hash, generatedAt }` (the `generatedAt` duplicated from each envelope so the
  manifest is sortable/seekable without fetching every version):

  ```json
  {
    "slug": "complaint-review",
    "versions": [
      { "hash": "sha256:aaa…", "generatedAt": "2026-01-10T09:00:00Z" },
      { "hash": "sha256:bbb…", "generatedAt": "2026-03-02T14:30:00Z" },
      { "hash": "sha256:ccc…", "generatedAt": "2026-06-05T09:30:00Z" }
    ]
  }
  ```

  "What was the bank on date X?" = fetch the manifest, take the last version with
  `generatedAt ≤ X`, fetch that `{slug}.{hash}.json`. The last entry is also what
  `{slug}.json` currently points at.

This separates the two access patterns cleanly:

| Question | Mechanism | Needs ordering |
| --- | --- | --- |
| "What did *this Case* see?" | hash on the Case row → `{slug}.{hash}.json` | No |
| "What was the bank *on date X*?" | manifest → date→hash → file | Yes (manifest) |

### Case row and load behavior

- At **completion**, the completion write stamps `questionBankVersion` (the full
  hash of the version then current) onto the Case row, in the **same
  ETag-guarded PATCH** as `status` / `completedAt` / `outcomeAtCompletion`
  (mirrors [ADR-0012]).
- On **load**, a Completed Case with a `questionBankVersion` resolves its catalogue
  from `{slug}.{hash}.json` — that is the definitive question set, wording, options,
  `showWhen`, and `failureCriteria`. An In-progress Case loads the live module
  exactly as today.
- **Miss behavior:** if a stamped hash has no published `{slug}.{hash}.json`
  (publish bypassed, or hash drift from a violated rule above), the Case falls back
  to the live module with a visible "as-reviewed version unavailable" warning — it
  **never hard-fails**.
- **Backward compatibility:** Cases completed before this landed have no
  `questionBankVersion`; treat them as un-snapshotted and fall back to live, the
  same pattern [ADR-0012] uses for null `outcomeAtCompletion`.

### Reporting (extends [ADR-0015])

The Python pipeline uses the **same** artifacts, gaining point-in-time stability:

- Read `questionBankVersion` off the Case row → fetch `{slug}.{hash}.json` → derive
  per-question failure against the `failureCriteria` **as at completion**, not
  today's. This closes the "latest-export semantics" caveat in [ADR-0015].
- **Failure conditions are carried by both artifacts.** `failureCriteria` is
  per-question *data* and appears in both `{slug}.js` and every `{slug}.json` /
  `{slug}.{hash}.json`. The outcome *function* (`computeOutcome`) remains in the
  `.js` only; reporting never recomputes the case verdict (it reads the frozen
  `outcomeAtCompletion`).
- **Labels — structure is point-in-time, presentation is current.** `labelIds` on a
  question are *structure* and are frozen in the versioned file alongside wording.
  Label *definitions* (`id → name, color`) are *presentation* and are resolved from
  the **current** `{slug}.json` so a label rename/recolor applies consistently
  across all reports. This is the one deliberate "current" exception. (Both require
  adding labels to the export — neither `labelIds` nor the label table is in the
  [ADR-0015] contract today; this ADR adds them.)

## Consequences

**Positive**

- Completed Cases are frozen as-reviewed on both surfaces; no drift from later bank
  edits. The UI and the Python pipeline resolve the *same* content-addressed
  version, so they cannot disagree.
- A real, queryable bank history (the manifest) without a new SharePoint list — uses
  the existing deploy flow, consistent with [ADR-0012]/[ADR-0015]'s "no new list"
  preference.
- Content-addressing dedupes identical re-publishes and is tamper-evident.

**Negative**

- A Completed Case now needs a **second fetch** (the versioned export) on load —
  cheap and cacheable, since version files are immutable.
- **Depends on the publish flow emitting JSON**, which is not yet built:
  `compileBank()` currently emits only the `.js`. A `compileExport()` (function-free
  projection + `hash`/`generatedAt` envelope), the content-addressed write, the
  manifest append, and `{slug}.json` pointer update are all prerequisites.
- Versioned files and manifests are **append-only and never garbage-collected** — a
  version any Completed Case references can never be deleted, and that cannot be
  cheaply disproven. Accepted as immutable, cheap JSON.
- Labels split-brain (frozen `labelIds`, current name/color) is a deliberate
  exception to "the version file is the whole truth"; if a `labelId` is later
  repurposed, current lookup can mislabel a historical question.

## Implementation order

1. `compileExport()` emits the data-only `{slug}.json` ([ADR-0015], still unbuilt).
2. Publish writes the content-addressed `{slug}.{hash}.json`, appends to
   `{slug}.history.json`, and updates the `{slug}.json` pointer.
3. Completion stamps `questionBankVersion` on the Case row.
4. `CaseReviewViewModel.load()` resolves a Completed Case's catalogue from the
   versioned file, with live fallback + warning on miss.
5. Add `labelIds` (frozen) and the label table to the export; reporting resolves
   label name/color from current.

[ADR-0004]: ./0004-case-type-config-as-js-modules.md
[ADR-0006]: ./0006-applicability-graph-and-outcome-function.md
[ADR-0007]: ./0007-case-storage-shape.md
[ADR-0012]: ./0012-outcome-snapshot-at-completion-for-reporting.md
[ADR-0015]: ./0015-data-only-case-type-export-for-reporting.md
