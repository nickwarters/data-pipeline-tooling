"""Public facade: moving data across the boundary — sources, sinks, stores.

The stable import surface for getting a feed *in* and a result *out*: the
:class:`~framework.dataset.Dataset` carrier, every :class:`Reader` and
:class:`Writer`, the per-subject :class:`Store` / :class:`StoreCatalog`, the
medallion ``Layer`` constants, and the load strategies a Writer carries.

Import from here rather than the underlying modules::

    from framework.io import CsvReader, StoreCatalog, RAW, Refresh

The modules behind this facade (``framework.readers``, ``framework.writers``,
``framework.store``, ``framework.strategy``, ``framework.layers``,
``framework.dataset``) are internal layout: re-exports here are the public
contract, the submodule paths are not. See ``docs/public-api.md``.
"""

from framework.dataset import Dataset
from framework.layers import GOLD, RAW, SILVER, Layer
from framework.readers import (
    CsvReader,
    DatasetReader,
    ExcelReader,
    GlobCsvReader,
    Reader,
    SasReader,
    SharePointReader,
    SqliteReader,
)
from framework.store import (
    DirectoryStoreBackend,
    Store,
    StoreBackend,
    StoreCatalog,
)
from framework.strategy import AccumulateByRun, Refresh
from framework.writers import (
    AccumulateByRunWriter,
    QuarantineWriter,
    SqliteTruncateReloadWriter,
    Writer,
)

__all__ = [
    # The carrier
    "Dataset",
    # Sources
    "Reader",
    "DatasetReader",
    "CsvReader",
    "GlobCsvReader",
    "ExcelReader",
    "SqliteReader",
    "SasReader",
    "SharePointReader",
    # Sinks
    "Writer",
    "SqliteTruncateReloadWriter",
    "AccumulateByRunWriter",
    "QuarantineWriter",
    # Stores + the medallion layers
    "Store",
    "StoreCatalog",
    "StoreBackend",
    "DirectoryStoreBackend",
    "Layer",
    "RAW",
    "SILVER",
    "GOLD",
    # Load strategies (owned by the Writer)
    "Refresh",
    "AccumulateByRun",
]
