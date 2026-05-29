from pathlib import Path

from framework.builder import Pipeline
from framework.data_handle import DataHandle
from framework.readers import CsvReader
from framework.store import Store

FIXTURE = Path(__file__).parent / "fixtures" / "cases.csv"


class RecordingReader:
    """A Reader that records how many times it was read (deferral probe)."""

    def __init__(self, handle: DataHandle) -> None:
        self._handle = handle
        self.read_count = 0

    def read(self) -> DataHandle:
        self.read_count += 1
        return self._handle


def test_pipeline_defers_execution_until_to(tmp_path):
    source = CsvReader(FIXTURE).read()
    reader = RecordingReader(source)
    store = Store(tmp_path)

    pipeline = Pipeline("cases", reader, store)
    assert reader.read_count == 0  # composing the builder runs nothing (ADR-0003)

    result = pipeline.to("raw")

    assert reader.read_count == 1  # .to triggers the single read
    assert len(result) == len(source)  # .to returns the landed handle
    assert len(store.read("raw", "cases")) == len(source)  # rows landed in raw
