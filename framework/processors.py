"""Processors — engine-confined transforms over a ``DataHandle`` mid-pipeline.

A ``Processor`` reshapes a feed's data between the read and the post-validators
(issue #23): it takes the bulk-tier handle and returns a transformed one. Unlike
the structural validators it is **engine-confined** — it reaches the backing
frame via ``to_pandas``/``from_pandas`` exactly as a Reader/Writer does
(ADR-0002), because a transform needs the engine's vectorised operations.

The builder attaches processors with :meth:`Pipeline.with_processor` and runs
them as the ``process`` step. A processor has no severity: a transform either
applies or it can't, so a failure is always fail-fast (ADR-0007) — it raises and
the run aborts. The first concrete processor is the schema-driven
``SchemaCoercion`` in :mod:`framework.schema`, the write-side companion of
``SchemaValidator`` that repairs the representation raw loses to storage.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from framework.data_handle import DataHandle


class CoercionError(Exception):
    """Raised by a Processor when it cannot cast a value to its declared type."""


@runtime_checkable
class Processor(Protocol):
    """An engine-confined transform of one feed's data, run mid-pipeline."""

    def process(self, handle: DataHandle) -> DataHandle:
        """Return a transformed handle; raise on a value it cannot transform."""
        ...
