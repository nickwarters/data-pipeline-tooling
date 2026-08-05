"""The Modified-window Reader, exercised against a fake list client.

No network, no tenant, no auth: the organisational SharePoint client is a seam
(:class:`SharePointListClient`), so every test here hands the Reader a fake that
records the query it was configured with and returns a frame.
"""

import datetime as dt

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.io.writers import SqliteTruncateReloadWriter
from framework.run.builder import Pipeline
from tools.integrations.sharepoint_rest import (
    METADATA_COLUMNS,
    ModifiedWindow,
    SharePointFeedError,
    SharePointModifiedReader,
    StubbedSharePointListClient,
)
from tools.retry import RetryingReader, RetryPolicy

SITE = "https://contoso.sharepoint.com/sites/case-review"
LIST_NAME = "Cases"
WINDOW = ModifiedWindow(
    start=dt.datetime(2026, 8, 5, 8, tzinfo=dt.timezone.utc),
    end=dt.datetime(2026, 8, 5, 9, tzinfo=dt.timezone.utc),
)


class FakeListClient:
    """A :class:`SharePointListClient` that records its query and replays frames."""

    def __init__(self, *frames: pd.DataFrame) -> None:
        self._frames = list(frames) or [items()]
        self.calls: list[dict[str, object]] = []

    def fetch_items(self, list_name, expand_fields, select_fields, filters):
        self.calls.append(
            {
                "list_name": list_name,
                "expand_fields": list(expand_fields),
                "select_fields": list(select_fields),
                "filters": list(filters),
            }
        )
        return self._frames[min(len(self.calls) - 1, len(self._frames) - 1)].copy()


def items(*rows: dict[str, object]) -> pd.DataFrame:
    """A list-item frame in the shape the client returns."""
    return pd.DataFrame(
        list(rows)
        or [
            {
                "Id": 1,
                "Modified": "2026-08-05T08:15:00Z",
                "CaseRef": "c1",
                "Status": "Open",
            }
        ]
    )


def reader(client, *, window=WINDOW, columns=("CaseRef", "Status"), **kwargs):
    return SharePointModifiedReader(
        SITE, LIST_NAME, columns, window, client=client, **kwargs
    )


def test_configures_the_client_with_the_projection_and_closed_open_window():
    # The one query the Reader owns: the list by name, Id/Modified plus the
    # caller's columns, and a half-open [start, end) Modified predicate so
    # consecutive windows neither drop nor double-count an item.
    client = FakeListClient()

    reader(client).read()

    assert client.calls == [
        {
            "list_name": LIST_NAME,
            "expand_fields": [],
            "select_fields": ["Id", "Modified", "CaseRef", "Status"],
            "filters": [
                "Modified ge datetime'2026-08-05T08:00:00Z'",
                "Modified lt datetime'2026-08-05T09:00:00Z'",
            ],
        }
    ]


def test_first_load_omits_only_the_lower_predicate():
    # start=None is the first-load shape: every current item strictly before
    # end, with the upper bound still in force.
    client = FakeListClient()

    reader(client, window=ModifiedWindow(None, WINDOW.end)).read()

    assert client.calls[0]["filters"] == ["Modified lt datetime'2026-08-05T09:00:00Z'"]


def test_window_bounds_are_converted_to_utc_once():
    # A caller's local-offset bound is encoded in UTC exactly once, so the
    # predicate a Windows box sends matches the one a macOS box sends.
    client = FakeListClient()
    local = dt.timezone(dt.timedelta(hours=1))

    reader(
        client,
        window=ModifiedWindow(
            dt.datetime(2026, 8, 5, 9, tzinfo=local),
            dt.datetime(2026, 8, 5, 10, tzinfo=local),
        ),
    ).read()

    assert client.calls[0]["filters"] == [
        "Modified ge datetime'2026-08-05T08:00:00Z'",
        "Modified lt datetime'2026-08-05T09:00:00Z'",
    ]


def test_a_naive_window_bound_is_refused():
    # A bound with no offset has no single UTC meaning; guessing one silently
    # shifts the window by the reading machine's zone.
    with pytest.raises(ValueError, match="timezone-aware"):
        ModifiedWindow(None, dt.datetime(2026, 8, 5, 9))


def test_expand_fields_reach_the_client():
    client = FakeListClient()

    reader(client, expand_fields=("Owner",)).read()

    assert client.calls[0]["expand_fields"] == ["Owner"]


def test_returns_the_source_rows_with_immutable_observation_metadata():
    client = FakeListClient(
        items(
            {"Id": 7, "Modified": "2026-08-05T08:15:00Z", "CaseRef": "c1"},
            {"Id": 8, "Modified": "2026-08-05T08:45:00Z", "CaseRef": "c2"},
        )
    )

    window_reader = reader(client, columns=("CaseRef",), observed_at=lambda: "OBSERVED")
    dataset = window_reader.read()

    frame = dataset.to_pandas()
    assert dataset.columns == ["Id", "Modified", "CaseRef", *METADATA_COLUMNS]
    # Source order is preserved and each row carries its own item identity.
    assert list(frame["CaseRef"]) == ["c1", "c2"]
    assert list(frame["source_item_id"]) == ["7", "8"]
    assert list(frame["source_modified_at"]) == [
        "2026-08-05T08:15:00+00:00",
        "2026-08-05T08:45:00+00:00",
    ]
    assert set(frame["source_list_name"]) == {LIST_NAME}
    assert set(frame["observed_at"]) == {"OBSERVED"}


def test_the_version_is_the_items_etag_when_the_list_supplies_one():
    client = FakeListClient(
        items({"Id": 1, "Modified": "2026-08-05T08:15:00Z", "ETag": '"3"'})
    )

    frame = reader(client, columns=("ETag",)).read().to_pandas()

    assert list(frame["source_version"]) == ['"3"']


def test_the_version_falls_back_to_a_digest_of_the_item_payload():
    # No ETag: the version is a digest of the item's own values, so an edit
    # that changes any selected field changes the version.
    before = FakeListClient(
        items({"Id": 1, "Modified": "2026-08-05T08:15:00Z", "CaseRef": "c1"})
    )
    after = FakeListClient(
        items({"Id": 1, "Modified": "2026-08-05T08:15:00Z", "CaseRef": "c2"})
    )

    first = reader(before, columns=("CaseRef",)).read().to_pandas()
    second = reader(after, columns=("CaseRef",)).read().to_pandas()

    assert first["source_version"][0] != second["source_version"][0]


def test_the_observation_id_is_deterministic_for_the_same_item_and_version():
    # Pinned to a literal so the identity is stable across platforms and
    # interpreter runs — a salted hash() would pass an equality check within one
    # process and give Windows and macOS different answers.
    client = FakeListClient(
        items({"Id": 1, "Modified": "2026-08-05T08:15:00Z", "ETag": '"3"'})
    )

    first = reader(client, columns=("ETag",)).read().to_pandas()
    second = reader(client, columns=("ETag",)).read().to_pandas()

    assert first["source_observation_id"][0] == second["source_observation_id"][0]
    assert (
        first["source_observation_id"][0]
        == "9c9daa96ab03e66a4ed61e0e3e23f27f97c37bfb387712b489188966f218e943"
    )


def test_an_empty_response_is_a_zero_row_dataset_with_the_declared_columns():
    # A window with no changes is not an error: downstream sees the same shape
    # it would have seen with rows, so a schema check does not depend on volume.
    client = FakeListClient(pd.DataFrame())

    dataset = reader(client).read()

    assert len(dataset) == 0
    assert dataset.columns == [
        "Id",
        "Modified",
        "CaseRef",
        "Status",
        *METADATA_COLUMNS,
    ]


@pytest.mark.parametrize("missing", ["Id", "Modified"])
def test_a_missing_identity_column_fails_with_a_located_message(missing):
    row = {"Id": 1, "Modified": "2026-08-05T08:15:00Z", "CaseRef": "c1"}
    del row[missing]
    client = FakeListClient(items(row))

    with pytest.raises(SharePointFeedError) as failure:
        reader(client, columns=("CaseRef",)).read()

    message = str(failure.value)
    assert missing in message and LIST_NAME in message


@pytest.mark.parametrize("value", [None, "", "not-a-timestamp"])
def test_an_unusable_modified_value_fails_with_a_located_message(value):
    client = FakeListClient(items({"Id": 1, "Modified": value, "CaseRef": "c1"}))

    with pytest.raises(SharePointFeedError) as failure:
        reader(client, columns=("CaseRef",)).read()

    # Located: the row is named, so an operator can find the item in the list.
    assert "row 0" in str(failure.value)
    assert "Modified" in str(failure.value)


def test_a_blank_item_id_fails_with_a_located_message():
    client = FakeListClient(items({"Id": None, "Modified": "2026-08-05T08:15:00Z"}))

    with pytest.raises(SharePointFeedError) as failure:
        reader(client, columns=()).read()

    assert "row 0" in str(failure.value)
    assert "Id" in str(failure.value)


def test_the_default_client_defers_until_a_real_one_is_supplied():
    with pytest.raises(NotImplementedError):
        SharePointModifiedReader(SITE, LIST_NAME, ("CaseRef",), WINDOW).read()


def test_the_stub_client_names_the_seam_to_supply():
    with pytest.raises(NotImplementedError, match="fetch_items"):
        StubbedSharePointListClient().fetch_items(LIST_NAME, (), (), ())


def test_credentials_in_the_site_url_survive_nowhere():
    # describe() feeds the plan and data_locations feeds the persisted run
    # record: neither may become the one place a secret survives.
    site = "https://user:pass@contoso.sharepoint.com/sites/case-review"
    client = FakeListClient()

    reading = SharePointModifiedReader(
        site, LIST_NAME, ("CaseRef",), WINDOW, client=client
    )
    reading.read()

    assert reading.data_locations == [
        {
            "namespace": "https://<redacted>@contoso.sharepoint.com/sites/case-review",
            "name": LIST_NAME,
        }
    ]
    assert "user:pass" not in reading.describe()
    assert "user:pass" not in str(reading.data_locations)


def test_describe_renders_the_window_without_reaching_the_list():
    described = reader(FakeListClient()).describe()

    assert "SharePointModifiedReader" in described
    assert "2026-08-05T08:00:00Z" in described
    assert "2026-08-05T09:00:00Z" in described


def test_retry_composes_around_the_reader_rather_than_living_inside_it():
    # A transient client failure is the RetryingReader's business; the Reader
    # itself holds no retry logic, so one policy covers every source.
    class FlakyClient(FakeListClient):
        def fetch_items(self, list_name, expand_fields, select_fields, filters):
            if not self.calls:
                self.calls.append({})
                raise ConnectionError("transient")
            return super().fetch_items(list_name, expand_fields, select_fields, filters)

    retrying = RetryingReader(
        reader(FlakyClient()),
        RetryPolicy(attempts=2, retry_on=(ConnectionError,)),
    )

    assert len(retrying.read()) == 1


def test_composes_in_the_pipeline_builder(tmp_path):
    # Reader-Protocol conformance observed end to end: the window Reader feeds a
    # raw landing exactly like any other source.
    client = FakeListClient(
        items(
            {"Id": 1, "Modified": "2026-08-05T08:15:00Z", "CaseRef": "c1"},
            {"Id": 2, "Modified": "2026-08-05T08:45:00Z", "CaseRef": "c2"},
        )
    )

    p = Pipeline("cases-window")
    source = p.read(reader(client, columns=("CaseRef",)), name="read")
    p.write(SqliteTruncateReloadWriter(tmp_path / "raw.db", "cases"), source, name="w")
    landed = p.run()

    assert isinstance(landed, Dataset)
    assert len(landed) == 2
    assert "source_observation_id" in landed.columns
