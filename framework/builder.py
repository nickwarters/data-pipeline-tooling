"""The deferred fluent builder — describes a pipeline; executes on terminus.

A ``Pipeline`` composes a feed's reader (and, in later slices, processors and
validators) without running anything. Execution happens only at a terminus
(``.to(layer)`` here; ``.run()`` / ``.checkpoint(layer)`` later), which owns
the cross-cutting concerns — timing, logging, lineage, error handling — for
every stage. One builder spans a single medallion layer transition. See
ADR-0003.
"""

from __future__ import annotations

from framework.data_handle import DataHandle
from framework.readers import Reader
from framework.store import Store


class Pipeline:
    """A deferred single-layer-transition pipeline for one feed."""

    def __init__(self, name: str, reader: Reader, store: Store) -> None:
        # `name` is the feed's table name within a layer. Nothing reads yet.
        self._name = name
        self._reader = reader
        self._store = store

    def to(self, layer: str) -> DataHandle:
        """Execute the pipeline, landing the feed in ``layer``.

        Returns the landed DataHandle (the bulk-tier result, per ADR-0003).
        """
        handle = self._reader.read()
        self._store.write(layer, self._name, handle)
        return handle
