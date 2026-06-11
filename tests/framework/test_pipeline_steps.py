"""Per-step plan_entry() unit tests.

Each concrete PipelineStep renders its own describe() entry; these tests verify
the rendering in isolation, independent of the full Pipeline.describe() path.
"""

from framework.pipeline_steps import (
    CheckpointStep,
    ExplainWriteStep,
    ProcessorStageStep,
    QuarantineStep,
    ReadStep,
    TraceStartStep,
    ValidatorStep,
    WriteStep,
)
from framework.validators import ColumnValidator


class DescribedReader:
    def describe(self) -> str:
        return "DescribedReader(path='cases.csv')"

    def read(self):
        raise NotImplementedError


class PlainReader:
    def read(self):
        raise NotImplementedError


class PlainWriter:
    def write(self, dataset):
        raise NotImplementedError


def test_read_step_plan_entry_uses_component_summary():
    step = ReadStep(DescribedReader())
    assert step.plan_entry() == "  read: DescribedReader(path='cases.csv')"


def test_read_step_plan_entry_falls_back_to_class_name():
    step = ReadStep(PlainReader())
    assert step.plan_entry() == "  read: PlainReader"


def test_validator_step_plan_entry_is_none_when_empty():
    step = ValidatorStep(name="pre-validate", validators=[])
    assert step.plan_entry() is None


def test_validator_step_plan_entry_single_validator():
    validator = ColumnValidator(["id"])
    step = ValidatorStep(name="pre-validate", validators=[(validator, "error")])
    assert (
        step.plan_entry()
        == "  pre-validate: ColumnValidator(required_columns=['id']) severity=error"
    )


def test_validator_step_plan_entry_multiple_validators():
    v1 = ColumnValidator(["id"])
    v2 = ColumnValidator(["name"])
    step = ValidatorStep(
        name="pre-validate",
        validators=[(v1, "error"), (v2, "warn")],
    )
    assert step.plan_entry() == (
        "  pre-validate:\n"
        "    - ColumnValidator(required_columns=['id']) severity=error\n"
        "    - ColumnValidator(required_columns=['name']) severity=warn"
    )


def test_validator_step_plan_entry_uses_custom_stage_name():
    v = ColumnValidator(["case_ref"])
    step = ValidatorStep(name="Validate file shape", validators=[(v, "error")])
    assert step.plan_entry() == (
        "  Validate file shape: "
        "ColumnValidator(required_columns=['case_ref']) severity=error"
    )


class DescribedProcessor:
    def describe(self) -> str:
        return "DescribedProcessor(column='x')"

    def process(self, dataset):
        return dataset


class PlainProcessor:
    def process(self, dataset):
        return dataset


def test_processor_stage_step_plan_entry_uses_component_summary():
    step = ProcessorStageStep(name="process", processors=[DescribedProcessor()])
    assert step.plan_entry() == "  process: DescribedProcessor(column='x')"


def test_processor_stage_step_plan_entry_uses_custom_name():
    step = ProcessorStageStep(name="Normalise cases", processors=[PlainProcessor()])
    assert step.plan_entry() == "  Normalise cases: PlainProcessor"


def test_checkpoint_step_plan_entry_renders_checkpoint_label():
    # The step name carries a counter ("checkpoint:0") for execution identity;
    # plan_entry() renders the display label as "checkpoint" without the counter.
    step = CheckpointStep(name="checkpoint:0", writer=PlainWriter())
    assert step.plan_entry() == "  checkpoint: PlainWriter"


def test_checkpoint_step_plan_entry_uses_component_summary():
    class DescribedWriter:
        def describe(self) -> str:
            return "DescribedWriter(path='silver.db')"

        def write(self, dataset):
            pass

    step = CheckpointStep(name="checkpoint:1", writer=DescribedWriter())
    assert step.plan_entry() == "  checkpoint: DescribedWriter(path='silver.db')"


class PlainPartitioner:
    def partition(self, dataset):
        return dataset, dataset


def test_quarantine_step_plan_entry_renders_partitioner_and_reject_writer():
    step = QuarantineStep(PlainPartitioner(), PlainWriter())
    assert step.plan_entry() == "  quarantine: PlainPartitioner -> PlainWriter"


def test_quarantine_step_plan_entry_uses_component_summary_for_both():
    class DescribedPartitioner:
        def describe(self) -> str:
            return "DescribedPartitioner(rule='value')"

        def partition(self, dataset):
            return dataset, dataset

    class DescribedRejectWriter:
        def describe(self) -> str:
            return "QuarantineWriter(db_path='rejects.db', table='rejects')"

        def write(self, dataset):
            pass

    step = QuarantineStep(DescribedPartitioner(), DescribedRejectWriter())
    assert step.plan_entry() == (
        "  quarantine: DescribedPartitioner(rule='value') -> "
        "QuarantineWriter(db_path='rejects.db', table='rejects')"
    )


def test_trace_start_step_plan_entry_with_id_and_score_columns():
    step = TraceStartStep(id_column="case_ref", score_column="priority_score")
    assert step.plan_entry() == (
        "  explain-trace: id_column='case_ref', score_column='priority_score'"
    )


def test_trace_start_step_plan_entry_omits_score_column_when_none():
    step = TraceStartStep(id_column="case_ref", score_column=None)
    assert step.plan_entry() == "  explain-trace: id_column='case_ref'"


def test_explain_write_step_plan_entry_uses_component_summary():
    step = ExplainWriteStep(PlainWriter())
    assert step.plan_entry() == "  explain: writer=PlainWriter"


def test_write_step_plan_entry_uses_component_summary():
    step = WriteStep(PlainWriter())
    assert step.plan_entry() == "  write: PlainWriter"
