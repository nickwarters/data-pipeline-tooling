from pathlib import Path

import pandas as pd
import pytest

from framework.builder import Pipeline
from framework.dataset import Dataset
from framework.readers import CsvReader, SharePointReader, SqliteReader
from framework.remote import LocalCsvFetcher
from framework.strategy import AccumulateByRun, Refresh
from framework.writers import (
    AccumulateByRunWriter,
    SharePointWriter,
    SqliteTruncateReloadWriter,
)


class FakeListBackend:
    """An in-memory SharePoint list backend standing in for the deferred client.

    Plays *both* seam roles (fetch + push) over a dict keyed by (site, list), so a
    Dataset pushed by ``SharePointWriter`` can be fetched straight back by
    ``SharePointReader`` with no network, no tenant — the SharePoint-list dual of
    the way ``SasReader`` tests against landed fixture files. One
    object covers both directions, mirroring the single client seam a real on-prem
    SE client will sit behind. ``Refresh`` overwrites a list; ``AccumulateByRun``
    appends to it, so per-Case-Type lists stay independent and runs accumulate.
    """

    def __init__(self) -> None:
        self._lists: dict[tuple[str, str], pd.DataFrame] = {}

    def push(self, site, list_name, auth, dataset, strategy) -> None:
        key = (site, list_name)
        frame = dataset.to_pandas().copy()
        if isinstance(strategy, AccumulateByRun) and key in self._lists:
            frame = pd.concat([self._lists[key], frame], ignore_index=True)
        self._lists[key] = frame

    def fetch(self, site, list_name, auth) -> Dataset:
        return Dataset.from_pandas(self._lists[(site, list_name)].copy())


@pytest.fixture
def fixture_csv(tmp_path) -> Path:
    # A local CSV standing in for a SharePoint list export — no tenant, no auth,
    # no network.
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

    # Observed only through the Dataset's public surface.
    assert dataset.columns == ["adviser_id", "name"]
    assert len(dataset) == 3


def test_default_fetcher_defers_until_implemented():
    # Without a fetcher the real SharePoint client is deferred (auth/tenant out
    # of scope): read() refuses rather than pretending to reach the network.
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


def test_write_then_read_round_trips_through_an_in_memory_list_backend():
    # both directions exercised against a fake in-memory list backend — no
    # network, no real SharePoint. One backend object plays fetcher and pusher,
    # so a Dataset pushed out comes straight back through the read seam.
    backend = FakeListBackend()
    site = "http://sharepoint.corp.local/sites/cases"
    pushed = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1", "c2"], "amount": [100, 200]})
    )

    SharePointWriter(site, "Selection", strategy=Refresh(), pusher=backend).write(pushed)
    read_back = SharePointReader(site, "Selection", fetcher=backend).read()

    assert read_back.columns == ["case_ref", "amount"]
    assert len(read_back) == 2


def test_accumulate_by_run_stamps_survive_the_round_trip():
    # The Writer's AccumulateByRun stamps reach the list and a later run appends
    # rather than replacing, so the backend holds the across-run audit trail the
    # SelectionPool Deliverable carries.
    backend = FakeListBackend()
    site = "http://sharepoint.corp.local/sites/cases"
    rows = Dataset.from_pandas(pd.DataFrame({"case_ref": ["c1"]}))

    SharePointWriter(
        site, "Selection", strategy=AccumulateByRun("r1", "2026-06-10"), pusher=backend
    ).write(rows)
    SharePointWriter(
        site, "Selection", strategy=AccumulateByRun("r2", "2026-06-11"), pusher=backend
    ).write(rows)

    landed = SharePointReader(site, "Selection", fetcher=backend).read()
    frame = landed.to_pandas()
    assert landed.columns == ["case_ref", "run_id", "logical_run_id", "load_date"]
    assert list(frame["run_id"]) == ["r1", "r2"]


def test_selection_pool_is_delivered_to_a_per_case_type_list(tmp_path):
    # the Selection Deliverable terminus. A *second* pipeline reads the gold
    # SelectionPool and writes it to the Case Type's own SharePoint list — the
    # two-pipelines mechanism settled in  (CONTEXT.md), not a mid-run
    # checkpoint. Gold SelectionPool -> SqliteReader -> SharePointWriter -> list.
    case_type = "cases"
    gold_db = tmp_path / case_type / "gold.db"
    selection_pool = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1", "c3"], "question_bank_id": ["qb-100", "qb-100"]})
    )
    # Land the SelectionPool into gold exactly as the Selection pipeline does
    # (accumulate-by-run audit trail), so the Deliverable pipeline reads a real
    # gold table rather than an in-memory hand-off.
    AccumulateByRunWriter(gold_db, "selection_pool", "2026-06-10", "2026-06-10").write(
        selection_pool
    )

    backend = FakeListBackend()
    site = "http://sharepoint.corp.local/sites/cases"
    list_name = f"Selection - {case_type}"  # one list per Case Type

    Pipeline(
        "selection-deliverable", SqliteReader(gold_db, "selection_pool")
    ).write_to(
        SharePointWriter(site, list_name, strategy=Refresh(), pusher=backend)
    ).run()

    delivered = SharePointReader(site, list_name, fetcher=backend).read()
    frame = delivered.to_pandas()
    assert list(frame["case_ref"]) == ["c1", "c3"]
    assert set(frame["question_bank_id"]) == {"qb-100"}
    # The push landed in exactly this Case Type's list and nowhere else — the
    # SelectionPool Deliverable is one list per Case Type.
    assert list(backend._lists.keys()) == [(site, list_name)]
