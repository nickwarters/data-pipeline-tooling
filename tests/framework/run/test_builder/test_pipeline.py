from pathlib import Path

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.core.validators import (
    ColumnValidator,
    RowCountValidator,
    ValidationError,
)
from framework.io.readers import CsvReader
from framework.io.strategy import AccumulateByRun
from framework.run import RunAddress
from framework.run.builder import (
    Pipeline,
)
from tests.framework_testing import RecordingRunLog
from tools.store import Store

FIXTURE = Path(__file__).parent.parent.parent.parent / "fixtures" / "cases.csv"


class RecordingReader:
    def __init__(self, dataset: Dataset) -> None:
        self._dataset = dataset
        self.read_count = 0

    def read(self) -> Dataset:
        self.read_count += 1
        return self._dataset


class CapturingWriter:
    def __init__(self) -> None:
        self.written: Dataset | None = None
        self.write_count = 0

    def write(self, dataset: Dataset) -> None:
        self.written = dataset
        self.write_count += 1


def adding_processor(column: str):
    def process(dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas().copy()
        frame[column] = "derived"
        return Dataset.from_pandas(frame)

    return process


def dropping_processor(column: str):
    def process(dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas().drop(columns=[column])
        return Dataset.from_pandas(frame)

    return process


def test_pipeline_describe_shows_the_deferred_execution_plan():
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))
    checkpoint = CapturingWriter()
    writer = CapturingWriter()

    p = Pipeline("cases")
    n1 = p.read(reader, name="read")
    n2 = p.validate(ColumnValidator(["id"]), n1, name="pre-validate")
    n3 = p.transform(adding_processor("derived"), n2, name="process")
    n4 = p.write(checkpoint, n3, name="checkpoint")
    n5 = p.validate(ColumnValidator(["derived"]), n4, name="post-validate")
    p.write(writer, n5, name="write")

    plan = p.describe()

    assert "[Read] read" in plan
    assert "[Validate] pre-validate (depends on: read)" in plan
    assert "[Transform] process (depends on: pre-validate)" in plan
    assert "[Write] checkpoint (depends on: process)" in plan
    assert "[Validate] post-validate (depends on: checkpoint)" in plan
    assert "[Write] write (depends on: post-validate)" in plan

    assert reader.read_count == 0
    assert checkpoint.write_count == 0
    assert writer.write_count == 0


def test_pipeline_task_executes_as_a_named_dependency():
    run_log = RecordingRunLog()
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))
    writer = CapturingWriter()

    p = Pipeline("cases", run_log=run_log)
    read = p.read(reader, name="read_source")
    clean = p.task("clean_rows", adding_processor("clean"), read)
    p.write(writer, clean, name="write_silver")

    plan = p.describe()
    assert "[Transform] clean_rows (depends on: read_source)" in plan
    assert "[Write] write_silver (depends on: clean_rows)" in plan

    p.run()

    assert writer.written is not None
    assert "clean" in writer.written.columns
    [clean_record] = run_log.records_for_step("clean_rows")
    assert clean_record["status"] == "ok"
    assert clean_record["step_address"] == "cases.clean_rows"


def test_pipeline_wires_run_addresses_onto_steps():
    run_log = RecordingRunLog()
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))
    writer = CapturingWriter()

    p = Pipeline("pipeline_2", run_log=run_log)
    read = p.read(reader, name="read_source")
    step = p.task("step_4", adding_processor("clean"), read)
    p.write(writer, step, name="write_silver")

    assert step.address == RunAddress.step("pipeline_2", "step_4")

    p.run()

    assert run_log.records_for_address("pipeline_2.step_4")[0]["status"] == "ok"


def test_pipeline_wires_subject_qualified_run_addresses_from_runner_labels():
    run_log = RecordingRunLog()
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))

    p = Pipeline("cases/selection", run_log=run_log)
    read = p.read(reader, name="read")

    assert read.address == RunAddress.step("selection", "read", subject="cases")
    assert read.address.label == "cases/selection.read"


def test_pipeline_defers_all_work_until_run():
    reader = RecordingReader(CsvReader(FIXTURE).read())
    writer = CapturingWriter()

    p = Pipeline("cases")
    read = p.read(reader, name="read")
    p.write(writer, read, name="write")

    assert reader.read_count == 0
    assert writer.write_count == 0

    p.run()
    assert reader.read_count == 1
    assert writer.write_count == 1


def test_run_hands_the_read_dataset_to_the_writer_and_returns_it():
    source = CsvReader(FIXTURE).read()
    reader = RecordingReader(source)
    writer = CapturingWriter()

    p = Pipeline("cases")
    read = p.read(reader, name="read")
    p.write(writer, read, name="write")
    p.run()

    assert writer.written is source


def test_error_severity_pre_validator_aborts_before_any_write():
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))
    writer = CapturingWriter()

    p = Pipeline("cases")
    read = p.read(reader, name="read")
    val = p.validate(ColumnValidator(["case_ref"]), read, name="pre-validate")
    p.write(writer, val, name="write")

    with pytest.raises(ValidationError):
        p.run()

    assert writer.write_count == 0


def test_failed_run_leaves_the_gold_layer_untouched(tmp_path):
    store = Store(tmp_path / "cases.db")
    seed = Dataset.from_pandas(pd.DataFrame({"id": [1, 2]}))
    store.writer("casepool", AccumulateByRun("r1", "2026-05-29")).write(seed)

    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [3]})))

    p = Pipeline("cases")
    read = p.read(reader, name="read")
    val = p.validate(RowCountValidator(minimum=100), read, name="post-validate")
    p.write(
        store.writer("casepool", AccumulateByRun("r2", "2026-05-30")),
        val,
        name="write",
    )

    with pytest.raises(ValidationError):
        p.run()

    assert len(store.reader("casepool").read()) == 2


def test_checkpoint_write_fires_and_passes_dataset_through_to_terminus():
    ds = Dataset.from_pandas(pd.DataFrame({"id": [1, 2]}))
    reader = RecordingReader(ds)
    cp = CapturingWriter()
    terminus = CapturingWriter()

    p = Pipeline("cases")
    read = p.read(reader, name="read")
    checkpoint = p.write(cp, read, name="checkpoint")
    p.write(terminus, checkpoint, name="write")
    p.run()

    assert cp.write_count == 1
    assert terminus.write_count == 1
    assert cp.written is ds
    assert terminus.written is ds


def test_checkpoint_sees_state_at_its_position_in_the_stage_sequence():
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))
    cp = CapturingWriter()

    p = Pipeline("cases")
    read = p.read(reader, name="read")
    add_a = p.transform(adding_processor("col_a"), read, name="add_a")
    checkpoint = p.write(cp, add_a, name="checkpoint")
    p.transform(adding_processor("col_b"), checkpoint, name="add_b")

    p.run()

    assert "col_a" in cp.written.columns
    assert "col_b" not in cp.written.columns


def test_read_node_can_explicitly_depend_on_action_node():
    events = []

    class EventRecordingReader:
        def read(self) -> Dataset:
            events.append("read")
            return Dataset.from_pandas(pd.DataFrame({"id": [1]}))

    def my_action():
        events.append("action")

    p = Pipeline("cases")
    act = p.action(my_action, name="setup")
    # By making the read depend on the action, we ensure action executes first
    p.read(EventRecordingReader(), name="read", depends_on=[act])

    plan = p.describe()
    assert "[Read] read (depends on: setup)" in plan

    p.run()
    assert events == ["action", "read"]
