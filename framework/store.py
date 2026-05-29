"""The medallion store — scoped to one subject, mints that subject's Writers
and Readers.

A ``Store`` is the mouth of one **subject**'s medallion (a Case Type or a shared
Reference Data set — ADR-0001 amendment): its three SQLite files
``<subject_dir>/{raw,silver,gold}.db``, isolated from every other subject's
files. The store holds **no** business logic and makes **no** load decisions
(ADR-0002, ADR-0003 amendment); it merely mints the layer-appropriate component
wired to the subject's file:

- ``store.writer(layer, table)`` — the layer's Writer (raw/silver full-refresh;
  gold accumulate-by-run, stamped with the run's ``run_id`` / ``load_date``).
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
from framework.writers import (
    AccumulateByRunWriter,
    SqliteTruncateReloadWriter,
    Writer,
)

# Layers whose contents mirror a current-state snapshot — full-refreshed each
# run (truncate + reload). Gold instead accumulates by run (ADR-0006).
_REFRESH_LAYERS = ("raw", "silver")


class Store:
    """One subject's medallion: mints Writers/Readers over its three files."""

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
        run_id: str | None = None,
        load_date: str | None = None,
    ) -> Writer:
        """Mint the layer-appropriate Writer over the subject's layer file.

        raw/silver mirror a current-state snapshot, so they get a truncate +
        reload Writer; gold accumulates, so it gets an accumulate-by-run Writer
        stamped with this run's ``run_id`` / ``load_date`` (required for gold).
        """
        db_path = self._db_path(layer)
        if layer in _REFRESH_LAYERS:
            return SqliteTruncateReloadWriter(
                db_path, table, busy_timeout_ms=self._busy_timeout_ms
            )
        # layer == "gold": accumulate-by-run, stamped by the run that mints it.
        if run_id is None or load_date is None:
            raise ValueError(
                f"minting a {layer!r} Writer requires run_id and load_date"
            )
        return AccumulateByRunWriter(
            db_path,
            table,
            run_id,
            load_date,
            busy_timeout_ms=self._busy_timeout_ms,
        )

    def reader(self, layer: str, table: str) -> Reader:
        """Mint a Reader over the subject's layer file."""
        return SqliteReader(
            self._db_path(layer), table, busy_timeout_ms=self._busy_timeout_ms
        )
