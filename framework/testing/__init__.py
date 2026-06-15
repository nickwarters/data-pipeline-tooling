"""Testing helpers for pipeline authors.

A small, test-only surface that makes a concrete pipeline script easy to test
without hand-wiring temp directories, SQLite round-trips, or JSONL parsing. It
sits *beside* the three production facades (``framework.io`` /
``framework.transform`` / ``framework.run``) rather than inside them: pipeline
code never imports it at runtime, but a pipeline author's **tests** do.

    from framework.testing import given_rows, rows_of, RecordingWriter

The helpers come in three pairs:

- **given-source-rows / expect-output-rows** — :func:`given_rows` builds a
  ``Reader`` over in-memory row dicts; :class:`RecordingWriter` captures what a
  pipeline wrote; :func:`rows_of` unwraps any of them back to plain row dicts for
  a direct ``==`` assertion. No filesystem touched.
- **store-backed reads** — :func:`read_rows` reads a landed layer table back as
  row dicts, collapsing the ``store.reader(layer, table).read().to_pandas()``
  chain.
- **run-log assertions** — :class:`RecordingRunLog` captures a run's structured
  records in memory (for asserting validation failures and warn hits without a
  file); :func:`read_run_log` parses an on-disk JSONL run-log file into the same
  record dicts.

Everything stays behind the :class:`~framework.io.dataset.Dataset` seam:
helpers take and return plain Python row dicts, never a pandas frame.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Mapping, Sequence

from framework.io.dataset import Dataset
from framework.io.readers import DatasetReader, Reader
from framework.run.run_log import RunLog


def make_dataset(rows: Sequence[Mapping[str, Any]]) -> Dataset:
    """Build a :class:`Dataset` from a sequence of row dicts.

    The engine-confined bridge the other helpers use to get in-memory rows
    behind the Dataset seam. Column order follows first appearance across the
    rows (pandas' record orientation).
    """
    import pandas as pd

    return Dataset.from_pandas(pd.DataFrame(list(rows)))


def given_rows(rows: Sequence[Mapping[str, Any]]) -> DatasetReader:
    """A ``Reader`` over in-memory rows — the given-source-rows entry point.

    Hands a pipeline its source feed as plain row dicts, so a test never needs a
    fixture file or a SQLite round-trip to exercise the read→process→write path.
    """
    return DatasetReader(make_dataset(rows))


def rows_of(source: Dataset | RecordingWriter | Reader) -> list[dict[str, Any]]:
    """Unwrap a Dataset, a :class:`RecordingWriter`, or a Reader to row dicts.

    The expect-output-rows side: turns whatever a pipeline produced into a plain
    ``list[dict]`` so a test can assert against an expected list with ``==``.
    """
    if isinstance(source, RecordingWriter):
        dataset = source.dataset
        if dataset is None:
            raise AssertionError("RecordingWriter captured no write")
    elif isinstance(source, Dataset):
        dataset = source
    elif hasattr(source, "read"):
        dataset = source.read()
    else:  # pragma: no cover - guards against an unsupported argument
        raise TypeError(f"cannot read rows from {source!r}")
    return dataset.to_pandas().to_dict(orient="records")


class RecordingWriter:
    """A :class:`~framework.io.writers.Writer` that captures writes in memory.

    The expect-output-rows sink: compose it with ``.write_to(...)`` and the
    pipeline hands it the final Dataset instead of persisting anywhere. Reach the
    captured rows through :func:`rows_of` (or :attr:`dataset` / :attr:`writes`
    for multi-write pipelines such as checkpoints).
    """

    def __init__(self) -> None:
        self.writes: list[Dataset] = []

    def write(self, dataset: Dataset) -> None:
        self.writes.append(dataset)

    @property
    def dataset(self) -> Dataset | None:
        """The most recently written Dataset, or ``None`` if nothing was written."""
        return self.writes[-1] if self.writes else None


def read_rows(store: Any, layer: Any, table: str) -> list[dict[str, Any]]:
    """Read a landed layer table back as row dicts via the Store's own Reader.

    Collapses the ``store.reader(layer, table).read().to_pandas()`` chain that
    every store-backed assertion repeats. ``store`` is any object that mints a
    Reader for ``(layer, table)`` — a :class:`~framework.io.store.Store` or anything
    with the same ``reader(layer, table)`` shape — so the read goes through the
    same public seam a pipeline does, not around it.
    """
    return rows_of(store.reader(layer, table))


class RecordingRunLog(RunLog):
    """A :class:`~framework.run.run_log.RunLog` that captures records in memory.

    Compose it with ``Pipeline(..., run_log=run_log)`` to assert a run's
    structured records without a file on disk. It inherits the base ``step``
    timing/abort behaviour (a raising step still records an ``error`` and
    re-raises), so capturing a validation failure is just running
    under ``pytest.raises`` and reading :attr:`errors` afterwards. Captured
    records share the on-disk JSONL shape, so :attr:`records` reads the same as
    :func:`read_run_log`.
    """

    def __init__(self) -> None:
        # Deliberately stores no path: capture replaces the file sink.
        self.records: list[dict[str, Any]] = []

    def record(
        self,
        run_id: str,
        pipeline: str,
        step: str,
        status: str,
        **fields: Any,
    ) -> None:
        record = {
            "run_id": run_id,
            "pipeline": pipeline,
            "step": step,
            "status": status,
            "rows_in": fields.get("rows_in"),
            "rows_out": fields.get("rows_out"),
            "rows_quarantined": fields.get("rows_quarantined"),
            "rows_excluded": fields.get("rows_excluded"),
            "duration": fields.get("duration"),
            "errors": fields.get("errors") or [],
            "warn_hits": fields.get("warn_hits") or [],
        }
        self.records.append(record)

    def records_for_step(self, step: str) -> list[dict[str, Any]]:
        """Every captured record for the named step, in execution order."""
        return [r for r in self.records if r["step"] == step]

    @property
    def warn_hits(self) -> list[str]:
        """Every warn-hit message across all captured records, in order."""
        return [w for r in self.records for w in r["warn_hits"]]

    @property
    def errors(self) -> list[str]:
        """Every error message across all captured records, in order."""
        return [e for r in self.records for e in r["errors"]]


def read_run_log(path: str | os.PathLike[str]) -> list[dict[str, Any]]:
    """Parse an on-disk JSONL run-log file into its record dicts, in order.

    The file dual of :class:`RecordingRunLog`: a pipeline that lands its
    :class:`~framework.run.run_log.RunLog` to disk (like the demos) is asserted by
    reading the file back. Tolerates blank lines (e.g. a trailing newline),
    matching the run registry's own ingest.
    """
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]
