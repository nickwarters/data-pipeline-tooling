"""The pipeline-author testing helpers.

These exercise ``framework.testing`` the way a pipeline author would: build a
feed from in-memory rows, run a real :class:`~framework.run.Pipeline`, and assert
the output rows / run-log records without wiring temp directories or SQLite by
hand.
"""

import pytest

from framework.run import Pipeline
from framework.testing import (
    RecordingRunLog,
    RecordingWriter,
    given_rows,
    read_rows,
    read_run_log,
    rows_of,
)
from framework.transform import ColumnValidator, Filter


def test_given_rows_through_pipeline_into_recording_writer():
    # given-source-rows / expect-output-rows with no temp dir or SQLite: feed
    # in-memory rows, run the real builder, read the captured output back.
    reader = given_rows([{"amount": 100}, {"amount": 50}, {"amount": 200}])
    writer = RecordingWriter()

    (
        Pipeline("selection", reader)
        .with_processor(Filter(lambda row: row["amount"] >= 100, name="high-value"))
        .write_to(writer)
        .run()
    )

    assert rows_of(writer) == [{"amount": 100}, {"amount": 200}]


def test_read_rows_reads_a_landed_layer_table_back(tmp_path):
    # When a pipeline lands in a real Store, read_rows collapses the
    # store.reader(layer, table).read().to_pandas() chain to a list of dicts.
    from framework.io import RAW, Refresh, Store

    store = Store(tmp_path / "cases")
    (
        Pipeline("cases", given_rows([{"case_id": "c1", "amount": 100}]))
        .write_to(store.writer(RAW, "cases", Refresh()))
        .run()
    )

    assert read_rows(store, RAW, "cases") == [{"case_id": "c1", "amount": 100}]


def test_recording_run_log_captures_warn_hits_in_memory():
    # A warn-severity breach keeps the run going but rides warn_hits onto the
    # records; RecordingRunLog captures them without a file on disk.
    run_log = RecordingRunLog()
    writer = RecordingWriter()

    (
        Pipeline("cases", given_rows([{"amount": 100}]), run_log=run_log)
        .with_validator(ColumnValidator(["missing_col"]), severity="warn")
        .write_to(writer)
        .run()
    )

    assert any("missing_col" in w for w in run_log.warn_hits)
    # The run still completed: a final ok run summary is recorded.
    summary = run_log.records_for_step("run")[0]
    assert summary["status"] == "ok"


def test_recording_run_log_captures_a_validation_failure():
    # An error-severity breach aborts the run. The failing step and
    # the run summary are both recorded as errors before the exception raises, so
    # a test asserts the failure message through the captured records.
    from framework.transform import ValidationError

    run_log = RecordingRunLog()
    writer = RecordingWriter()
    pipeline = (
        Pipeline("cases", given_rows([{"amount": 100}]), run_log=run_log)
        .with_validator(ColumnValidator(["missing_col"]))
        .write_to(writer)
    )

    with pytest.raises(ValidationError):
        pipeline.run()

    assert any("missing_col" in e for e in run_log.errors)
    # Fail-fast: nothing reached the writer.
    assert writer.writes == []


def test_read_run_log_parses_an_on_disk_jsonl_file(tmp_path):
    # For a pipeline that writes its RunLog to a file (like the demo), read_run_log
    # parses the JSONL back into the same record dicts a RecordingRunLog captures.
    from framework.run import RunLog

    log_path = tmp_path / "runs.log"
    writer = RecordingWriter()
    (
        Pipeline("cases", given_rows([{"amount": 100}]), run_log=RunLog(log_path))
        .write_to(writer)
        .run()
    )

    records = read_run_log(log_path)
    assert [r["step"] for r in records] == ["read", "pre-validate", "post-validate", "write", "run"]
    assert records[-1]["status"] == "ok"
