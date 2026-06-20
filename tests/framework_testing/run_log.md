```python
"""Run-log helpers: capture a run's structured records, or read them back.

The observability side of the testing surface. :class:`RecordingRunLog` captures
a run's records in memory (no file), and :func:`read_run_log` parses an on-disk
JSONL run-log into the same record dicts — so a test asserts on validation
failures, warn hits, and row counts the same way whether the run logged to memory
or to disk. Re-exported from :mod:`tests.framework_testing`.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from tools.observability.run_log import RunLog

__all__ = [
    "RecordingRunLog",
    "read_run_log",
]


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

```
