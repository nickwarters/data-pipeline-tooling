---
status: accepted
---

# SQLite per-subject medallion store on a network share, single-writer

Each **subject** — a Case Type, or a shared Reference Data set — owns its own
**medallion**: three SQLite databases, one per generic layer
(`<subject>/{raw,silver,gold}.db`), living on a Windows network share and
isolated from every other subject's files. Exactly **one orchestrator host ever
writes** a given file; the review platform and analysts open the databases
read-only. This keeps the store zero-infrastructure, single-file portable, and
first-class on both Windows and macOS without standing up a database server.

A `StoreRegistry(root).store(subject)` mints a subject's `Store` from shared
root configuration, so pipeline code never repeats physical-layout arithmetic.
The `Store` binds `(subject, layer, table)` to concrete Readers and Writers over
that subject's files; it resolves *which* `<subject>/<layer>.db` to target and
nothing more. It does **not** decide load strategy or impose business meaning on
a layer — the layer names (`raw`, `silver`, `gold`) are generic framework
conventions, validated before a file path is resolved.

## Why per subject, not one shared store

- **Blast-radius isolation.** A bad load or a corrupt file is contained to one
  subject rather than poisoning a shared store.
- **Independent onboarding.** A new Case Type or Reference Data set creates its
  own files and migrates nothing.
- **It mirrors the read side**, which is already per-subject (the CasePool per
  Case Type), and makes the single-writer rule *safer*: smaller, isolated
  databases mean less contention and a smaller blast radius per file.

Reference Data sets (the Adviser hierarchy, product codes, mappings) are subjects
too — each gets its own medallion, refined by its own pipeline, and is read-only
to Case Types' Selection. Cross-medallion joins happen in Python (ADR-0002), so
splitting files costs nothing on the join path.

## Why SQLite on a share at all

SQLite-on-a-share is normally discouraged: its byte-range file locks are
unreliable over SMB/CIFS/NFS and concurrent cross-host writers can corrupt the
file. We accept it because we constrain the topology — one writer per file — and
because SQLite is also a first-class *source* type, keeping one technology across
the seam. A server database (Postgres/SQL Server) would add the hosting and ops
the project exists to avoid.

## Consequences

- **Rollback-journal mode, not WAL** — WAL is unavailable over a network share.
- The connection factory sets a `busy_timeout` (and readers retry) so read-only
  clients ride out the writer's in-place commits instead of erroring.
- **The single-writer-per-file rule is load-bearing.** If a second host ever
  writes the same file, corruption risk returns. It is enforced operationally and
  is unaffected by splitting a subject into per-layer pipelines (distinct files).
- Where a source is destructive and accumulated raw/silver become a system of
  record (ADR-0004), those files need backup/retention — they are no longer a
  transient landing zone rebuildable from source.
- If read contention or torn-read complaints emerge for a heavily-read gold,
  revisit a "build-local, atomically publish to the share" option for that layer.

## Amendment (2026-06-23): generalise to namespace → file; demote the medallion to a profile (#232)

The medallion is **demoted from framework vocabulary**. The framework's storage
contract is the `Reader`/`Writer` ports + load strategies + the `connect` seam;
`Store`/`StoreRegistry` is a **factory** the run engine never references.

- A `Store` now addresses an opaque **`namespace`** — a *logical database*, one
  SQLite file holding many related tables — and mints `writer(table, strategy)` /
  `reader(table)` over it. `StoreRegistry.store(namespace)` resolves the file via a
  `StoreBackend` (`DirectoryStoreBackend` maps `<root>/<namespace>.db`, nesting on
  a `/` in the namespace). The three-value `Layer` enum (`raw`/`silver`/`gold`) is
  **removed from `framework.core`**.
- The raw/silver/gold **medallion** is an **application-level profile**
  (`tools.medallion.medallion(registry, subject)`), exposing the `.raw` / `.silver`
  / `.gold` namespace Stores for one subject. The on-disk layout is unchanged —
  `<root>/<subject>/{raw,silver,gold}.db` (namespaces `<subject>/raw` etc.) — so
  per-subject isolation and the single-writer-per-file rule above still hold.
- This enables a **normalised schema across multiple logical databases** (one
  namespace per database, many related tables each); cross-database joins stay in
  Python (ADR-0002), so splitting files still costs nothing on the join path.

Breaking change to the public facade: `store.writer(layer, table, strategy)`
becomes `store.writer(table, strategy)` on a namespace-scoped Store, and
`framework.core` no longer exports `Layer`/`RAW`/`SILVER`/`GOLD`.
</content>
