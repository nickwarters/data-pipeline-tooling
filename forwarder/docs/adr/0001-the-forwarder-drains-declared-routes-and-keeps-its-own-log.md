---
status: accepted
---

# The Forwarder drains declared routes and keeps its own advisory log

[ADR-0018](../../../docs/adr/0018-report-feeds-published-locally-delivered-outside-the-framework.md)
decided that a Pipeline publishes a **Deliverable** to a local outbox and stops,
and that delivery belongs to something outside the framework. This decides what
that something is.

The **Forwarder** is a long-running loop in its own top-level `forwarder/`
project. Each pass it scans the destination directories named in its
`routes.yaml`, takes the files that have been still long enough to be finished,
hands each to that route's handler, and moves what succeeded to an archive. It
imports nothing from `framework/`.

## Why

**Delivery is irreducibly per-destination, so the Forwarder is an application,
not a script.** A document library takes the file as-is; a list needs it parsed
into items; SAS needs a copy *and* a script run against it; another team needs a
plain move. One handler per route, each behind a seam with a fake, because the
real clients are Windows-only — the file client is `shutil` over a WebDAV path,
authenticated ambiently by the account the loop runs as. It uses that client's
`copy`, never its `move`: a failure part-way through a move loses the file, and
copy-then-archive keeps a retry idempotent.

**It lives in this repository because the outbox layout is a contract between
two codebases.** `tools.deliverables` owns `<base_dir>/deliverables/<destination>/`
and the Forwarder watches it. In one repository a change to that layout breaks
the Forwarder's tests in the same commit; in two, the producer changes the path
and the consumer finds out in production. Co-location is not importing — the
dependency stays at zero.

**It drains and archives rather than mirroring, so the filesystem is the state.**
A mirror must remember what it already sent, and that ledger can disagree with
reality. Draining cannot: a file in the outbox *is* a file that is pending. Three
things fall out for free — retry is simply that the file is still there, an
operator reads pending-versus-done by listing two directories, and a crash
mid-delivery needs no recovery logic because nothing was recorded to be
inconsistent with.

**Routes are declared, and the declaration is the whole world.** The Forwarder
opens only the directories its `routes.yaml` names, which means a producer
writing to a misspelled destination would deliver nothing, silently, forever.
That failure is closed at the source instead of by a runtime warning: producers
name destinations through the constants in `tools.deliverables`, and a test
asserts every one of them has a route. The typo fails a commit rather than going
quiet for three weeks. Credentials are never in the file — it names one, the
environment supplies it, because a checked-in config that wants a password
eventually gets one pasted into it.

**Readiness is a quiet period, backed by validation rather than by a rename.**
The obvious rule is for producers to write to a temporary name and rename into
place, so only complete files are ever visible. It was rejected: it spreads the
Forwarder's contract across every Writer in the framework, for a guarantee that
a network share weakens anyway. Instead a file is taken when its size and mtime
have been still long enough — a heuristic a slow share can beat — and **the
handler validates content before it ships**. This matters more than it sounds,
because a `shutil` copy of a half-written file succeeds silently; nothing
downstream would catch it. The Report Feed handler parses the JSON it is about
to send, so a truncated file fails, is left alone, and is retried.

**Retry is the tick, and dead-lettering counts failures rather than measuring
age.** One retry mechanism, not an inner backoff loop as well: a failure leaves
the file, the next pass tries again. The trigger for giving up cannot be the
file's age, because age conflates two different failures — a file written on
Friday and found on Monday is three days old and has never been attempted, so
age there measures Forwarder downtime, not delivery trouble. **N consecutive
failures** is the honest measure, and a weekend outage adds none of them. It is
also the one thing that has to be written down, which is what the log is for.

**The log is advisory, and never asked whether a file is pending.** It records
how each file has been going. The outbox answers what is outstanding. Keeping
that line means losing the database degrades safely — nothing dead-letters,
everything keeps retrying — where a log the loop *consulted* for pendingness
would be the mirror's ledger under another name. It is the Forwarder's own
store with its own contract, not a **Run record**: a delivery has no pipeline,
no step address and no logical run id, so folding it into `RUN_RECORD_FIELDS`
would add columns that are null for every pipeline row and null the other way
for every delivery row. The orchestration decision store already made this call
— its own declaration of a different contract, sharing only the machinery.

## Consequences

- **A base directory grows a fifth category**, beside the rows the
  `StoreRegistry` lays out, the runs the **Run store** records, the source
  checkpoints, and the deliverables root. The Forwarder declares and owns it,
  for the same reason those have owners: a layout with no owner drifts.
- **There is no batch, no manifest, and no completion marker.** The unit is one
  file. This is safe because a **Report Feed** carries its own
  `complete_through`, so a partly-delivered set still tells the truth about
  itself — an undelivered file is stale, not wrong, and an operator can see
  exactly which ones by listing the outbox.
- **Nothing watches the Forwarder.** The oldest pending file's age is the health
  signal, but the Forwarder is what reads it, so a dead Forwarder reports
  nothing at all. A heartbeat row and a restart-on-failure scheduled task were
  both considered and deliberately not taken for now. Stated here rather than
  left as an absence: **someone checks it is running.** Ticketed separately.
- **`SharePointWriter`'s list push is expected to migrate onto the Forwarder,
  and has not yet.** Selection is otherwise the one pipeline still holding
  SharePoint credentials, which is a hole in ADR-0018's least-privilege
  argument shaped exactly like this project. Migrating is close to free while
  the Writer is still stubbed, and will not be later — the same "decide before
  the first real one" reasoning ADR-0018 used. `Refresh()` remains implementable
  after the move: the list client supports create, update and delete. Ticketed
  separately.
- **The Forwarder cannot be exercised end-to-end on macOS**, since its clients
  are `shutil`-over-WebDAV and a SharePoint REST list client. Handlers therefore
  sit behind seams with fakes, in the same shape as `SharePointFetcher` /
  `SharePointPusher` already use in the framework tree.
- **The archive and the dead letter directories grow without bound** unless
  pruned. Pruning is the Forwarder's, not a pipeline's.
- **A route's destination ACL is the Forwarder's requirement, not a formality.**
  [ADR-0019](../../../docs/adr/0019-team-report-feed-attributed-by-the-staff-hierarchy.md)
  accepts that per-Reviewer Report Feed files are not a security boundary and
  the library ACL is — and the manager variant puts *named individuals'* volumes
  at a guessable URL. So a route that creates or writes into a library carries
  the access question with it: delivering correctly includes delivering
  somewhere only the right people can read.
