---
status: accepted
---

# SQLite medallion store on a network share, single-writer

The framework persists each medallion layer as a SQLite database (raw, silver, gold — names provisional) living on a Windows network share. SQLite-on-a-share is normally discouraged because its byte-range file locks are unreliable over SMB/CIFS/NFS and concurrent cross-host writers can corrupt the file. We accept it because we constrain the topology: **exactly one orchestrator host ever writes**; everyone else (the review platform, analysts) opens the DBs read-only. This keeps zero-infrastructure, single-file portability and first-class Windows/macOS support without standing up a database server.

## Considered options

- **Server database (Postgres/SQL Server):** robust concurrency, but adds infrastructure, hosting, and ops the project explicitly wants to avoid; SQLite is a stated requirement and is also a *source* type.
- **Build-local, atomically publish to the share:** safest for read-heavy gold (readers never catch a half-written file), but adds a copy/swap step and complicates incremental updates. Rejected for now in favour of writing in place.
- **Write directly in place on the share (chosen):** simplest; relies on the single-writer constraint plus a `busy_timeout`/retry policy so read-only clients ride out commits instead of erroring.

## Consequences

- **WAL mode is unavailable** over a network share; we use rollback-journal mode.
- The connection factory must set a `busy_timeout` (and readers retry) so clients tolerate the writer's in-place commits.
- The single-writer rule is load-bearing: if a second host ever writes, corruption risk returns. Enforce it operationally.
- If read contention or torn-read complaints emerge, revisit the "build-local, atomically publish" option for gold.

## Amendment (2026-05-29): medallions are scoped per subject

The original decision framed *one* store of three databases. As we onboard many Case Types and shared reference datasets, the medallion is instead scoped **per subject** — each **Case Type** and each shared **Reference Data** set owns its own three-file medallion (`<subject>/{raw,silver,gold}.db`), isolated from every other subject. This buys **blast-radius isolation** (a bad load or a corrupt file is contained to one subject) and **independent onboarding** (a new subject creates its own files and migrates nothing). It mirrors the read side, which is already per-Case-Type (the CasePool).

Reference Data sets (e.g. the Adviser hierarchy, product codes) are subjects too: each gets its own medallion, refined by its own pipeline, and is **read-only** to Case Types' Selection. Cross-medallion joins happen in Python (ADR-0002), so splitting files costs nothing on the join path.

The core decision is unchanged: SQLite, in-place writes on the share, rollback-journal mode, `busy_timeout`, and the **single-writer-per-file** rule — which now holds per subject's file and gets *safer* with smaller, isolated databases (less contention, smaller blast radius).

## Amendment (2026-06-07): catalog mints subject stores from shared configuration

Pipeline code should not repeat physical layout arithmetic for every subject. A
`StoreCatalog(root).store(subject)` now mints the subject-scoped `Store` from a
shared root/configuration, with a small backend interface for alternate layout
mapping. The default backend maps subjects to `<root>/<subject>`, preserving the
current three-file medallion layout while keeping that choice behind the catalog.

The `Store` remains the binding point for `(subject, layer, table)` to concrete
Readers/Writers. Layer names are generic framework conventions (`RAW`, `SILVER`,
`GOLD` / `raw`, `silver`, `gold`) and are validated before resolving
`<subject>/<layer>.db`. Load strategy is still caller-provided through the
Writer strategy (`Refresh` or `AccumulateByRun`) and is not inferred from layer.

## Amendment (2026-06-23): the Store is a topology-neutral namespace→location factory; the medallion is an application convention, not framework vocabulary

The framework's storage **contract** is the `Reader` / `Writer` ports plus the
load strategies and the `connect` seam — that is all the run engine depends on
(`framework/run`, `framework/transform`, `framework/core` never reference
`Store`). `Store` / `StoreCatalog` are therefore a **factory/convenience**, not a
core primitive: application wiring uses them to mint Readers/Writers, but nothing
downstream of `.run()` consumes them.

Consequently the Store is **generalised from a fixed three-layer medallion to
addressing logical databases**:

- `catalog.store(namespace).writer(table, strategy)` / `.reader(table)`, where
  `namespace` is an **opaque logical-database name** and the `StoreBackend` maps
  `namespace → physical file`. The `layer` axis and its three-value enum are
  gone; a Store is a handle to one logical database holding any number of tables.
- The **`Layer` enum (`raw`/`silver`/`gold`) and the three-files-per-subject
  layout leave `framework.core`.** The medallion becomes an application-level
  **profile/convention** — namespaces shaped `"<subject>/<layer>"` — shipped
  outside the core facade (a thin `medallion(catalog, subject)` helper), so a
  domain that wants a different topology is not forced through medallion
  vocabulary.
- This **enables a full normalised schema across multiple databases**: one
  namespace per logical database, each with many related tables; cross-database
  relationships are resolved in Python (ADR-0002), exactly as cross-medallion
  joins already are, so splitting databases costs nothing on the join path.

**Unchanged:** SQLite, in-place writes on the share, rollback-journal mode,
`busy_timeout`, and the **single-writer-per-file** rule. **Blast-radius
isolation** also stands — it is physical (separate files), now produced by the
backend's namespace→file mapping rather than named by a framework "layer"/
"subject" concept.

Status: **decided; not yet built** — the code still carries the `Layer` enum and
the medallion-shaped Store. This amendment is the target the generalisation
migrates toward.
