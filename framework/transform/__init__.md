```python
"""Public facade for shaping and checking a feed mid-pipeline.

The stable import surface for everything that reshapes or gates a
:class:`~framework.core.dataset.Dataset` between the read and the write: the
``Processor`` seam and its concrete transforms (the Selection ``Filter`` /
``Score`` / ``VectorizedFilter`` / ``VectorizedDerive`` / ``Sort`` /
``Rename`` / ``Stamp``, the column-shaping ``JoinColumns``,
the lazy ``JoinWith`` / ``AntiJoinWith``, the Ingest / fan-out
``SelectColumns`` / ``DropColumns`` / ``Unpivot`` / ``DeriveKey`` /
``LatestPerKey``)
and ``SchemaCoercion`` — the *coerce* half of the schema adapter, which casts a
column's round-trip-lossy values to the declared types (a reshape, not a check) —
plus ``SchemaValueRulePartitioner`` for quarantine routing.

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
from framework.transform.coercion import SchemaCoercion
from framework.transform.processors import (
    AntiJoinWith,
    CoercionError,
    DeriveKey,
    DropColumns,
    Filter,
    JoinColumns,
    JoinDependency,
    JoinWith,
    LatestPerKey,
    Rename,
    Score,
    SelectColumns,
    Sort,
    Stamp,
    Unpivot,
    VectorizedDerive,
    VectorizedFilter,
)
from framework.transform.quarantine import SchemaValueRulePartitioner

__all__ = [
    # The processor seam (defined in framework.core.protocols, re-exported here)
    "Processor",
    # Processors
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
    "DeriveKey",
    "CoercionError",
    # The coerce half of the schema adapter
    "SchemaCoercion",
    # Quarantine partitioning
    "SchemaValueRulePartitioner",
]

```
