from pathlib import Path

import pandas as pd
import pytest

from framework.builder import Pipeline
from framework.dataset import Dataset
from framework.readers import CsvReader, SharePointReader
from framework.remote import LocalCsvFetcher
from framework.strategy import AccumulateByRun, Refresh
from framework.writers import SharePointWriter, SqliteTruncateReloadWriter


@pytest.fixture
def fixture_csv(tmp_path) -> Path:
    # A local CSV standing in for a SharePoint list export — no tenant, no auth,
    # no network (ADR-0004).
    path = tmp_path / "advisers.csv"
    path.write_text("adviser_id,name\n1,Ada\n2,Linus\n3,Grace\n")
    return path


def test_reads_a_list_through_a_fixture_fetcher(fixture_csv):
    # The fetch is behind a swappable seam: an offline LocalCsvFetcher stands in
    # for the deferred SharePoint client so the read path is exercised.
    reader = SharePointReader(
        "https://contoso.sharepoint.com/sites/cases",
        "Advisers",
        fetcher=LocalCsvFetcher(fixture_csv),
    )

    dataset = reader.read()

    # Observed only through the Dataset's public surface (ADR-0002).
    assert dataset.columns == ["adviser_id", "name"]
    assert len(dataset) == 3


def test_default_fetcher_defers_until_implemented():
    # Without a fetcher the real SharePoint client is deferred (auth/tenant out
    # of scope — ADR-0004): read() refuses rather than pretending to reach the
    # network.
    reader = SharePointReader("https://contoso.sharepoint.com", "Advisers")

    with pytest.raises(NotImplementedError):
        reader.read()


class RecordingFetcher:
    """A swapped-in SharePointFetcher that records the config it was handed."""

    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def fetch(self, site, list_name, auth):
        self.calls.append((site, list_name, auth))
        return Dataset.from_pandas(pd.DataFrame({"adviser_id": [1]}))


def test_passes_the_configured_site_list_and_auth_to_the_fetcher():
    # The config shape (site, list, auth) is handed to the swappable seam
    # verbatim — the contract a real client will receive later.
    fetcher = RecordingFetcher()
    auth = {"client_id": "abc", "secret": "xyz"}

    SharePointReader(
        "https://contoso.sharepoint.com/sites/cases",
        "Advisers",
        auth,
        fetcher=fetcher,
    ).read()

    assert fetcher.calls == [
        ("https://contoso.sharepoint.com/sites/cases", "Advisers", auth)
    ]


def test_sharepoint_reader_composes_in_the_pipeline_builder(fixture_csv, tmp_path):
    # A SharePointReader is a Reader: it drops into the deferred builder and
    # feeds a raw landing exactly like any other source (Reader-Protocol
    # conformance, observed end-to-end rather than via isinstance).
    landed = (
        Pipeline(
            "advisers",
            SharePointReader(
                "https://contoso.sharepoint.com",
                "Advisers",
                fetcher=LocalCsvFetcher(fixture_csv),
            ),
        )
        .write_to(SqliteTruncateReloadWriter(tmp_path / "raw.db", "advisers"))
        .run()
    )

    assert landed.columns == ["adviser_id", "name"]
    assert len(landed) == 3


def test_default_sharepoint_writer_defers_until_implemented(fixture_csv):
    writer = SharePointWriter(
        "https://contoso.sharepoint.com",
        "Advisers",
        strategy=Refresh(),
    )

    with pytest.raises(NotImplementedError):
        writer.write(CsvReader(fixture_csv).read())


class RecordingPusher:
    """A swapped-in SharePointPusher that records the config and dataset."""

    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def push(self, site, list_name, auth, dataset, strategy):
        self.calls.append((site, list_name, auth, dataset, strategy))


def test_sharepoint_writer_composes_in_the_pipeline_builder(fixture_csv):
    # The SharePoint write side is the outbound dual of SharePointReader:
    # Pipeline hands it a Dataset, and the configured pusher owns the remote IO.
    pusher = RecordingPusher()
    auth = {"client_id": "abc", "secret": "xyz"}
    strategy = AccumulateByRun("r1", "2026-05-29")

    Pipeline(
        "advisers",
        SharePointReader(
            "https://contoso.sharepoint.com",
            "Advisers",
            fetcher=LocalCsvFetcher(fixture_csv),
        ),
    ).write_to(
        SharePointWriter(
            "https://contoso.sharepoint.com/sites/cases",
            "Advisers",
            auth,
            strategy,
            pusher=pusher,
        )
    ).run()

    [(site, list_name, pushed_auth, dataset, pushed_strategy)] = pusher.calls
    assert site == "https://contoso.sharepoint.com/sites/cases"
    assert list_name == "Advisers"
    assert pushed_auth == auth
    assert pushed_strategy == strategy
    assert dataset.columns == [
        "adviser_id",
        "name",
        "run_id",
        "logical_run_id",
        "load_date",
    ]
    assert len(dataset) == 3
