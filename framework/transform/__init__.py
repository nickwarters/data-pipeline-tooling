"""Public facade for shaping and checking a feed mid-pipeline.

The stable import surface for everything that reshapes or gates a
:class:`~framework.core.dataset.Dataset` between the read and the write: the
``Processor`` seam and its concrete transforms (the Selection ``Filter`` /
``Score`` / ``VectorizedFilter`` / ``VectorizedDerive`` / ``Sort`` /
``Rename`` / ``Stamp``, the column-shaping ``JoinColumns``,
the lazy ``JoinWith`` / ``AntiJoinWith``, the Ingest / fan-out
``SelectColumns`` / ``DropColumns`` / ``Unpivot`` / ``DeriveKey`` /
``LatestPerKey``, the packed-column ``Parse``, the JSON blob reshaping
``ExplodeJsonMap`` / ``ExplodeJsonList`` / ``FlattenJsonObject``,
and the bounded-subset
``TopNPerGroup`` / ``Sample`` / ``SamplePerGroup``)
and ``SchemaCoercion`` — the *coerce* half of the schema adapter, which casts
each declared column the validator's dtype check would not already accept
(a reshape, not a check) — plus ``SchemaValueRulePartitioner`` for quarantine
routing, and the aggregate helpers a gold reduction calls around its
group-by: ``summarise`` / ``statistic`` (a mean, percentiles and maximum,
NULL where there was nothing to take), ``ratio`` / ``ratios`` / ``total``
(guarded division and a null-preserving sum), ``fill_dimensions`` /
``count_by`` (fill a NULL dimension before grouping; count by grain), and
``shaped`` (land the rows in exactly the shape the schema dataclass declares).

The schema *check* (``SchemaValidator``) and the declared-schema value rules
(``ValueRule`` / ``Nullable`` / ``Pattern`` / ...) live on
``framework.core``, the ``validate(dataset)`` checks (``ColumnValidator``
& friends) likewise, and ``WorkingDayCalendar`` in the sibling ``tools`` package
— none of them reshape a dataset, so they sit apart from these transforms.

Import from here rather than the underlying modules::

    from framework.transform import Filter, Score, SchemaCoercion

The modules behind this facade are internal layout: re-exports here are the
public contract, the submodule paths are not.
"""

from framework.core.protocols import Processor
from framework.transform.aggregate import (
    count_by,
    fill_dimensions,
    ratio,
    ratios,
    shaped,
    statistic,
    summarise,
    total,
)
from framework.transform.coercion import SchemaCoercion
from framework.transform.json_shaping import (
    ExplodeJsonList,
    ExplodeJsonMap,
    FlattenJsonObject,
    JsonShapeError,
)
from framework.transform.processors import (
    AntiJoinWith,
    CoercionError,
    DeriveKey,
    DropColumns,
    Filter,
    IdentityError,
    JoinColumns,
    JoinDependency,
    JoinWith,
    LatestPerKey,
    Parse,
    Rename,
    Sample,
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
from framework.transform.quarantine import SchemaValueRulePartitioner

__all__ = [
    "Processor",
    "Filter",
    "Score",
    "VectorizedFilter",
    "VectorizedDerive",
    "Stamp",
    "Sort",
    "Rename",
    "JoinColumns",
    "JoinDependency",
    "JoinWith",
    "AntiJoinWith",
    "LatestPerKey",
    "SelectColumns",
    "DropColumns",
    "Unpivot",
    "ExplodeJsonMap",
    "ExplodeJsonList",
    "FlattenJsonObject",
    "DeriveKey",
    "Parse",
    "TopNPerGroup",
    "Sample",
    "SamplePerGroup",
    "CoercionError",
    "IdentityError",
    "JsonShapeError",
    "SchemaCoercion",
    "SchemaValueRulePartitioner",
    "statistic",
    "summarise",
    "ratio",
    "ratios",
    "total",
    "fill_dimensions",
    "count_by",
    "shaped",
]
