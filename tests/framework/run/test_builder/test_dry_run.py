"""Dry-run / preview mode for the deferred ``Pipeline`` builder (issue #102).

A run executed in dry-run mode reads, processes, and validates real data but
**skips every commit**: no Write, Quarantine, or Explain node calls its writer.
Instead each step contributes to a ``DryRunReport`` — columns, dtypes, row
counts, and a bounded row sample — so an author can preview a pipeline during
local development without landing artifacts.
"""

from __future__ import annotations

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.core.validators import ValidationError
from framework.io.readers import DatasetReader
from framework.run import RunContext
from framework.run.builder import Pipeline


class RecordingReader:
    def __init__(self, dataset: Dataset) -> None:
        self._dataset = dataset
        self.read_count = 0

    def read(self) -> Dataset:
        self.read_count += 1
        return self._dataset


class CapturingWriter:
    def __init__(self) -> None:
        self.write_count = 0

    def write(self, dataset: Dataset) -> None:
        self.write_count += 1


def test_dry_run_skips_the_final_write():
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1, 2, 3]})))
    writer = CapturingWriter()
    pipeline = Pipeline("orders")
    r = pipeline.read(reader, name="read")
    pipeline.write(writer, r, name="write")

    result_context = RunContext(pipeline="orders", dry_run=True)
    result = pipeline.run(result_context)

    assert reader.read_count == 1
    assert writer.write_count == 0
    assert isinstance(result, Dataset)
    assert len(result) == 3
    note = result_context.dry_run_report.step("write").note
    assert note is not None and "would write" in note.lower() and "3" in note


def test_dry_run_report_captures_columns_dtypes_and_row_count_after_read():
    frame = pd.DataFrame({"id": [1, 2, 3], "name": ["a", "b", "c"]})
    reader = RecordingReader(Dataset.from_pandas(frame))
    pipeline = Pipeline("orders")
    pipeline.read(reader, name="read")

    context = RunContext(pipeline="orders", dry_run=True)
    pipeline.run(context)

    report = context.dry_run_report
    read_step = report.step("read")
    assert read_step.node_type == "Read"
    assert read_step.columns == ["id", "name"]
    assert read_step.dtypes["id"].startswith("int")
    assert read_step.dtypes["name"] in ("str", "object")
    assert read_step.row_count == 3


def _add_column(column: str, value: str):
    def process(dataset: Dataset) -> Dataset:
        return dataset.with_columns(**{column: value})

    return process


def test_dry_run_reports_shape_after_a_processing_stage_with_a_bounded_sample():
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": range(10)})))
    pipeline = Pipeline("orders")
    r = pipeline.read(reader, name="read")
    pipeline.transform(_add_column("status", "new"), r, name="enrich")

    context = RunContext(pipeline="orders", dry_run=True)
    pipeline.run(context)

    enrich = context.dry_run_report.step("enrich")
    assert enrich.node_type == "Transform"
    assert "status" in enrich.columns
    assert enrich.row_count == 10
    # The sample is bounded — a dry run summarises, it does not dump the dataset.
    assert len(enrich.sample) == 5
    assert enrich.sample[0] == {"id": 0, "status": "new"}


class RejectNegativeIds:
    """A toy quarantine partitioner: rows with id < 0 are rejected."""

    def partition(self, dataset: Dataset) -> tuple[Dataset, Dataset]:
        frame = dataset.to_pandas()
        good = frame[frame["id"] >= 0]
        rejected = frame[frame["id"] < 0]
        return Dataset.from_pandas(good), Dataset.from_pandas(rejected)


def test_dry_run_quarantine_reports_intent_without_writing_rejects():
    frame = pd.DataFrame({"id": [1, -1, 2, -2, 3]})
    reader = RecordingReader(Dataset.from_pandas(frame))
    rejects = CapturingWriter()
    pipeline = Pipeline("orders")
    r = pipeline.read(reader, name="read")
    pipeline.quarantine(RejectNegativeIds(), rejects, r, name="quarantine")

    context = RunContext(pipeline="orders", dry_run=True)
    result = pipeline.run(context)

    assert rejects.write_count == 0
    # The good partition still flows downstream so later steps preview correctly.
    assert len(result) == 3
    note = context.dry_run_report.step("quarantine").note
    assert note is not None and "2" in note and "quarantine" in note.lower()


def test_dry_run_explain_reports_trace_without_writing_it():
    frame = pd.DataFrame({"case_ref": ["c1", "c2", "c3"], "amount": [900, 150, 40]})
    trace_writer = CapturingWriter()
    pool_writer = CapturingWriter()
    pipeline = Pipeline("selection")
    r = pipeline.read(DatasetReader(Dataset.from_pandas(frame)), name="read")
    pipeline.explain(trace_writer, r, id_column="case_ref", name="explain")
    pipeline.write(pool_writer, r, name="write")

    context = RunContext(pipeline="selection", dry_run=True)
    pipeline.run(context)

    assert trace_writer.write_count == 0
    assert pool_writer.write_count == 0
    note = context.dry_run_report.step("explain").note
    assert note is not None and "trace" in note.lower()


class AlwaysFails:
    """An error-severity validator that always reports a failure."""

    def validate(self, dataset: Dataset) -> str:
        return "row count below floor"


def test_dry_run_reports_a_validation_failure_clearly_then_fails_fast():
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1, 2]})))
    pipeline = Pipeline("orders")
    r = pipeline.read(reader, name="read")
    pipeline.validate(AlwaysFails(), r, name="floor-check", severity="error")

    context = RunContext(pipeline="orders", dry_run=True)
    with pytest.raises(ValidationError) as excinfo:
        pipeline.run(context)

    assert "floor-check" in str(excinfo.value)
    # The preview still carries the read step and the validation failure, so the
    # author sees the shape and the clear reason it failed.
    assert context.dry_run_report.step("read").row_count == 2
    failure = context.dry_run_report.step("floor-check")
    assert failure.note is not None and "row count below floor" in failure.note
