```python
"""The medallion store — scoped to one subject, mints that subject's Writers
and Readers.

A ``Store`` is the mouth of one **subject**'s medallion (a Case Type or a shared
Reference Data set — ADR-0001 amendment): its three SQLite files
``<subject_dir>/{raw,silver,gold}.db``, isolated from every other subject's
files. The store holds **no** business logic and makes **no** load decisions
(ADR-0002, ADR-0003 amendment); it maps ``layer → location`` only and the
caller supplies an explicit load strategy:

- ``store.writer(layer, table, strategy)`` — mints the Writer over the
  subject's layer file, wired to the caller-supplied :class:`~framework.strategy.Refresh`
  or :class:`~framework.strategy.AccumulateByRun` strategy (ADR-0006 amendment).
- ``store.reader(layer, table)`` — a Reader over the same file.

The minted Writers/Readers each open through the shared ``connect`` factory in
``framework.connection`` — the single place connections are configured
(ADR-0001) and the seam that keeps ``store`` and ``writers`` from importing each
other in a cycle.
"""

from __future__ import annotations

import os
from pathlib import Path

from framework.connection import LAYERS
from framework.readers import Reader, SqliteReader
from framework.strategy import AccumulateByRun, Refresh
from framework.writers import (
    AccumulateByRunWriter,
    SqliteTruncateReloadWriter,
    Writer,
)


class Store:
    """One subject's medallion: maps layer→location; mints Writers/Readers."""

    def __init__(
        self, subject_dir: str | os.PathLike[str], busy_timeout_ms: int = 5000
    ) -> None:
        # Path keeps separators OS-agnostic across Windows and macOS.
        self._subject_dir = Path(subject_dir)
        self._busy_timeout_ms = busy_timeout_ms

    def _db_path(self, layer: str) -> Path:
        if layer not in LAYERS:
            raise ValueError(f"unknown layer {layer!r}; expected one of {LAYERS}")
        return self._subject_dir / f"{layer}.db"

    def writer(
        self,
        layer: str,
        table: str,
        strategy: Refresh | AccumulateByRun,
    ) -> Writer:
        """Mint a Writer over the subject's layer file with the given strategy.

        The Store resolves only *which* ``<subject>/<layer>.db`` the Writer
        targets; the caller declares *how* data is loaded via ``strategy``
        (:class:`~framework.strategy.Refresh` for truncate+reload,
        :class:`~framework.strategy.AccumulateByRun` for accumulate-by-run —
        ADR-0006 amendment). Two feeds may land in the same layer with different
        strategies.
        """
        db_path = self._db_path(layer)
        if isinstance(strategy, Refresh):
            return SqliteTruncateReloadWriter(
                db_path, table, busy_timeout_ms=self._busy_timeout_ms
            )
        if isinstance(strategy, AccumulateByRun):
            return AccumulateByRunWriter(
                db_path,
                table,
                strategy.run_id,
                strategy.load_date,
                busy_timeout_ms=self._busy_timeout_ms,
            )
        raise TypeError(f"unknown strategy {strategy!r}")

    def reader(self, layer: str, table: str) -> Reader:
        """Mint a Reader over the subject's layer file."""
        return SqliteReader(
            self._db_path(layer), table, busy_timeout_ms=self._busy_timeout_ms
        )

```
