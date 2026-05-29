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
