"""Public facade: the foundational data vocabulary.

The nouns every pipeline names regardless of task — ``Dataset`` and the medallion 
``Layer`` constants ``RAW`` / ``SILVER`` / ``GOLD``. Plus, the foundational data
contracts: declaring and enforcing a feed's schema (``SchemaValidator``, value rules) 
and structural validations.

Import from here rather than the underlying modules::

    from framework.core import Dataset, RAW, SchemaValidator, ColumnValidator

The modules behind this facade are internal layout: re-exports here are the public
contract, the submodule paths are not. See ``docs/public-api.md``.
"""

from framework._internal.schema import RowCheck, ValueRule, row_checks
from framework.core.dataset import Dataset
from framework.core.errors import PipelineError, format_failure
from framework.core.layers import GOLD, RAW, SILVER, Layer
from framework.core.protocols import Processor, Reader, Severity, Validator, Writer
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
    "Layer",
    "RAW",
    "SILVER",
    "GOLD",
    "Reader",
    "Writer",
    "Processor",
    "Validator",
    "Severity",
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
