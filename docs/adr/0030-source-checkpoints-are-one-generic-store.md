---
status: accepted
---

# Source checkpoints are one generic store; the window rule belongs to the source

**Where a polled source got to is kept in one store for every such source**,
`SourceCheckpointStore` in `tools.source_checkpoint`, keyed by a stable string
key, under `<base_dir>/_checkpoints/sources.db`. **The rule that turns a
committed watermark into the next span to fetch** is a pure function beside it,
`instant_window`, handed the watermark rather than reading it from the store.
A watermark is a UTC instant.

This supersedes the SharePoint-only `SharePointCheckpointStore`
(`tools.integrations.sharepoint_checkpoint`), which kept one `Modified`
watermark per list and computed the next window itself. Its key hygiene — a
list is its GUID, never its title; a site is credential-free and normalised —
survives as `SharePointSource` beside the Reader that polls the list.

## Why

- **The rule was never SharePoint's.** `end = source_now - safety_lag`, `start
  = committed - overlap`, and no window when `end` has not passed `committed`:
  a database polled on a `created_at` column needs it verbatim. Keeping it as a
  method on a SharePoint store meant the next polled source would either copy
  it or grow a second store with a second file. Both were about to happen — the
  question that prompted this was "how do I add a pipeline that fetches from a
  database since its last complete run".
- **What repeats is the ceremony, and the ceremony is what a new author gets
  wrong.** Read the watermark at the start, tolerating absence; derive this
  run's work by a pure rule; land the writes; commit as the *visible last act*,
  skipped under dry run, refused if it would go backwards. That contract is
  worth defining once and reading in one place.
- **A ledger is not a watermark.** The `notifications` pipeline also remembers
  what it has done, as a set of keys already acted on, anti-joined on the way
  through. That is a different shape: nothing is fetched by it, it has no
  ordering and so no monotonic guard, and it is correct at any cadence
  precisely because it reads no clock. Folding it into this store would give it
  a guard it cannot honour and the store set semantics it does not need. The
  two share a contract, not a class.
- **A run's time is never a source's watermark.** The run registry knows when a
  pipeline last succeeded; that is a fact about this box's clock. A watermark is
  a fact about the source, stamped by the source's clock, and only advanced once
  what it vouches for has been published. Under a failed run they diverge, and
  the watermark is the one that is right. Written down here because
  `FreshnessRequirement` makes the registry's answer easy to reach for.

## Considered options

- **Keep the SharePoint store and copy it per source.** Rejected: a second
  `_checkpoints/<thing>.db` per source kind, each restating the same monotonic
  guard and dry-run guard, is exactly the drift this repository keeps refusing
  elsewhere (one run-record schema, one migration ledger, one store registry).
- **One generic checkpoint covering both the cursor and the ledger.** Rejected
  for the reason above; the ledger is left to a later, separate packaging of
  what `notifications` hand-rolls.
- **A pluggable `Position` family with a stored kind discriminator.** Rejected:
  one kind exists — a UTC instant covers `Modified`, `created_at`, or any other
  timestamp column verbatim, so the motivating database case is a datetime too.
  A non-time cursor, if a source ever needs one, is an additive column, not a
  discriminator worth carrying speculatively.
- **A `(kind, key)` composite key with an identity Protocol.** Rejected: a
  stable string key does the job just as well, and neither shape actually
  *enforces* that a source's key stays stable — that is documentation either
  way, so the simpler key wins.
- **Make the commit a framework step**, so it inherits the ambient dry-run skip
  and lands a "checkpoint advanced to X" line in the run log an operator can
  read back. Deferred, not rejected: it is a `framework/run` change and stands
  on its own once the store is general. Until then the commit is guarded on
  `context.dry_run` by hand, as it always was.

## Consequences

- A new polled source is a stable string key, a Reader handed an
  `InstantWindow`, and the four visible lines in `run()`: `watermark`,
  `instant_window`, the landings, and `commit` after gold. See the checkpoint
  section of
  [adding-a-feed.md](../adding-a-feed.md#sourcecheckpointstorebase_dir--where-the-polling-got-to).
- **One on-disk change.** `_checkpoints/sharepoint.db` is renamed
  `_checkpoints/sources.db`, with no carry-over: `pipelines/sharepoint_cases`
  has never committed to a live base directory, only development and
  `--sample` rehearsal runs, so a development directory's old file is simply
  ignored and its next run is a first load. The going-live and backup notes
  now name `sources.db`.
- The glossary term is unchanged: **source checkpoint**, or **watermark** for
  the time-valued one. "Snapshot" stays reserved for the whole source at a
  moment.
