```python
"""Public facade: the foundational data vocabulary.

The noun every pipeline names regardless of task — ``Dataset`` — plus the
foundational data contracts: declaring and enforcing a feed's schema
(``SchemaValidator``, value rules) and structural validations.

The medallion (``raw`` / ``silver`` / ``gold``) is **no longer framework
vocabulary**: the framework stores an opaque ``namespace`` → file, and the
medallion is an application-level profile (``tools.medallion``) layered on top.

Import from here rather than the underlying modules::

    from framework.core import Dataset, SchemaValidator, ColumnValidator

The modules behind this facade are internal layout: re-exports here are the public
contract, the submodule paths are not. See ``docs/public-api.md``.
"""

from framework._internal.schema import RowCheck, ValueRule, row_checks
from framework.core.dataset import Dataset
from framework.core.errors import ErrorCategory, PipelineError, format_failure
from framework.core.protocols import (
    DEFAULT_CHUNK_SIZE,
    ChunkReader,
    DatasetProfiler,
    Processor,
    Reader,
    Severity,
    Validator,
    Writer,
)
from framework.core.schema import SchemaValidator
from framework.core.validators import (
    ColumnValidator,
    PriorColumns,
    RowCountValidator,
    RunHistory,
    SchemaDriftValidator,
    UniqueValidator,
    ValidationError,
    VolumeAnomalyValidator,
)
from framework.core.value_rules import (
    Length,
    NonNull,
    Nullable,
    OneOf,
    Pattern,
    Range,
    Unique,
)

__all__ = [
    "Dataset",
    "Reader",
    "ChunkReader",
    "DEFAULT_CHUNK_SIZE",
    "Writer",
    "Processor",
    "Validator",
    "DatasetProfiler",
    "Severity",
    "ErrorCategory",
    "PipelineError",
    "format_failure",
    "ValidationError",
    "ColumnValidator",
    "RowCountValidator",
    "VolumeAnomalyValidator",
    "UniqueValidator",
    "RunHistory",
    "SchemaDriftValidator",
    "PriorColumns",
    "SchemaValidator",
    "ValueRule",
    "RowCheck",
    "row_checks",
    "Nullable",
    "NonNull",
    "Pattern",
    "Length",
    "Range",
    "Unique",
    "OneOf",
]

```
