"""The deferred fluent builder — describes a pipeline; executes on ``.run()``.

A ``Pipeline`` composes a feed's reader and its destination Writer (and, in
later slices, processors and validators) without running anything. Execution
happens only at the ``.run()`` terminus, which owns the cross-cutting concerns
— timing, logging, lineage, error handling — for every stage. The builder makes
**no** write decisions: it hands the read ``DataHandle`` to the composed Writer,
which owns its own location and load strategy (ADR-0003, ADR-0006).
"""

from __future__ import annotations

from framework.data_handle import DataHandle
from framework.readers import Reader
from framework.writers import Writer


class Pipeline:
    """A deferred pipeline for one feed: read, then hand off to a Writer."""

    def __init__(self, name: str, reader: Reader) -> None:
        # `name` labels the feed/pipeline (for lineage in later slices); it is
        # not a write decision — the Writer owns the target table. Nothing runs
        # at construction.
        self._name = name
        self._reader = reader
        self._writer: Writer | None = None

    def write_to(self, writer: Writer) -> "Pipeline":
        """Compose in the destination Writer. Deferred — nothing runs yet."""
        self._writer = writer
        return self

    def run(self) -> DataHandle:
        """Execute: read the source, hand the handle to the Writer, return it.

        Returns the bulk-tier ``DataHandle`` (ADR-0003).
        """
        handle = self._reader.read()
        if self._writer is not None:
            self._writer.write(handle)
        return handle
