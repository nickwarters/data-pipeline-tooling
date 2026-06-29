"""Public facade: moving data across the boundary — sources, sinks, strategies.

The stable import surface for getting a feed *in* and a result *out*: every
:class:`Reader` and :class:`Writer` and the load strategies a Writer carries. The
:class:`~framework.core.dataset.Dataset` they move is the foundational vocabulary
on ``framework.core``. Where a feed *lands* — the namespace ``Store`` /
``StoreRegistry`` (one logical database → file) and the raw/silver/gold medallion
profile over it — is **application infrastructure** in the sibling ``tools``
package (``tools.store``, ``tools.medallion``), not framework vocabulary (#232).

Import from here rather than the underlying modules::

    from framework.io import CsvReader, CsvWriter, Refresh

The modules behind this facade (``framework.io.readers``, ``framework.io.writers``,
``framework.io.strategy``) are internal layout: re-exports here are the public
contract, the submodule paths are not. See ``docs/public-api.md``.
"""

from framework.io.readers import (
    DEFAULT_CHUNK_SIZE,
    ChunkedCsvReader,
    ChunkReader,
    CsvReader,
    DatasetReader,
    ExcelReader,
    GlobCsvReader,
    Reader,
    SasFileReader,
    SqliteReader,
    StrictCsvParseError,
    StrictCsvReader,
)
from framework.io.strategy import (
    AccumulateByRun,
    InsertIfAbsent,
    InsertOrIgnore,
    Refresh,
    UpsertStrategy,
)
from framework.io.writers import (
    AccumulateByRunWriter,
    CsvWriter,
    ExcelWriter,
    JsonWriter,
    QuarantineWriter,
    SqliteInsertIfAbsentWriter,
    SqliteInsertOrIgnoreWriter,
    SqliteTruncateReloadWriter,
    SqliteUpsertWriter,
    StdoutWriter,
    Writer,
)

__all__ = [
    "Reader",
    "ChunkReader",
    "DEFAULT_CHUNK_SIZE",
    "DatasetReader",
    "CsvReader",
    "StrictCsvReader",
    "StrictCsvParseError",
    "GlobCsvReader",
    "ChunkedCsvReader",
    "SasFileReader",
    "ExcelReader",
    "SqliteReader",
    "Writer",
    "CsvWriter",
    "ExcelWriter",
    "JsonWriter",
    "SqliteTruncateReloadWriter",
    "AccumulateByRunWriter",
    "QuarantineWriter",
    "StdoutWriter",
    "Refresh",
    "AccumulateByRun",
    "UpsertStrategy",
    "SqliteUpsertWriter",
    "InsertOrIgnore",
    "SqliteInsertOrIgnoreWriter",
    "InsertIfAbsent",
    "SqliteInsertIfAbsentWriter",
]
