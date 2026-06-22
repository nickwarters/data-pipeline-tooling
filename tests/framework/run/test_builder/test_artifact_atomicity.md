```python
"""Independent-commit semantics for run artifacts (ADR-0007 amd 03).

A ``.run()`` writes its intermediate artifacts — quarantine rejects, the
selection/explain trace, and checkpoints — to their own backing stores as their
nodes execute. They are **independently committed evidence**, not staged into one
publish unit with the final output: a *later* node's failure aborts the run but
does not roll back an artifact that already landed. These tests inject a failure
after each artifact write and assert (a) the artifact persisted and (b) the run
log marks the artifact step ``committed`` before the failing step's ``error``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated

import pandas as pd
import pytest

from framework.core import Pattern
from framework.core.dataset import Dataset
from framework.core.validators import RowCountValidator, ValidationError
from framework.run.builder import Pipeline
from framework.transform.quarantine import SchemaValueRulePartitioner
from tools.observability.run_log import RunLog


class RecordingReader:
    def __init__(self, dataset: Dataset) -> None:
        self._dataset = dataset

    def read(self) -> Dataset:
        return self._dataset


class CapturingWriter:
    def __init__(self) -> None:
        self.written: Dataset | None = None
        self.write_count = 0

    def write(self, dataset: Dataset) -> None:
        self.written = dataset
        self.write_count += 1


class FailingWriter:
    """A terminus writer that always raises — the injected late failure."""

    def __init__(self) -> None:
        self.write_count = 0

    def write(self, dataset: Dataset) -> None:
        self.write_count += 1
        raise RuntimeError("terminus write blew up")


def _records(log_path: Path) -> list[dict]:
    return [json.loads(line) for line in log_path.read_text().splitlines()]


def _by_step(records: list[dict]) -> dict[str, dict]:
    return {r["step"]: r for r in records}


@dataclass
class RefCase:
    case_ref: Annotated[str, Pattern(r"\d{9,10}")]


def test_checkpoint_artifact_survives_a_later_write_failure(tmp_path):
    ds = Dataset.from_pandas(pd.DataFrame({"id": [1, 2]}))
    checkpoint_writer = CapturingWriter()
    log = RunLog(tmp_path / "cases.log")

    p = Pipeline("cases", run_log=log)
    read = p.read(RecordingReader(ds), name="read")
    checkpoint = p.write(checkpoint_writer, read, name="checkpoint")
    p.write(FailingWriter(), checkpoint, name="write")

    with pytest.raises(RuntimeError):
        p.run()

    # The checkpoint committed independently and is NOT rolled back by the
    # terminus failure: the snapshot persists as evidence.
    assert checkpoint_writer.write_count == 1
    assert checkpoint_writer.written is ds

    steps = _by_step(_records(tmp_path / "cases.log"))
    assert steps["checkpoint"]["status"] == "ok"
    assert steps["checkpoint"]["committed"] is True
    assert steps["write"]["status"] == "error"
    assert steps["write"]["committed"] is False
    assert steps["run"]["status"] == "error"


def test_quarantine_rejects_persist_when_a_later_step_fails(tmp_path):
    ds = Dataset.from_pandas(
        pd.DataFrame(
            {"case_ref": pd.Series(["123456789", "BAD"], dtype="string")},
        )
    )
    reject_writer = CapturingWriter()
    log = RunLog(tmp_path / "cases.log")

    p = Pipeline("cases", run_log=log)
    read = p.read(RecordingReader(ds), name="read")
    good = p.quarantine(SchemaValueRulePartitioner(RefCase), reject_writer, read)
    # A downstream error-severity validator aborts the run after quarantine.
    post = p.validate(RowCountValidator(minimum=100), good, name="post-validate")
    p.write(CapturingWriter(), post, name="write")

    with pytest.raises(ValidationError):
        p.run()

    # The bad row was quarantined to its reject table before the failure; that
    # evidence stays on disk (independent commit), good rows never reached write.
    assert reject_writer.write_count == 1
    assert reject_writer.written is not None
    assert len(reject_writer.written) == 1

    records = _records(tmp_path / "cases.log")
    quarantine = [r for r in records if r["step"] == "quarantine"]
    assert quarantine, "expected a quarantine step record"
    assert all(r["status"] == "ok" and r["committed"] is True for r in quarantine)
    assert any(r["rows_quarantined"] == 1 for r in quarantine)
    steps = _by_step(records)
    assert steps["post-validate"]["status"] == "error"
    assert "write" not in steps


def test_explain_trace_persists_when_the_terminus_write_fails(tmp_path):
    ds = Dataset.from_pandas(pd.DataFrame({"case_ref": ["c1", "c2"]}))
    explain_writer = CapturingWriter()
    log = RunLog(tmp_path / "cases.log")

    p = Pipeline("selection", run_log=log)
    read = p.read(RecordingReader(ds), name="read")
    p.explain(explain_writer, read, id_column="case_ref", name="explain")
    p.write(FailingWriter(), read, name="write")

    with pytest.raises(RuntimeError):
        p.run()

    # The trace committed before the terminus blew up — the per-Case verdict is
    # evidence operators keep even though the pool write failed.
    assert explain_writer.write_count == 1

    steps = _by_step(_records(tmp_path / "cases.log"))
    assert steps["explain"]["status"] == "ok"
    assert steps["explain"]["committed"] is True
    assert steps["write"]["status"] == "error"
    assert steps["run"]["status"] == "error"

```
