import logging
from pathlib import Path

import pandas as pd
import pytest

from framework.builder import Pipeline
from framework.dataset import Dataset
from framework.readers import CsvReader
from framework.store import Store
from framework.strategy import AccumulateByRun
from framework.validators import ColumnValidator, RowCountValidator, ValidationError

FIXTURE = Path(__file__).parent / "fixtures" / "cases.csv"


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
    # .run() (ADR-0003), like the reader and writer.
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [1]})))
    processor = AddingProcessor("derived")

    pipeline = Pipeline("cases", reader).with_processor(processor).write_to(
        CapturingWriter()
    )
    assert processor.process_count == 0

    pipeline.run()
    assert processor.process_count == 1


def test_run_hands_the_read_dataset_to_the_writer_and_returns_it():
    # The builder makes no write decisions: it reads via the Reader and hands
    # the exact bulk-tier dataset to whatever Writer was composed in, then
    # returns it (ADR-0003: .run() returns the opaque tabular dataset).
    source = CsvReader(FIXTURE).read()
    reader = RecordingReader(source)
    writer = CapturingWriter()

    result = Pipeline("cases", reader).write_to(writer).run()

    assert writer.written is source
    assert result is source


def test_pipeline_defers_all_work_until_run():
    # Composing the builder — including write_to — is side-effect-free; the
    # single read and the single write fire only at .run() (ADR-0003).
    reader = RecordingReader(CsvReader(FIXTURE).read())
    writer = CapturingWriter()

    pipeline = Pipeline("cases", reader).write_to(writer)
    assert reader.read_count == 0
    assert writer.write_count == 0

    pipeline.run()
    assert reader.read_count == 1
    assert writer.write_count == 1


def test_error_severity_pre_validator_aborts_before_any_write():
    # Validators default to error severity (ADR-0007); a failing pre-validator
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
    # prior run's rows are neither deleted nor appended — nothing partial lands
    # (ADR-0007 fail-fast + atomic).
    store = Store(tmp_path / "cases")
    seed = Dataset.from_pandas(pd.DataFrame({"id": [1, 2]}))
    store.writer("gold", "casepool", AccumulateByRun("r1", "2026-05-29")).write(seed)

    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"id": [3]})))
    pipeline = (
        Pipeline("cases", reader)
        .with_post_validator(RowCountValidator(minimum=100))
        .write_to(
            store.writer("gold", "casepool", AccumulateByRun("r2", "2026-05-30"))
        )
    )

    with pytest.raises(ValidationError):
        pipeline.run()

    assert len(store.reader("gold", "casepool").read()) == 2


def test_warn_severity_validator_logs_and_continues(caplog):
    # warn is the explicit escape hatch (ADR-0007): a failure logs a warning
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
    # error-severity failure aborts before the Writer is called (ADR-0008
    # silver/gold schema checks run here), so nothing partial lands.
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
