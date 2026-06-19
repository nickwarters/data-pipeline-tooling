from pathlib import Path

import pytest

from framework.io.readers import SasReader
from framework.io.writers import SqliteTruncateReloadWriter
from framework.run.builder import Pipeline


@pytest.fixture
def landing(tmp_path) -> Path:
    # A local landing directory standing in for the scp destination: the SAS
    # box's output already copied back as a file. The reader is exercised
    # against this fixture — no SSH, no SAS, no network.
    dest = tmp_path / "landing"
    dest.mkdir()
    (dest / "cases.csv").write_text("case_id,advisor\n1,a\n2,b\n3,c\n")
    return dest


def test_reads_landed_output_file_into_a_dataset(landing):
    dataset = SasReader("run_cases.sas", "*.csv", landing).read()

    # Observed only through the Dataset's public surface — the test never
    # touches pandas.
    assert dataset.columns == ["case_id", "advisor"]
    assert len(dataset) == 3


class RecordingRunner:
    """A swapped-in RemoteRunner that records the calls it received."""

    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def run_script(self, script: str) -> None:
        self.calls.append(("run_script", script))

    def fetch(self, copy_glob, dest) -> None:
        self.calls.append(("fetch", copy_glob, dest))


def test_runs_the_script_then_fetches_before_reading(landing):
    # The shell/transfer is behind a swappable seam: a different runner
    # drops in and observes that read() drives run -> fetch with the configured
    # script and glob, in that order.
    runner = RecordingRunner()

    SasReader("run_cases.sas", "*.csv", landing, runner=runner).read()

    assert runner.calls == [
        ("run_script", "run_cases.sas"),
        ("fetch", "*.csv", landing),
    ]


def test_concatenates_every_file_matching_the_glob(tmp_path):
    # A SAS run may land its output across several files; the glob reads them
    # all, in sorted order, into one Dataset.
    dest = tmp_path / "landing"
    dest.mkdir()
    (dest / "part_a.csv").write_text("case_id\n1\n2\n")
    (dest / "part_b.csv").write_text("case_id\n3\n")

    dataset = SasReader("run.sas", "part_*.csv", dest).read()

    assert dataset.columns == ["case_id"]
    assert len(dataset) == 3


def test_raises_when_nothing_landed_matches_the_glob(tmp_path):
    # With the transfer stubbed and nothing landed, the read path fails loudly
    # rather than returning an empty Dataset that masks a broken fetch.
    dest = tmp_path / "empty"
    dest.mkdir()

    with pytest.raises(FileNotFoundError):
        SasReader("run.sas", "*.csv", dest).read()


def test_sas_reader_composes_in_the_pipeline_builder(landing, tmp_path):
    # A SasReader is a Reader: it drops into the deferred builder and feeds a
    # raw landing exactly like any other source (Reader-Protocol conformance,
    # observed end-to-end rather than via isinstance).
    p = Pipeline("cases")
    r = p.read(SasReader("run_cases.sas", "*.csv", landing), name="read")
    w = p.write(SqliteTruncateReloadWriter(tmp_path / "raw.db", "cases"), r, name="write")
    landed = p.run()

    assert landed.columns == ["case_id", "advisor"]
    assert len(landed) == 3
