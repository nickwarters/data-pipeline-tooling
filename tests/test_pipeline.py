from pathlib import Path

from framework.builder import Pipeline
from framework.data_handle import DataHandle
from framework.readers import CsvReader

FIXTURE = Path(__file__).parent / "fixtures" / "cases.csv"


class RecordingReader:
    """A Reader that records how many times it was read (deferral probe)."""

    def __init__(self, handle: DataHandle) -> None:
        self._handle = handle
        self.read_count = 0

    def read(self) -> DataHandle:
        self.read_count += 1
        return self._handle


class CapturingWriter:
    """A Writer that captures what it was handed (swap-the-writer probe)."""

    def __init__(self) -> None:
        self.written: DataHandle | None = None
        self.write_count = 0

    def write(self, handle: DataHandle) -> None:
        self.written = handle
        self.write_count += 1


def test_run_hands_the_read_handle_to_the_writer_and_returns_it():
    # The builder makes no write decisions: it reads via the Reader and hands
    # the exact bulk-tier handle to whatever Writer was composed in, then
    # returns it (ADR-0003: .run() returns the opaque tabular handle).
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
