"""The DryRunReport rendering: compact, bounded, human-readable (issue #102)."""

from __future__ import annotations

import pandas as pd

from framework.core.dataset import Dataset
from framework.io.readers import DatasetReader
from framework.run import dry_run_pipeline
from framework.run.builder import Pipeline
from framework.run.dry_run import DryRunReport


def _wide() -> Dataset:
    return Dataset.from_pandas(pd.DataFrame({"id": range(20), "name": ["x"] * 20}))


def test_render_bounds_the_sample_so_it_does_not_dump_the_dataset():
    report = DryRunReport()
    report.observe("read", "Read", _wide())

    rendered = report.render()

    # The header names the dry run and the step reports its row count + columns.
    assert "dry run" in rendered.lower()
    assert "[Read] read" in rendered
    assert "20 rows" in rendered
    assert "id" in rendered and "name" in rendered
    # The whole report stays compact: it summarises 20 rows in a handful of
    # sample lines, not 20.
    assert rendered.count("\n") < 10
    sample_lines = [ln for ln in rendered.splitlines() if ln.strip().startswith("id=")]
    assert 0 < len(sample_lines) <= 3


def test_render_marks_a_failed_step_and_the_stop_reason():
    report = DryRunReport()
    report.observe("read", "Read", _wide())
    report.observe("check", "Validate", note="FAILED: row count below floor")
    report.mark_failed(ValueError("row count below floor"))

    rendered = report.render()

    assert "FAILED" in rendered
    assert "row count below floor" in rendered


class _AlwaysFails:
    def validate(self, dataset: Dataset) -> str:
        return "row count below floor"


def test_dry_run_pipeline_records_a_fail_fast_error_without_raising(tmp_path):
    def handler(context):
        # The common authoring style: a bare p.run() that inherits the ambient
        # dry-run context dry_run_pipeline activates.
        p = Pipeline("orders")
        r = p.read(DatasetReader(_wide()), name="read")
        p.validate(_AlwaysFails(), r, name="floor-check", severity="error")
        return p.run()

    report = dry_run_pipeline(handler, "orders", tmp_path)

    assert report.failed
    assert report.step("read").row_count == 20
    rendered = report.render()
    assert "FAILED" in rendered and "floor-check" in rendered
