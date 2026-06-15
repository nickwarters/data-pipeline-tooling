"""Public facade for shaping and checking a feed mid-pipeline.

The stable import surface for everything that reshapes or gates a
:class:`~framework.io.dataset.Dataset` between the read and the write: the
``Processor`` seam and its concrete transforms (the Selection ``Filter`` /
``Score`` / ``VectorizedFilter`` / ``VectorizedDerive`` / ``Sort`` /
``Rename`` / ``Stamp``, the per-group ``TopNPerGroup`` / ``SamplePerGroup``,
the lazy ``JoinWith`` / ``AntiJoinWith``, the Ingest / fan-out
``SelectColumns`` / ``DropColumns`` / ``Unpivot`` / ``DeriveKey`` /
``LatestPerKey``)
and the ``Schema`` adapter (``SchemaValidator`` / ``SchemaCoercion`` + value
rules).

The ``validate(dataset)`` checks (``ColumnValidator`` & friends) live on the
sibling ``framework.validate`` facade, and ``WorkingDayCalendar`` on
``framework.shared`` — neither reshapes a dataset, so they sit apart from these
transforms.

Import from here rather than the underlying modules::

    from framework.transform import Filter, Score, SchemaValidator

The modules behind this facade are internal layout: re-exports here are the
public contract, the submodule paths are not.
"""

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
]
