"""Testing helpers for pipeline authors.

A small, test-only surface that makes a concrete pipeline script easy to test
without hand-wiring temp directories, SQLite round-trips, or JSONL parsing. It
sits *beside* the five production facades (``framework.io`` /
``framework.transform`` / ``framework.validate`` / ``framework.run`` /
``framework.shared``) rather than inside them: pipeline code never imports it at
runtime, but a pipeline author's **tests** do.

    from tests.framework_testing import given_rows, rows_of, assert_rows_equal

The surface splits into two implementation modules, both re-exported here:

- :mod:`tests.framework_testing.rows` — in-memory **row** helpers. Build a source
  (:func:`given_rows`, :func:`given_csv`), capture a sink
  (:class:`RecordingWriter`), read a landed table (:func:`read_rows`), unwrap any
  of them to row dicts (:func:`rows_of`), and assert on the result
  (:func:`without_columns`, :func:`assert_rows_equal`).
- :mod:`tests.framework_testing.run_log` — **run-log** helpers.
  :class:`RecordingRunLog` captures a run's structured records in memory;
  :func:`read_run_log` parses an on-disk JSONL run-log into the same record
  dicts.

Everything stays behind the :class:`~framework.core.dataset.Dataset` seam:
helpers take and return plain Python row dicts, never a pandas frame.
"""

from __future__ import annotations

from tests.framework_testing.rows import (
    RecordingWriter,
    assert_rows_equal,
    given_csv,
    given_rows,
    make_dataset,
    read_rows,
    rows_of,
    without_columns,
)
from tests.framework_testing.run_log import RecordingRunLog, read_run_log

__all__ = [
    # rows
    "make_dataset",
    "given_rows",
    "given_csv",
    "rows_of",
    "RecordingWriter",
    "read_rows",
    "without_columns",
    "assert_rows_equal",
    # run-log
    "RecordingRunLog",
    "read_run_log",
]
