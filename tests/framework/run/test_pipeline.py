import logging
from pathlib import Path

import pandas as pd
import pytest

from framework.io.dataset import Dataset
from framework.io.readers import CsvReader, SharePointReader
from framework.io.store import Store
from framework.io.strategy import AccumulateByRun
from framework.io.writers import QuarantineWriter
from framework.run.builder import Pipeline
from framework.run.run_log import RunLog
from framework.run.stages import ProcessingStage, ValidationStage
from framework.transform.validators import (
    ColumnValidator,
    RowCountValidator,
    ValidationError,
)

FIXTURE = Path(__file__).parent.parent.parent / "fixtures" / "cases.csv"


class RecordingReader:
    """A Reader that records how many times it was read (deferral probe)."""

    def __init__(self, dataset: Dataset) -> None:
        self._dataset = dataset
        self.read_count = 0

    def read(self) -> Dataset:
        self.read_count += 1
        return self._dataset


class CapturingWriter:
    """A Writer that captures what it was handed (swap-the-writer probe)."""

    def __init__(self) -> None:
        self.written: Dataset | None = None
        self.write_count = 0

    def write(self, dataset: Dataset) -> None:
        self.written = dataset
        self.write_count += 1


class AddingProcessor:
    """A Processor that adds a column and counts how often it ran (probe)."""

    def __init__(self, column: str) -> None:
        self._column = column
        self.process_count = 0

    def process(self, dataset: Dataset) -> Dataset:
        self.process_count += 1
        frame = dataset.to_pandas().copy()
        frame[self._column] = "derived"
        return Dataset.from_pandas(frame)

    def describe(self) -> str:
        # A user component opting into the describe() protocol.
        return f"AddingProcessor(column={self._column!r})"


class DroppingProcessor:
    """A Processor that removes a column and counts how often it ran."""

    def __init__(self, column: str) -> None:
        self._column = column
        self.process_count = 0

    def process(self, dataset: Dataset) -> Dataset:
        self.process_count += 1
        frame = dataset.to_pandas().drop(columns=[self._column])
        return Dataset.from_pandas(frame)


class SecretPartitioner:
    """A partitioner-shaped probe with sensitive config for plan scrubbing."""

    def __init__(self) -> None:
        self._token = "quarantine-token"

    def partition(self, dataset: Dataset) -> tuple[Dataset, Dataset]:
        return dataset, Dataset.from_pandas(pd.DataFrame())


def test_pipeline_describe_shows_the_deferred_execution_plan():
    # describe() is an authoring/debugging aid: it should expose the composed
    # steps before .run() without triggering the Reader or Writer.
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))
    checkpoint = CapturingWriter()
    writer = CapturingWriter()

    plan = (
        Pipeline("cases", reader)
        .with_validator(ColumnValidator(["id"]))
        .with_processor(AddingProcessor("derived"))
        .checkpoint(checkpoint)
        .with_post_validator(ColumnValidator(["derived"]), severity="warn")
        .write_to(writer)
        .describe()
    )

    assert plan == (
        "Pipeline cases\n"
        "  read: RecordingReader\n"
        "  pre-validate: ColumnValidator(required_columns=['id']) severity=error\n"
        "  process: AddingProcessor(column='derived')\n"
        "  checkpoint: CapturingWriter\n"
        "  post-validate: ColumnValidator(required_columns=['derived']) severity=warn\n"
        "  write: CapturingWriter"
    )
    assert reader.read_count == 0
    assert checkpoint.write_count == 0
    assert writer.write_count == 0


def test_pipeline_describe_includes_optional_governance_without_leaking_secrets(
    tmp_path,
):
    reader = SharePointReader(
        "https://user:hunter2@example.test/sites/cases",
        "Cases",
        auth={"password": "hunter2", "token": "abc123"},
    )

    plan = (
        Pipeline("selection", reader, run_log=RunLog(tmp_path / "runs.log"))
        .quarantine(
            SecretPartitioner(),
            QuarantineWriter(tmp_path / "rejects.db", "rejects"),
        )
        .explain(CapturingWriter(), id_column="case_ref", score_column="priority")
        .write_to(CapturingWriter())
        .describe()
    )

    assert "read: SharePointReader(" in plan
    # The reader's own describe() strips credentials from the site URL and omits
    # the auth config entirely — nothing name-based, the component self-redacts.
    assert "site='https://<redacted>@example.test/sites/cases'" in plan
    assert "auth" not in plan
    # SecretPartitioner opts out of describe(), so it renders as a bare class
    # name: with no reflection, its _token simply cannot reach the plan.
    assert "quarantine: SecretPartitioner -> QuarantineWriter(" in plan
    # explain splits into two plan-ordered entries: trace config early, writer late.
    assert "explain-trace: id_column='case_ref', score_column='priority'" in plan
    assert "explain: writer=CapturingWriter" in plan
    assert f"run-log: RunLog(path='{tmp_path / 'runs.log'}')" in plan
    assert "hunter2" not in plan
    assert "abc123" not in plan
    assert "quarantine-token" not in plan


class DescribingReader:
    """A Reader that renders its own safe summary via the describe() protocol."""

    def __init__(self) -> None:
        self._token = "should-never-appear"

    def describe(self) -> str:
        return "DescribingReader(source='cases')"

    def read(self) -> Dataset:  # pragma: no cover - never run in describe()
        return Dataset.from_pandas(pd.DataFrame({"id": [1]}))


def test_describe_uses_a_components_own_summary_and_never_reflects_attributes():
    # The plan renders a component through its opt-in describe() verbatim. A
    # component without describe() falls back to its bare class name only — the
    # plan never introspects private attributes, so a secret stored under any
    # name (here RecordingReader has no describe()) simply cannot leak.
    describing = DescribingReader()
    leaky_writer = CapturingWriter()
    setattr(leaky_writer, "password", "hunter2")  # a benign-looking field

    plan = Pipeline("cases", describing).write_to(leaky_writer).describe()

    assert "  read: DescribingReader(source='cases')" in plan
    # No describe() => bare class name, no parenthesised attributes at all.
    assert "  write: CapturingWriter" in plan
    assert "CapturingWriter(" not in plan
    assert "should-never-appear" not in plan
    assert "hunter2" not in plan
    assert "redacted" not in plan  # nothing was reflected, so nothing to redact


def test_pipeline_execution_plan_exposes_ordered_step_metadata():
    # The builder's public API remains fluent, but internally .run() and
    # .describe() now share a planned sequence of explicit step objects. The
    # metadata is the hook future plan validation and dry-run slices inspect.
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))
    checkpoint = CapturingWriter()
    writer = CapturingWriter()

    pipeline = (
        Pipeline("cases", reader)
        .with_validator(ColumnValidator(["id"]))
        .quarantine(SecretPartitioner(), CapturingWriter())
        .with_processor(AddingProcessor("derived"))
        .checkpoint(checkpoint)
        .with_post_validator(ColumnValidator(["derived"]))
        .explain(CapturingWriter(), id_column="id")
        .write_to(writer)
    )

    plan = pipeline._execution_plan()

    assert [step.order for step in plan] == list(range(len(plan)))
    assert [step.name for step in plan] == [
        "read",
        "pre-validate",
        "quarantine",
        "explain:trace",
        "process",
        "checkpoint:0",
        "post-validate",
        "explain",
        "write",
    ]
    assert [step.kind for step in plan] == [
        "read",
        "validator",
        "quarantine",
        "trace",
        "processor",
        "checkpoint",
        "validator",
        "explain",
        "write",
    ]
    assert plan[4].component is not None
    assert plan[5].side_effect is True
    assert plan[8].component is writer


def test_add_stage_validates_before_processing_and_stays_deferred():
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))
    processor = AddingProcessor("derived")
    writer = CapturingWriter()
    pipeline = (
        Pipeline("cases", reader)
        .add_stage(
            ValidationStage(
                name="Validate file shape",
                validators=[ColumnValidator(["case_ref"])],
            )
        )
        .add_stage(ProcessingStage(name="Normalise cases", processors=[processor]))
        .write_to(writer)
    )

    assert reader.read_count == 0
    assert processor.process_count == 0

    with pytest.raises(ValidationError, match="Validate file shape"):
        pipeline.run()

    assert processor.process_count == 0
    assert writer.write_count == 0


def test_add_stage_validates_between_two_processors():
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))
    first = AddingProcessor("normalised")
    second = DroppingProcessor("normalised")
    writer = CapturingWriter()

    (
        Pipeline("cases", reader)
        .add_stage(ProcessingStage(name="Add normalised", processors=[first]))
        .add_stage(
            ValidationStage(
                name="Validate normalised",
                validators=[ColumnValidator(["normalised"])],
            )
        )
        .add_stage(ProcessingStage(name="Drop working column", processors=[second]))
        .write_to(writer)
        .run()
    )

    assert first.process_count == 1
    assert second.process_count == 1
    assert "normalised" not in writer.written.columns


def test_add_stage_validates_after_processing_before_write():
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))
    writer = CapturingWriter()

    (
        Pipeline("cases", reader)
        .add_stage(
            ProcessingStage(
                name="Normalise cases",
                processors=[AddingProcessor("derived")],
            )
        )
        .add_stage(
            ValidationStage(
                name="Validate normalised cases",
                validators=[ColumnValidator(["derived"])],
            )
        )
        .write_to(writer)
        .run()
    )

    assert writer.write_count == 1
    assert "derived" in writer.written.columns


def test_add_stage_describe_renders_user_stages_in_execution_order():
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))

    plan = (
        Pipeline("cases", reader)
        .add_stage(
            ValidationStage(
                name="Validate file shape",
                validators=[ColumnValidator(["id"])],
            )
        )
        .add_stage(
            ProcessingStage(
                name="Normalise cases",
                processors=[AddingProcessor("derived")],
            )
        )
        .add_stage(
            ValidationStage(
                name="Validate normalised cases",
                validators=[ColumnValidator(["derived"])],
            )
        )
        .describe()
    )

    assert (
        "  Validate file shape: "
        "ColumnValidator(required_columns=['id']) severity=error\n"
        "  Normalise cases: AddingProcessor(column='derived')\n"
        "  Validate normalised cases: "
        "ColumnValidator(required_columns=['derived']) severity=error"
    ) in plan


def test_processor_transforms_the_dataset_before_the_writer():
    # A processor attached with .with_processor runs between read and write and
    # its transformed dataset — not the read one — is what reaches the Writer.
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1, 2]})))
    writer = CapturingWriter()

    Pipeline("cases", reader).with_processor(AddingProcessor("derived")).write_to(
        writer
    ).run()

    assert "derived" in writer.written.columns


def test_processor_runs_before_post_validators():
    # The processor stage sits ahead of the post-validators: a post-validator
    # requiring the derived column is satisfied only because the processor
    # produced it first (the order the coercion-then-validate flow depends on).
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))
    writer = CapturingWriter()
    pipeline = (
        Pipeline("cases", reader)
        .with_processor(AddingProcessor("derived"))
        .with_post_validator(ColumnValidator(["derived"]))
        .write_to(writer)
    )

    pipeline.run()  # does not raise: 'derived' exists by post-validate time

    assert writer.write_count == 1


def test_processor_is_deferred_until_run():
    # Composing .with_processor is side-effect-free; the processor fires only at
    # .run(), like the reader and writer.
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))
    processor = AddingProcessor("derived")

    pipeline = (
        Pipeline("cases", reader).with_processor(processor).write_to(CapturingWriter())
    )
    assert processor.process_count == 0

    pipeline.run()
    assert processor.process_count == 1


def test_run_hands_the_read_dataset_to_the_writer_and_returns_it():
    # The builder makes no write decisions: it reads via the Reader and hands
    # the exact bulk-tier dataset to whatever Writer was composed in, then
    # returns it.
    source = CsvReader(FIXTURE).read()
    reader = RecordingReader(source)
    writer = CapturingWriter()

    result = Pipeline("cases", reader).write_to(writer).run()

    assert writer.written is source
    assert result is source


def test_pipeline_defers_all_work_until_run():
    # Composing the builder — including write_to — is side-effect-free; the
    # single read and the single write fire only at .run().
    reader = RecordingReader(CsvReader(FIXTURE).read())
    writer = CapturingWriter()

    pipeline = Pipeline("cases", reader).write_to(writer)
    assert reader.read_count == 0
    assert writer.write_count == 0

    pipeline.run()
    assert reader.read_count == 1
    assert writer.write_count == 1


def test_error_severity_pre_validator_aborts_before_any_write():
    # Validators default to error severity; a failing pre-validator
    # aborts the run before the Writer is ever called, so nothing partial lands.
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))
    writer = CapturingWriter()
    pipeline = (
        Pipeline("cases", reader)
        .with_validator(ColumnValidator(["case_ref"]))
        .write_to(writer)
    )

    with pytest.raises(ValidationError):
        pipeline.run()

    assert writer.write_count == 0


def test_failed_run_leaves_the_gold_layer_untouched(tmp_path):
    # End to end through a real Store-minted gold Writer: a re-run that fails an
    # error-severity validator aborts before the accumulate-by-run write, so the
    # prior run's rows are neither deleted nor appended.
    store = Store(tmp_path / "cases")
    seed = Dataset.from_pandas(pd.DataFrame({"id": [1, 2]}))
    store.writer("gold", "casepool", AccumulateByRun("r1", "2026-05-29")).write(seed)

    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [3]})))
    pipeline = (
        Pipeline("cases", reader)
        .with_post_validator(RowCountValidator(minimum=100))
        .write_to(store.writer("gold", "casepool", AccumulateByRun("r2", "2026-05-30")))
    )

    with pytest.raises(ValidationError):
        pipeline.run()

    assert len(store.reader("gold", "casepool").read()) == 2


def test_warn_severity_validator_logs_and_continues(caplog):
    # warn is the explicit escape hatch: a failure logs a warning
    # naming the problem but the run proceeds and the write still lands.
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))
    writer = CapturingWriter()
    pipeline = (
        Pipeline("cases", reader)
        .with_validator(ColumnValidator(["case_ref"]), severity="warn")
        .write_to(writer)
    )

    with caplog.at_level(logging.WARNING):
        pipeline.run()

    assert writer.write_count == 1
    assert "case_ref" in caplog.text


def test_error_severity_post_validator_aborts_before_any_write():
    # A post-validator gates the output that is about to be written; an
    # error-severity failure aborts before the Writer is called, so nothing
    # partial lands.
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))
    writer = CapturingWriter()
    pipeline = (
        Pipeline("cases", reader)
        .with_post_validator(ColumnValidator(["case_ref"]))
        .write_to(writer)
    )

    with pytest.raises(ValidationError):
        pipeline.run()

    assert writer.write_count == 0


def test_checkpoint_is_deferred_until_run():
    # Composing .checkpoint() is side-effect-free; the write fires only at
    # .run(), like the reader and terminus writer.
    ds = Dataset.from_pandas(pd.DataFrame({"id": [1]}))
    reader = RecordingReader(ds)
    cp = CapturingWriter()

    pipeline = Pipeline("cases", reader).checkpoint(cp)
    assert cp.write_count == 0

    pipeline.run()
    assert cp.write_count == 1


def test_multiple_checkpoints_fire_in_attach_order():
    # Two checkpoints both fire, in the order they were attached, and the
    # dataset that reaches each is the same (pass-through, no mutation).
    ds = Dataset.from_pandas(pd.DataFrame({"id": [1, 2]}))
    reader = RecordingReader(ds)
    cp0 = CapturingWriter()
    cp1 = CapturingWriter()
    order: list[str] = []

    class OrderedWriter:
        def __init__(self, label: str, target: CapturingWriter) -> None:
            self._label = label
            self._target = target

        def write(self, dataset: Dataset) -> None:
            order.append(self._label)
            self._target.write(dataset)

    Pipeline("cases", reader).checkpoint(OrderedWriter("a", cp0)).checkpoint(
        OrderedWriter("b", cp1)
    ).run()

    assert order == ["a", "b"]
    assert cp0.write_count == 1
    assert cp1.write_count == 1


def test_checkpoint_failure_aborts_before_terminus_write():
    # A checkpoint that raises aborts the run: the
    # terminus writer is never called, so nothing partial lands.
    class BrokenWriter:
        def write(self, dataset: Dataset) -> None:
            raise RuntimeError("disk full")

    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))
    terminus = CapturingWriter()

    with pytest.raises(RuntimeError, match="disk full"):
        Pipeline("cases", reader).checkpoint(BrokenWriter()).write_to(terminus).run()

    assert terminus.write_count == 0


def test_checkpoint_sees_state_at_its_position_in_the_stage_sequence():
    # A checkpoint attached between two processors sees the dataset as it
    # exists at that point: the first processor's column is present, the
    # second processor's column is not yet added.
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))
    cp = CapturingWriter()

    (
        Pipeline("cases", reader)
        .with_processor(AddingProcessor("col_a"))
        .checkpoint(cp)
        .with_processor(AddingProcessor("col_b"))
        .run()
    )

    assert "col_a" in cp.written.columns
    assert "col_b" not in cp.written.columns


def test_checkpoint_write_fires_and_passes_dataset_through_to_terminus():
    # A checkpoint fires during .run() and the same dataset (unchanged) still
    # reaches the terminus writer.
    ds = Dataset.from_pandas(pd.DataFrame({"id": [1, 2]}))
    reader = RecordingReader(ds)
    cp = CapturingWriter()
    terminus = CapturingWriter()

    Pipeline("cases", reader).checkpoint(cp).write_to(terminus).run()

    assert cp.write_count == 1
    assert terminus.write_count == 1
    assert cp.written is ds
    assert terminus.written is ds
