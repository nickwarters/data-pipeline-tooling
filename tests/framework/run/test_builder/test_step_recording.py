"""Each node execution emits one run-log record through ``Node.execute``."""

from __future__ import annotations

import inspect
from dataclasses import dataclass
from typing import Annotated

import pandas as pd
import pytest

from framework.core import Pattern
from framework.core.dataset import Dataset
from framework.core.validators import RowCountValidator, ValidationError
from framework.io.readers import DatasetReader
from framework.run import builder
from framework.run.builder import Node, Pipeline, StepResult
from framework.run.run_context import RunContext
from framework.transform.quarantine import SchemaValueRulePartitioner
from tests.framework_testing import RecordingRunLog
from tools.observability.profile import DataProfiler


@dataclass
class RefCase:
    case_ref: Annotated[str, Pattern(r"\d{9,10}")]


class CapturingWriter:
    def __init__(self) -> None:
        self.written: list[Dataset] = []

    def write(self, dataset: Dataset) -> None:
        self.written.append(dataset)


def _feed() -> Dataset:
    return Dataset.from_pandas(
        pd.DataFrame({"case_ref": pd.Series(["123456789", "BAD"], dtype="string")})
    )


def _quarantine_pipeline(run_log: RecordingRunLog) -> Pipeline:
    p = Pipeline("cases", run_log=run_log)
    read = p.read(DatasetReader(_feed()), name="read")
    p.quarantine(SchemaValueRulePartitioner(RefCase), CapturingWriter(), read)
    return p


def test_a_quarantine_node_is_recorded_exactly_once():
    """The reproduction: one node, one record — not two that disagree."""
    run_log = RecordingRunLog()
    _quarantine_pipeline(run_log).run()

    assert [r["step"] for r in run_log.records] == ["read", "quarantine", "run"]


def test_an_explain_node_is_recorded_exactly_once():
    run_log = RecordingRunLog()
    p = Pipeline("selection", run_log=run_log)
    read = p.read(DatasetReader(_feed()), name="read")
    p.explain(CapturingWriter(), read, id_column="case_ref", name="explain")
    p.run()

    assert [r["step"] for r in run_log.records] == ["read", "explain", "run"]


def test_the_single_quarantine_record_carries_both_the_count_and_the_duration():
    """The single record carries both measures."""
    run_log = RecordingRunLog()
    _quarantine_pipeline(run_log).run()

    [record] = run_log.records_for_step("quarantine")
    assert record["rows_in"] == 2
    assert record["rows_out"] == 1
    assert record["rows_quarantined"] == 1
    assert record["committed"] is True
    assert record["duration"] is not None
    assert record["step_address"] == "cases.quarantine"


def test_a_quarantine_step_keeps_its_address_under_a_dry_run():
    """A preview must address its steps the same way a real run does."""
    run_log = RecordingRunLog()
    p = _quarantine_pipeline(run_log)
    p.run(RunContext(pipeline="cases", run_log=run_log, dry_run=True))

    [record] = run_log.records_for_step("quarantine")
    assert record["step_address"] == "cases.quarantine"
    assert record["rows_quarantined"] == 1
    assert record["committed"] is False


def test_every_recorded_step_of_a_dry_run_carries_its_address():
    run_log = RecordingRunLog()
    p = Pipeline("cases", run_log=run_log)
    read = p.read(DatasetReader(_feed()), name="read")
    good = p.quarantine(SchemaValueRulePartitioner(RefCase), CapturingWriter(), read)
    p.explain(CapturingWriter(), good, id_column="case_ref", name="explain")
    p.write(CapturingWriter(), good, name="write")
    p.run(RunContext(pipeline="cases", run_log=run_log, dry_run=True))

    assert all(r["step_address"] for r in run_log.records)


def test_every_node_type_keeps_the_address_it_has_always_recorded():
    """Freshness keys on these labels, so they are a contract, not a detail."""
    run_log = RecordingRunLog()
    p = Pipeline("cases/main", run_log=run_log)
    read = p.read(DatasetReader(_feed()), name="read")
    checked = p.validate(RowCountValidator(minimum=1), read, name="pre-validate")
    good = p.quarantine(SchemaValueRulePartitioner(RefCase), CapturingWriter(), checked)
    shaped = p.transform(lambda ds: ds, good, name="process")
    p.explain(CapturingWriter(), shaped, id_column="case_ref", name="explain")
    written = p.write(CapturingWriter(), shaped, name="write")
    p.action(lambda: None, written, name="notify")
    p.run()

    assert {r["step"]: r["step_address"] for r in run_log.records} == {
        "read": "cases/main.read",
        "pre-validate": "cases/main.pre-validate",
        "quarantine": "cases/main.quarantine",
        "process": "cases/main.process",
        "explain": "cases/main.explain",
        "write": "cases/main.write",
        "notify": "cases/main.notify",
        "run": "cases/main",
    }


def test_no_node_reaches_the_run_log_itself():
    """Recording lives in one place; a node returns metrics instead of logging."""
    offenders = [
        name
        for name, obj in vars(builder).items()
        if inspect.isclass(obj)
        and issubclass(obj, Node)
        and "_do_execute" in vars(obj)
        and "session.record" in inspect.getsource(vars(obj)["_do_execute"])
    ]
    assert offenders == []


class _SideEffectingNode(Node):
    """A throwaway node type that commits an artifact and counts what it wrote."""

    def __init__(self, name, writer, input_node, address=None):
        super().__init__(name, "SideEffect", [input_node], address)
        self.writer = writer

    def _do_execute(self, session, context, dataset):
        if context.dry_run:
            return StepResult(dataset, {"rows_excluded": 0})
        self.writer.write(dataset)
        return StepResult(dataset, {"rows_excluded": len(dataset)}, committed=True)


def test_a_new_side_effecting_node_type_records_without_any_recording_code():
    """The blast-radius proof: the next node type cannot repeat the defect."""
    run_log = RecordingRunLog()
    writer = CapturingWriter()
    p = Pipeline("cases", run_log=run_log)
    read = p.read(DatasetReader(_feed()), name="read")
    node = _SideEffectingNode("side", writer, read, address=p._step_address("side"))
    p._nodes.append(node)
    p.run()

    [record] = run_log.records_for_step("side")
    assert record["committed"] is True
    assert record["rows_excluded"] == 2
    assert record["step_address"] == "cases.side"
    assert record["duration"] is not None


def test_a_failing_node_still_records_its_error_and_category():
    run_log = RecordingRunLog()
    p = Pipeline("cases", run_log=run_log)
    read = p.read(DatasetReader(_feed()), name="read")
    good = p.quarantine(SchemaValueRulePartitioner(RefCase), CapturingWriter(), read)
    p.validate(RowCountValidator(minimum=100), good, name="post-validate")

    with pytest.raises(ValidationError):
        p.run()

    [quarantine] = run_log.records_for_step("quarantine")
    assert quarantine["committed"] is True
    [failed] = run_log.records_for_step("post-validate")
    assert failed["status"] == "error"
    assert failed["error_category"] == "data"
    assert failed["step_address"] == "cases.post-validate"
    # A step that raised committed nothing: the marker stays off, leaving the
    # quarantine above as the authoritative record of what actually landed.
    assert failed["committed"] is False


class _ReportingReader:
    """A Reader that reports the location it read, the way the real ones do."""

    def __init__(self, locations) -> None:
        self._locations = locations

    def read(self) -> Dataset:
        self.data_locations = list(self._locations)
        return _feed()


class _ReportingWriter(CapturingWriter):
    def __init__(self, locations) -> None:
        super().__init__()
        self._locations = locations

    def write(self, dataset: Dataset) -> None:
        self.data_locations = list(self._locations)
        super().write(dataset)


_SOURCE = [{"namespace": "file", "name": "/d/orders.csv"}]
_TARGET = [{"namespace": "sqlite:/d/raw.db", "name": "orders"}]


def test_a_read_step_records_the_locations_its_reader_reported():
    run_log = RecordingRunLog()
    p = Pipeline("cases", run_log=run_log)
    read = p.read(_ReportingReader(_SOURCE), name="read")
    p.write(CapturingWriter(), read, name="write")
    p.run()

    [record] = run_log.records_for_step("read")
    assert record["data_locations"] == _SOURCE


def test_a_write_step_records_the_locations_its_writer_reported():
    run_log = RecordingRunLog()
    p = Pipeline("cases", run_log=run_log)
    read = p.read(DatasetReader(_feed()), name="read")
    p.write(_ReportingWriter(_TARGET), read, name="write")
    p.run()

    [record] = run_log.records_for_step("write")
    assert record["data_locations"] == _TARGET


def test_steps_that_touch_no_data_location_record_an_empty_list():
    run_log = RecordingRunLog()
    p = Pipeline("cases", run_log=run_log)
    read = p.read(DatasetReader(_feed()), name="read")
    shaped = p.transform(lambda dataset: dataset, read, name="transform")
    checked = p.validate(RowCountValidator(minimum=1), shaped, name="validate")
    p.profile(DataProfiler(), checked, name="profile")
    p.write(CapturingWriter(), checked, name="write")
    p.run()

    for step in ("read", "transform", "validate", "profile", "write"):
        [record] = run_log.records_for_step(step)
        assert record["data_locations"] == []
