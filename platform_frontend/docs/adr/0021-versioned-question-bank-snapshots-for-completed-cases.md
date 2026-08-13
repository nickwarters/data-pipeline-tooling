# 21. Versioned Question Bank snapshots for Completed Cases

Date: 2026-06-25

## Status

Accepted (amended by [ADR-0023], Jul 2026)

> **Amendment (2026-08-13, artifact layout).** The artifacts below are stored
> **beside the bank they belong to**, in `case-types/banks/`, as JSON in `.txt`
> files — not as `.json` in a separate `/Style Library/case-review/case-types/`
> folder. Three things forced it: SharePoint Subscription Edition blocks or
> mis-serves `.json` (the reason the bank artifact was already `.txt`); a
> `sha256:`-prefixed hash cannot appear in a Windows or SharePoint filename, so
> the identity is the bare digest — one value on the Case row, in the envelope
> and in the filename, rather than one form stripped at the edge; and the folder
> this ADR named was never where
> the deploy actually puts the modules, so "beside the module" was not true of
> the path as written. Names are composed in one place,
> `src/lib/bank-artifacts.js`, and read relative to the module that reads them,
> which retires the per-environment `exportBasePath` from [ADR-0033] — a UAT
> deploy now reads UAT's artifacts because of where it was deployed, not
> because it was told. The **decision** is unchanged: content-addressed
> immutable versions, a hash stamped at the reportable milestone, live fallback
> on a miss.
>
> | Role             | Was                           | Is                                                         |
> | ---------------- | ----------------------------- | ---------------------------------------------------------- |
> | Current bank     | `case-types/banks/{slug}.txt` | unchanged — and it **is** the current version              |
> | Current export   | `{slug}.json`                 | **removed**; the current identity is derived from the bank |
> | Versioned export | `{slug}.{hash}.json`          | `case-types/banks/{slug}.<hex>.txt`                        |
> | Manifest         | `{slug}.history.json`         | not built; the versions on disk are the timeline           |
>
> **The current-version pointer is gone.** A file whose job was to state which
> version is current is a second copy of a fact the bank already carries, and the
> two can disagree — a bank edited without republishing keeps claiming the old
> version, and a Case completed against it freezes on content the Reviewer never
> saw. `src/lib/bank-version.js` derives the identity from the bank's canonical
> content instead, so there is nothing to keep in step. Its content duplicated
> the newest versioned file anyway, save for the labels table, which the bank
> artifact already carries.
>
> This narrows rule 4 rather than breaking it. "Readers never recompute" was
> recorded because _JS and Python_ will not agree byte-for-byte on a canonical
> form, and that still holds: nothing outside JavaScript computes an identity.
> Inside JavaScript there is one implementation, shared by the compiler, both
> clients and the publish script, so they cannot disagree with each other.
>
> `scripts/publish-bank.js` is the local half of the publish flow: it compiles a
> bank and writes the immutable copy its identity names. It is idempotent and
> never rewrites a versioned file. Forgetting to run it does not produce stale
> content — it produces a Case stamped with a version no file answers to, which
> takes the documented fallback and is caught by a test.

> **Amendment ([ADR-0023]).** `questionBankVersion` is stamped at the **reportable**
> milestone (Send Actions, or Complete Case on the no-actions path) rather than at final
> `Completed` — the freeze this ADR protects now begins when the Case becomes reportable
> and its Answers freeze. "A Completed Case resolves its catalogue from the versioned
> file" reads as "a **reportable** Case." Everything else (the hash contract, manifest,
> miss/fallback behaviour) is unchanged.
>
> [ADR-0023]: ./0023-case-lifecycle-and-reportable-milestone.md

> **Amendment (2026-07-09, issue #324).** The **Question Bank** is the
> standalone, versionable content artifact. Runtime `case-types/{slug}.js`
> modules keep operational wiring only and reference their bank content from
> `case-types/banks/{slug}.txt`; they do not own a second editable copy of
> `questions`, labels, or Outcome vocabulary. The curator workbench reads and
> compiles the same current-bank JSON text artifact. The repo/dev-loop artifact
> uses `.txt` because SharePoint SE can block or mis-serve `.json`; the content is
> still JSON text and is parsed explicitly.

> **Amendment (2026-07, #555).** The class this ADR was recorded against,
> `CaseReviewViewModel`, has since been renamed to `CaseLoader`
> (`src/lib/case-loader.js`); the references below use the current name. The
> rename carried no behavioural change — `load()` still resolves a reportable
> Case's catalogue from the versioned export, with live fallback on a miss.

## Context

A **Case** loads its **Question Bank** live: `CaseLoader.load()` imports the
current `case-types/{slug}.js`, whose operational config references the current
standalone `case-types/banks/{slug}.txt`, filters out `deprecated` questions,
and recomputes the **Applicable Question** set from that catalogue against the
Case's stored **Answers** every time the Case is opened. For an **In-progress Case**
this is correct and intended ([ADR-0004], [ADR-0006]): bank edits propagate live, and the
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
_today's_ `failureCriteria`, documented there as an accepted v1 caveat with the
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

| File                  | Role                                                           | Mutability                                |
| --------------------- | -------------------------------------------------------------- | ----------------------------------------- |
| `{slug}.js`           | Runtime module ([ADR-0004]) — includes `computeOutcome`        | overwritten on publish                    |
| `{slug}.json`         | **Current** data-only export ([ADR-0015]) — the latest version | overwritten on publish                    |
| `{slug}.{hash}.json`  | **Immutable** versioned export — one per distinct bank version | append-only, never overwritten or deleted |
| `{slug}.history.json` | **Manifest** — the ordered timeline of versions                | append-only                               |

`{slug}.json` always equals the newest `{slug}.{hash}.json` (the same content; the
unhashed name is the "current" pointer). Versioned files and the manifest are
**append-only**, consistent with the deprecate-don't-delete posture: a version any
Completed Case might reference can never be removed.

In the repo/dev loop before the publish writer exists, the editable current-bank
artifact lives under `case-types/banks/{slug}.txt`. A runtime Case Type module may
import that artifact to expose `config.questions`, `config.labels`,
`config.outcomeOptions`, and `config.defaultOutcomeId` through the existing
`CaseTypeConfig` contract, but those fields are references to the standalone bank,
not a second content home. The `.txt` extension is a deployment constraint only;
the artifact body remains JSON so non-JavaScript tooling can parse the same
content.

### The hash contract

The version identity is a content hash, subject to four rules:

1. **Hash a canonical _data_ form, not the pretty-printed file.** Compute the digest
   over a normalized content model (stable key order, canonical option handling),
   decoupled from human-readable file formatting, so that re-formatting the emitter
   never silently re-hashes identical content.
2. **Hash only the semantic content** — the `questions` array and `slug`. Explicitly
   **exclude** `generatedAt`, `label`, and the `hash` field itself, so that
   re-publishing identical questions yields the _same_ hash (dedup) regardless of
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
  (`{slug}.{hash}.json`). It is _not_ required on the Case row (derivable via the
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

| Question                         | Mechanism                                   | Needs ordering |
| -------------------------------- | ------------------------------------------- | -------------- |
| "What did _this Case_ see?"      | hash on the Case row → `{slug}.{hash}.json` | No             |
| "What was the bank _on date X_?" | manifest → date→hash → file                 | Yes (manifest) |

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
  per-question _data_ and appears in both `{slug}.js` and every `{slug}.json` /
  `{slug}.{hash}.json`. The outcome _function_ (`computeOutcome`) remains in the
  `.js` only; reporting never recomputes the case verdict (it reads the frozen
  `outcomeAtCompletion`).
- **Labels — structure is point-in-time, presentation is current.** `labelIds` on a
  question are _structure_ and are frozen in the versioned file alongside wording.
  Label _definitions_ (`id → name, color`) are _presentation_ and are resolved from
  the **current** `{slug}.json` so a label rename/recolor applies consistently
  across all reports. This is the one deliberate "current" exception. (Both require
  adding labels to the export — neither `labelIds` nor the label table is in the
  [ADR-0015] contract today; this ADR adds them.)

## Consequences

**Positive**

- Completed Cases are frozen as-reviewed on both surfaces; no drift from later bank
  edits. The UI and the Python pipeline resolve the _same_ content-addressed
  version, so they cannot disagree.
- A real, queryable bank history (the manifest) without a new SharePoint list — uses
  the existing deploy flow, consistent with [ADR-0012]/[ADR-0015]'s "no new list"
  preference.
- Content-addressing dedupes identical re-publishes and is tamper-evident.

**Negative**

- A Completed Case now needs a **second fetch** (the versioned export) on load —
  cheap and cacheable, since version files are immutable.
- **Depends on the publish flow writing JSON**, which is only partly built:
  `compileBank()` emits the editable current-bank JSON and `compileExport()` emits
  the function-free export envelope, but the SharePoint write flow, the
  content-addressed write, the manifest append, and `{slug}.json` pointer update
  remain prerequisites.
- Versioned files and manifests are **append-only and never garbage-collected** — a
  version any Completed Case references can never be deleted, and that cannot be
  cheaply disproven. Accepted as immutable, cheap JSON.
- Labels split-brain (frozen `labelIds`, current name/color) is a deliberate
  exception to "the version file is the whole truth"; if a `labelId` is later
  repurposed, current lookup can mislabel a historical question.

## Implementation order

1. `case-types/banks/{slug}.txt` is the repo/dev-loop current bank and
   `compileBank()` emits that same editable artifact.
2. `compileExport()` emits the data-only `{slug}.json` ([ADR-0015]).
3. Publish writes the content-addressed `{slug}.{hash}.json`, appends to
   `{slug}.history.json`, and updates the `{slug}.json` pointer.
4. Completion stamps `questionBankVersion` on the Case row.
5. `CaseLoader.load()` resolves a Completed Case's catalogue from the
   versioned file, with live fallback + warning on miss.
6. Add `labelIds` (frozen) and the label table to the export; reporting resolves
   label name/color from current.

[ADR-0004]: ./0004-case-type-config-as-js-modules.md
[ADR-0006]: ./0006-applicability-graph-and-outcome-function.md
[ADR-0007]: ./0007-case-storage-shape.md
[ADR-0012]: ./0012-outcome-snapshot-at-completion-for-reporting.md
[ADR-0015]: ./0015-data-only-case-type-export-for-reporting.md
[ADR-0033]: ./0033-uat-environment.md
