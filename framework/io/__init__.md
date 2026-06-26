```python
"""Public facade: moving data across the boundary — sources, sinks, stores.

The stable import surface for getting a feed *in* and a result *out*: every
:class:`Reader` and :class:`Writer`, the per-subject :class:`Store` /
:class:`StoreCatalog`, and the load strategies a Writer carries. The
:class:`~framework.core.dataset.Dataset` they move and the medallion ``Layer``
constants are the foundational vocabulary on ``framework.core``.

Import from here rather than the underlying modules::

    from framework.io import CsvReader, CsvWriter, StoreCatalog, Refresh

The modules behind this facade (``framework.io.readers``, ``framework.io.writers``,
``framework.io.store``, ``framework.io.strategy``) are internal layout: re-exports
here are the public contract, the submodule paths are not. See ``docs/public-api.md``.
"""

from framework.io.readers import (
    CsvReader,
    DatasetReader,
    ExcelReader,
    GlobCsvReader,
    Reader,
    SqliteReader,
    StrictCsvParseError,
    StrictCsvReader,
)
from framework.io.store import (
    DirectoryStoreBackend,
    Store,
    StoreBackend,
    StoreCatalog,
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
    "DatasetReader",
    "CsvReader",
    "StrictCsvReader",
    "StrictCsvParseError",
    "GlobCsvReader",
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
    "Store",
    "StoreCatalog",
    "StoreBackend",
    "DirectoryStoreBackend",
    "Refresh",
    "AccumulateByRun",
    "UpsertStrategy",
    "SqliteUpsertWriter",
    "InsertOrIgnore",
    "SqliteInsertOrIgnoreWriter",
    "InsertIfAbsent",
    "SqliteInsertIfAbsentWriter",
]

```
