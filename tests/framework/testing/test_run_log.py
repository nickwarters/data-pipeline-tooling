"""The run-log helpers (``tests.framework_testing.run_log``).

Capture a run's structured records in memory with :class:`RecordingRunLog`, or
read an on-disk JSONL run-log back with :func:`read_run_log`, and assert on warn
hits / validation failures / step order without parsing files by hand.
"""

import pytest

from framework.run import Pipeline
from tests.framework_testing import (
    RecordingRunLog,
    RecordingWriter,
    given_rows,
    read_run_log,
)
from framework.validate import ColumnValidator


def test_recording_run_log_captures_warn_hits_in_memory():
    # A warn-severity breach keeps the run going but rides warn_hits onto the
    # records; RecordingRunLog captures them without a file on disk.
    run_log = RecordingRunLog()
    writer = RecordingWriter()

    p = Pipeline("cases", run_log=run_log)
    r = p.read(given_rows([{"amount": 100}]), name="read")
    v = p.validate(ColumnValidator(["missing_col"]), r, severity="warn", name="validator")
    w = p.write(writer, v, name="write")
    p.run()

    assert any("missing_col" in w for w in run_log.warn_hits)
    # The run still completed: a final ok run summary is recorded.
    summary = run_log.records_for_step("run")[0]
    assert summary["status"] == "ok"


def test_recording_run_log_captures_a_validation_failure():
    # An error-severity breach aborts the run. The failing step and
    # the run summary are both recorded as errors before the exception raises, so
    # a test asserts the failure message through the captured records.
    from framework.validate import ValidationError

    run_log = RecordingRunLog()
    writer = RecordingWriter()
    p = Pipeline("cases", run_log=run_log)
    r = p.read(given_rows([{"amount": 100}]), name="read")
    v = p.validate(ColumnValidator(["missing_col"]), r, name="validator")
    w = p.write(writer, v, name="write")

    with pytest.raises(ValidationError):
        p.run()

    assert any("missing_col" in e for e in run_log.errors)
    # Fail-fast: nothing reached the writer.
    assert writer.writes == []


def test_read_run_log_parses_an_on_disk_jsonl_file(tmp_path):
    # For a pipeline that writes its RunLog to a file (like the demo), read_run_log
    # parses the JSONL back into the same record dicts a RecordingRunLog captures.
    from framework.run import RunLog

    log_path = tmp_path / "runs.log"
    writer = RecordingWriter()
    p = Pipeline("cases", run_log=RunLog(log_path))
    r = p.read(given_rows([{"amount": 100}]), name="read")
    w = p.write(writer, r, name="write")
    p.run()

    records = read_run_log(log_path)
    assert [r["step"] for r in records] == [
        "read",
        "write",
        "run",
    ]
    assert records[-1]["status"] == "ok"
