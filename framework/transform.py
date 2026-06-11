"""Public facade: shaping and checking a feed mid-pipeline.

The stable import surface for everything that reshapes or gates a
:class:`~framework.dataset.Dataset` between the read and the write: the
``Processor`` seam and its concrete transforms (the Selection ``Filter`` /
``Score`` / ``Sort`` / ``Rename`` / ``Stamp``, the per-group ``TopNPerGroup`` /
``SamplePerGroup``, the lazy ``JoinWith`` / ``AntiJoinWith``, the Ingest /
fan-out ``SelectColumns`` / ``DropColumns`` / ``Unpivot`` / ``DeriveKey`` /
``LatestPerKey``),
the ``Validator`` checks, the
``Schema`` adapter (``SchemaValidator`` / ``SchemaCoercion`` + value rules), and
the ``WorkingDayCalendar`` availability utility.

Import from here rather than the underlying modules::

    from framework.transform import Filter, Score, SchemaValidator, ColumnValidator

The modules behind this facade (``framework.processors``, ``framework.schema``,
``framework.validators``, ``framework.calendar``) are internal layout: re-exports
here are the public contract, the submodule paths are not. See
``docs/public-api.md``.
"""

from framework.calendar import WorkingDayCalendar
from framework.processors import (
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
)
from framework.schema import (
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
from framework.validators import (
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
    # The transform seam + concrete processors
    "Processor",
    "Filter",
    "Score",
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
    # Structural validators
    "Validator",
    "ValidationError",
    "ColumnValidator",
    "RowCountValidator",
    "VolumeAnomalyValidator",
    "UniqueValidator",
    "RunHistory",
    "SchemaDriftValidator",
    "PriorColumns",
    # The declared-schema contract + value rules
    "SchemaValidator",
    "SchemaCoercion",
    "ValueRule",
    "Nullable",
    "NonNull",
    "Pattern",
    "Length",
    "Unique",
    "OneOf",
    # Availability arithmetic (pure utility)
    "WorkingDayCalendar",
]
