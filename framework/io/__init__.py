"""Public facade: moving data across the boundary — sources, sinks, stores.

The stable import surface for getting a feed *in* and a result *out*: the
:class:`~framework.io.dataset.Dataset` carrier, every :class:`Reader` and
:class:`Writer`, the per-subject :class:`Store` / :class:`StoreCatalog`, the
medallion ``Layer`` constants, and the load strategies a Writer carries.

Import from here rather than the underlying modules::

    from framework.io import CsvReader, CsvWriter, StoreCatalog, RAW, Refresh

The modules behind this facade (``framework.io.readers``, ``framework.io.writers``,
``framework.io.store``, ``framework.io.strategy``, ``framework.io.layers``,
``framework.io.dataset``) are internal layout: re-exports here are the public
contract, the submodule paths are not. See ``docs/public-api.md``.
"""

from framework.io.dataset import Dataset
from framework.io.layers import GOLD, RAW, SILVER, Layer
from framework.io.readers import (
    CsvReader,
    DatasetReader,
    ExcelReader,
    GlobCsvReader,
    Reader,
    SasReader,
    SharePointReader,
    SqliteReader,
)
from framework.io.store import (
    DirectoryStoreBackend,
    Store,
    StoreBackend,
    StoreCatalog,
)
from framework.io.strategy import AccumulateByRun, Refresh, UpsertStrategy
from framework.io.writers import (
    AccumulateByRunWriter,
    CsvWriter,
    ExcelWriter,
    JsonWriter,
    QuarantineWriter,
    SharePointWriter,
    SqliteTruncateReloadWriter,
    SqliteUpsertWriter,
    Writer,
)
from framework.shared.retry import RetryingReader, RetryingWriter, RetryPolicy

__all__ = [
    "Dataset",
    "Reader",
    "DatasetReader",
    "CsvReader",
    "GlobCsvReader",
    "ExcelReader",
    "SqliteReader",
    "SasReader",
    "SharePointReader",
    "Writer",
    "CsvWriter",
    "ExcelWriter",
    "JsonWriter",
    "SqliteTruncateReloadWriter",
    "AccumulateByRunWriter",
    "QuarantineWriter",
    "SharePointWriter",
    "RetryPolicy",
    "RetryingReader",
    "RetryingWriter",
    "Store",
    "StoreCatalog",
    "StoreBackend",
    "DirectoryStoreBackend",
    "Layer",
    "RAW",
    "SILVER",
    "GOLD",
    "Refresh",
    "AccumulateByRun",
    "UpsertStrategy",
    "SqliteUpsertWriter",
]
