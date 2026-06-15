# The escape-hatch store — iterate against a raw db before adopting the layer pattern

The supported way to reach a SQLite store is the **layer pattern**: a
`StoreCatalog(root).store(subject)` mints Writers/Readers over that subject's
`<subject>/{raw,silver,gold}.db`, and the Store maps *only* `(subject, layer,
table) → location` ([core-primitives.md](core-primitives.md#store--storecatalog--subject-medallions-minted-from-shared-configuration),
[ADR-0001](adr/0001-sqlite-medallion-store-on-network-share.md)). That mapping is
what keeps every pipeline ignorant of physical layout and every subject isolated.

Sometimes you are not ready for that. You have a one-off `.db` someone handed
you, or a SQL query you want to drive a `Dataset` from *right now* to see whether
a feed is worth onboarding — and you do not yet want to mint a subject, choose
layers, or decide a load strategy. This doc describes the **escape hatch**: a
deliberately small, throwaway store that sits *outside* the medallion layer
mapping, plus the rules that keep it honest and a clear path back to the real
pattern.

> **This is debt, on purpose.** An escape-hatch store skips subject isolation,
> the raw→silver→gold refinement, and the strategy-on-the-Writer contract
> (ADR-0003/0006). Treat it as a spike: reach for it to *learn*, then
> [migrate](#migrating-back-to-the-layer-pattern). Anything that survives more
> than a spike belongs on `StoreCatalog`.

## What stays true even off the layer pattern

The escape hatch leaves the medallion *mapping* behind, but it does **not** get
to leave the seams behind — they are what keep the spike from becoming a mess you
can't migrate:

- **The `Dataset` seam.** pandas (or any engine) lives *behind* `Dataset` and
  never appears in a pipeline script or the domain layer
  ([ADR-0002](adr/0002-python-only-processing-dumb-store-two-tier-carrier.md)).
  An ad-hoc Reader still returns a `Dataset`; an ad-hoc Writer still takes one.
- **The `Reader` / `Writer` shape.** `read() -> Dataset` and
  `write(dataset) -> None`. If your escape hatch honours these, the `Pipeline`
  builder, validators, processors, and `RunLog` all work against it unchanged —
  which is the whole point of cutting the corner *here* and nowhere else.
- **The connection conventions.** Open SQLite through the shared `connect`
  factory (`busy_timeout`, rollback journal — WAL is unavailable on a network
  share, [ADR-0001](adr/0001-sqlite-medallion-store-on-network-share.md)) rather
  than a bare `sqlite3.connect`, and quote every table/column with
  `quote_identifier`. Paths are `pathlib` so the spike still runs on Windows and
  macOS.

Because the engine and `connect` are deliberately not on the public facades,
anything that opens a connection or touches pandas is **engine-confined code**
and belongs in `framework/io` next to the readers/writers, *not* inlined into a
`pipelines/` script. The escape hatch is "skip the layer mapping", never "inline
pandas in application code".

## Tier 1 — point the existing Readers/Writers at any db (no new code)

The lightest escape hatch needs nothing new: the concrete SQLite Reader/Writers
already take a raw `db_path`, so you can address *any* file, with *any* table,
without `StoreCatalog`, a subject, or a layer.

```python
from pathlib import Path

from framework.core import Dataset
from framework.io import SqliteReader, SqliteTruncateReloadWriter

scratch = Path("/tmp/spike/handover.db")

# Read whatever table the handover db happens to have.
rows = SqliteReader(scratch, "raw_export").read()

# Write a Dataset straight back to a scratch table, full-refresh.
SqliteTruncateReloadWriter(scratch, "cleaned").write(rows)
```

This is enough whenever your only need is "talk to a specific file/table outside
the medallion". `SqliteReader` also takes `columns=[...]` for projection. You are
still on the public facade (`framework.io`) — the only thing you skipped is the
`(subject, layer)` mapping, which is exactly the corner an escape hatch cuts.

## Tier 2 — a store with a SQL query already initialised

When the source is *a query*, not a table — a join, a `WHERE`, a hand-written
view you want to iterate on — `SqliteReader` (which only does `SELECT * FROM
table` / a column projection) is not enough. Add a tiny **query Reader**: an
engine-confined `Reader` whose `read()` runs a SQL string you bake in at
construction. It lives beside the other readers in `framework/io/readers.py`:

```python
# framework/io/readers.py  (escape-hatch helper — engine-confined)
import os
from pathlib import Path
import pandas as pd

from framework._internal.connection import connect
from framework.core.dataset import Dataset


class SqliteQueryReader:
    """Drive a Dataset from a pre-initialised SQL query against one db file.

    An escape hatch for spikes: it carries the query, not a table name, so it
    can express a join/filter/view the layer Readers don't. It still returns a
    Dataset (pandas stays behind the seam) and opens through ``connect``.
    """

    def __init__(
        self,
        db_path: str | os.PathLike[str],
        query: str,
        busy_timeout_ms: int = 5000,
    ) -> None:
        self._db_path = Path(db_path)
        self._query = query
        self._busy_timeout_ms = busy_timeout_ms

    def read(self) -> Dataset:
        con = connect(self._db_path, self._busy_timeout_ms)
        try:
            frame = pd.read_sql(self._query, con)
        finally:
            con.close()
        return Dataset.from_pandas(frame)
```

> **Safety note.** A baked-in query you write by hand is fine. Never interpolate
> a runtime table or column name into the SQL with an f-string — route it through
> `framework.io.sql.quote_identifier`, the one choke point that makes an
> identifier injection-safe.

Now wrap a **store that sits outside the layer** — an object that owns one
scratch db path and mints these escape-hatch components, mirroring `Store`'s
*shape* (it mints Readers/Writers; it holds no business logic) while dropping the
layer mapping `Store` exists to provide:

```python
# framework/io/scratch_store.py  (escape-hatch store — delete on migration)
import os
from pathlib import Path

from framework.io.readers import SqliteQueryReader, SqliteReader
from framework.io.writers import SqliteTruncateReloadWriter


class ScratchStore:
    """A flat, single-file store outside the medallion layer mapping.

    Unlike ``Store`` it knows nothing of subjects or raw/silver/gold — it binds
    one db file and mints Readers/Writers over named tables (or a baked query).
    Use for spikes only; migrate to ``StoreCatalog`` once the feed is real.
    """

    def __init__(self, db_path: str | os.PathLike[str], busy_timeout_ms: int = 5000) -> None:
        self._db_path = Path(db_path)
        self._busy_timeout_ms = busy_timeout_ms

    def reader(self, table: str) -> SqliteReader:
        return SqliteReader(self._db_path, table, busy_timeout_ms=self._busy_timeout_ms)

    def query(self, sql: str) -> SqliteQueryReader:
        """A Reader over a pre-initialised SQL query (the escape hatch's point)."""
        return SqliteQueryReader(self._db_path, sql, busy_timeout_ms=self._busy_timeout_ms)

    def writer(self, table: str) -> SqliteTruncateReloadWriter:
        # No strategy choice on the escape hatch: always full-refresh.
        return SqliteTruncateReloadWriter(self._db_path, table, busy_timeout_ms=self._busy_timeout_ms)
```

A spike pipeline then reads through the builder exactly as a real one does — the
escape-hatch store is interchangeable because it honours the `Reader`/`Writer`
shape:

```python
from framework.io import ExcelWriter, Refresh
from framework.run import Pipeline
from framework.io.scratch_store import ScratchStore

store = ScratchStore("/tmp/spike/handover.db")

# Iterate on the query in one place; the pipeline never sees SQL or pandas.
active_cases = store.query(
    "SELECT case_ref, opened FROM raw_export WHERE status = 'OPEN'"
)

(
    Pipeline("spike", active_cases)
    .write_to(ExcelWriter("/tmp/spike/active.xlsx", Refresh()))
    .run()
)
```

## What you are knowingly giving up

| The layer pattern gives you | The escape hatch drops |
|---|---|
| **Subject isolation** — each Case Type / Reference Data set owns its own files, independent blast radius and onboarding (ADR-0001 amd). | One flat file shared by everything in the spike. |
| **raw → silver → gold refinement** — schema-light landing, the silver schema boundary, gold accumulation. | No layers; you read and write wherever you point. |
| **Strategy on the Writer** — `Refresh` / `AccumulateByRun` / `UpsertStrategy` chosen per feed (ADR-0003/0006). | Full-refresh only; no idempotent accumulation, no upsert. |
| **Location hidden from scripts** — `StoreCatalog` owns physical layout. | The db path is hardcoded in the spike. |

If a spike starts needing any row in the left column — a second subject, a silver
schema check, accumulate-by-run idempotency — that is the signal to migrate, not
to grow the escape hatch toward it.

## Migrating back to the layer pattern

The reason the escape hatch honours the seams is that migration is then almost
mechanical:

1. **Mint a subject.** Replace `ScratchStore(path)` with
   `StoreCatalog(root).store("<subject>")`.
2. **Name the layers.** A `store.reader(table)` becomes
   `store.reader(RAW, table)`; a `store.writer(table)` becomes
   `store.writer(layer, table, strategy)` with an explicit `Refresh()` /
   `AccumulateByRun(...)` / `UpsertStrategy(...)`.
3. **Land the query's result, don't read it live.** A `SqliteQueryReader` over a
   hand-written join is a spike convenience. In the real pipeline the join is a
   `JoinWith` processor over an explicit read-only dependency
   ([processors.md](processors.md)), and the source is landed in raw first — so
   the SQL string disappears into the typed builder.
4. **Add the schema boundary.** Route the feed through `raw_to_silver(store,
   table, schema)` so a declared Case Type contract is enforced at silver
   ([schema-enforcement.md](schema-enforcement.md), ADR-0008).
5. **Delete `SqliteQueryReader` and `ScratchStore`** once nothing imports them.
   They are not part of the public surface ([public-api.md](public-api.md)); a
   lingering escape hatch is the defect, not the migration.

If you scaffold the real feed with `python -m pipelines.scaffold <feed>`
([adding-a-feed.md](adding-a-feed.md)) you get the layer-pattern wiring for free,
which is usually the cleanest end of a successful spike.
</content>
</invoke>
