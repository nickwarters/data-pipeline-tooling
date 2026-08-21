# Forwarder glossary

The Forwarder is a separate project that delivers the pipeline's local
artifacts. This file defines its vocabulary.

## Language

**Tick**:
One pass of the Forwarder's long-running delivery loop. A Tick works every
declared [Task](#task) in order and then waits for the next one. Its period is
measured from when a Tick *starts*, so a slow Tick shortens the wait rather than
lengthening the cycle.

**Task**:
The declaration of one unit of delivery work: an [Action](#action), the
`file_pattern` selecting the [Queue](#queue) files it applies to, and whatever
else that Action needs — a `list_name` for the list Actions, a `destination_dir`
and `method` for the file one. Tasks are declared in `config.yaml` and are the
whole world: the Forwarder does only what a Task names. Two Tasks whose patterns
match the same file is an operator error the Forwarder cannot see — the first
delivers it and the second finds it gone.

*(The scaffold called this a **Route**. It is a Task now: a Route implied one
destination per entry, where a Task names an Action to perform, and two Tasks
can address the same destination with different patterns.)*

**Action**:
What a [Task](#task) does with a file: `create_sharepoint_items` and
`update_sharepoint_items` read the file's entries and write them to a SharePoint
list; `copy_file_to_sharepoint` puts the file itself into a folder. An Action the
Forwarder does not recognise is skipped and its files left in the Queue.

**Client seam**:
The destination-specific interface an Action delivers through — `ListItemClient`
for the list Actions, `FileHandlerClient` for the file one. The real clients are
Windows-only and live outside this repository, so each seam has a stubbed default
that raises, and tests pass doubles.

*(The scaffold called this a **Handler**. Named for what it is: the seam the real
client is supplied through, not a component the Forwarder owns.)*

**Queue**:
The directory the Forwarder takes pending files from, named by
`shared.constants.QUEUE_DIR_NAME`. The Queue *is* the pending state — a file
sitting in it is a file still to be delivered — so nothing else records what is
outstanding.

**Processed**:
The directory beside the Queue, named by `shared.constants.PROCESSED_DIR_NAME`,
that a file is moved into once it has been delivered. It is the Forwarder's
[ADR-0001](docs/adr/0001-the-forwarder-drains-declared-routes-and-keeps-its-own-log.md)
archive under the name the layout actually uses. It grows without bound until
something prunes it.

**Readiness**, **quiet period**:
A file is taken only once it has been unmodified for the quiet period
(`--quiet-seconds`, two minutes by default), so a file still being written is
left alone. A heuristic, not a guarantee — a writer that stalls for longer beats
it — which is why an Action that reads its file parses the content rather than
trusting readiness alone. The Action that copies a file never opens it, so
readiness is all that stands between a half-written file and its destination.

**Retry file**:
The items of one file that an Action could not deliver, written back into the
Queue as `<name>.retry_<YYYYMMDDHHMMSS>.json` so the next Tick attempts those
alone. Per-Task, off unless `enable_per_item_retry_next_run` says otherwise;
without it a part-failed file is retried whole, resending the items that already
landed. The stamp is replaced rather than appended on each attempt, so the name
never grows, and a Task with per-item retry on looks for its own retry files as
well as its declared pattern.

**Dead letter**:
The location for a file that has exhausted the Forwarder's retry allowance.
**Not implemented.** Nothing currently bounds retrying: an item that can never
succeed is attempted on every Tick indefinitely. ADR-0001 settles the rule —
N *consecutive* failures, counted rather than measured by the file's age, so a
weekend outage adds none of them — but nothing counts them yet.

## What the Forwarder is for

The Forwarder handles root-glossary [Deliverables](../CONTEXT.md#deliverable),
including a [Report Feed](../CONTEXT.md#report-feed), after a pipeline writes
them out. The root delivery boundary is recorded in
[ADR-0018](../docs/adr/0018-report-feeds-published-locally-delivered-outside-the-framework.md),
and the Forwarder's local decision record is
[ADR-0001](docs/adr/0001-the-forwarder-drains-declared-routes-and-keeps-its-own-log.md).

The Forwarder imports nothing from `framework/`. It reads
`shared.constants` for the Queue and Processed directory names, which are a
layout both projects can read.

The canonical pending-deliverable outbox in the root glossary
([Deliverable outbox](../CONTEXT.md#deliverable-outbox)) is
`<base_dir>/deliverables/<destination>/`. The Queue and Processed directories
described here currently sit beside the `forwarder/` package rather than under a
base directory; joining the two is not done.
