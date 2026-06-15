"""Public facade for shaping and checking a feed mid-pipeline.

The stable import surface for everything that reshapes or gates a
:class:`~framework.io.dataset.Dataset` between the read and the write: the
``Processor`` seam and its concrete transforms (the Selection ``Filter`` /
``Score`` / ``VectorizedFilter`` / ``VectorizedDerive`` / ``Sort`` /
``Rename`` / ``Stamp``, the per-group ``TopNPerGroup`` / ``SamplePerGroup``,
the lazy ``JoinWith`` / ``AntiJoinWith``, the Ingest / fan-out
``SelectColumns`` / ``DropColumns`` / ``Unpivot`` / ``DeriveKey`` /
``LatestPerKey``),
the ``Validator`` checks, the
``Schema`` adapter (``SchemaValidator`` / ``SchemaCoercion`` + value rules), and
the ``WorkingDayCalendar`` availability utility.

Import from here rather than the underlying modules::

    from framework.transform import Filter, Score, SchemaValidator, ColumnValidator

The modules behind this facade are internal layout: re-exports here are the
public contract, the submodule paths are not.
"""

from framework.shared.calendar import WorkingDayCalendar
from framework.transform.processors import (
    AntiJoinWith,
    CoercionError,
    DeriveKey,
    DropColumns,
    Filter,
    JoinDependency,
    JoinWith,
    LatestPerKey,
    Processor,
    Rename,
    SamplePerGroup,
    Score,
    SelectColumns,
    Sort,
    Stamp,
    TopNPerGroup,
    Unpivot,
    VectorizedDerive,
    VectorizedFilter,
)
from framework.transform.schema import (
    Length,
    NonNull,
    Nullable,
    OneOf,
    Pattern,
    SchemaCoercion,
    SchemaValidator,
    Unique,
    ValueRule,
)
from framework.validate.validators import (
    ColumnValidator,
    PriorColumns,
    RowCountValidator,
    RunHistory,
    SchemaDriftValidator,
    UniqueValidator,
    ValidationError,
    Validator,
    VolumeAnomalyValidator,
)

__all__ = [
    # Processors
    "Processor",
    "Filter",
    "Score",
    "VectorizedFilter",
    "VectorizedDerive",
    "Stamp",
    "Sort",
    "Rename",
    "JoinDependency",
    "JoinWith",
    "AntiJoinWith",
    "LatestPerKey",
    "SelectColumns",
    "DropColumns",
    "Unpivot",
    "DeriveKey",
    "TopNPerGroup",
    "SamplePerGroup",
    "CoercionError",
    # Validators
    "Validator",
    "ValidationError",
    "ColumnValidator",
    "RowCountValidator",
    "VolumeAnomalyValidator",
    "UniqueValidator",
    "RunHistory",
    "SchemaDriftValidator",
    "PriorColumns",
    # Declared-schema contract and value rules
    "SchemaValidator",
    "SchemaCoercion",
    "ValueRule",
    "Nullable",
    "NonNull",
    "Pattern",
    "Length",
    "Unique",
    "OneOf",
    # Availability utility
    "WorkingDayCalendar",
]
