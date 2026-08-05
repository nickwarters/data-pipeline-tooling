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


def test_a_neighbours_missing_etag_does_not_re_identify_an_unchanged_item():
    # The version is decided per row, not per response. Deciding it per response
    # ("use the ETag column only if every row has one") let one row's blank stamp
    # push every other row onto the digest fallback, so an item that had not
    # changed came back with a new observation id and read as "changed again".
    alone = FakeListClient(
        items({"Id": 1, "Modified": "2026-08-05T08:15:00Z", "ETag": '"3"'})
    )
    with_a_blank_neighbour = FakeListClient(
        items(
            {"Id": 1, "Modified": "2026-08-05T08:15:00Z", "ETag": '"3"'},
            {"Id": 2, "Modified": "2026-08-05T08:16:00Z", "ETag": None},
        )
    )

    first = reader(alone, columns=("ETag",)).read().to_pandas()
    second = reader(with_a_blank_neighbour, columns=("ETag",)).read().to_pandas()

    assert second["source_version"][0] == '"3"'
    assert second["source_observation_id"][0] == first["source_observation_id"][0]
    # The neighbour with no stamp still gets one, from its own values.
    assert second["source_version"][1] != ""


@pytest.mark.parametrize("duplicated", ["ETag", "Id"])
def test_a_duplicate_column_name_is_refused_rather_than_read_ambiguously(duplicated):
    # A duplicate label makes frame[label] a frame, and iterating a frame yields
    # its column *labels*: two ETag columns once stamped every row with the
    # literal string "ETag", silently. Reading a column by name is the basis of
    # the identity contract, so an ambiguous name fails loudly.
    frame = pd.DataFrame(
        [
            [1, "2026-08-05T08:15:00Z", '"3"', '"4"'],
            [2, "2026-08-05T08:16:00Z", '"5"', '"6"'],
        ],
        columns=["Id", "Modified", duplicated, duplicated],
    )

    with pytest.raises(SharePointFeedError) as failure:
        reader(FakeListClient(frame), columns=("ETag",)).read()

    assert duplicated in str(failure.value)
    assert LIST_NAME in str(failure.value)


def test_a_later_named_version_column_is_used_when_the_preferred_one_is_absent():
    # SharePoint surfaces the version under several names depending on how the
    # item was projected; the reader prefers them in order rather than knowing
    # only about ETag.
    client = FakeListClient(
        items({"Id": 1, "Modified": "2026-08-05T08:15:00Z", "Version": "4.0"})
    )

    frame = reader(client, columns=("Version",)).read().to_pandas()

    assert list(frame["source_version"]) == ["4.0"]


def test_the_preferred_version_column_wins_when_several_are_present():
    client = FakeListClient(
        items(
            {
                "Id": 1,
                "Modified": "2026-08-05T08:15:00Z",
                "odata.etag": '"9"',
                "Version": "4.0",
            }
        )
    )

    frame = reader(client, columns=("odata.etag", "Version")).read().to_pandas()

    assert list(frame["source_version"]) == ['"9"']


def test_a_row_blank_in_the_preferred_column_falls_to_the_next_one():
    # Per row, not per column: the first row takes the etag, the second — blank
    # there — takes its Version rather than being pushed onto the digest.
    client = FakeListClient(
        items(
            {
                "Id": 1,
                "Modified": "2026-08-05T08:15:00Z",
                "ETag": '"9"',
                "Version": "4.0",
            },
            {
                "Id": 2,
                "Modified": "2026-08-05T08:16:00Z",
                "ETag": None,
                "Version": "5.0",
            },
        )
    )

    frame = reader(client, columns=("ETag", "Version")).read().to_pandas()

    assert list(frame["source_version"]) == ['"9"', "5.0"]


def test_a_row_without_a_stamp_is_digested_over_its_non_version_values():
    # The digest excludes the version columns themselves: otherwise the
    # partially-populated ETag column would feed the very fallback it triggered,
    # so the same item would digest differently depending on its neighbours.
    lonely = FakeListClient(items({"Id": 9, "Modified": "2026-08-05T08:15:00Z"}))
    beside_a_stamped_row = FakeListClient(
        items(
            {"Id": 9, "Modified": "2026-08-05T08:15:00Z", "ETag": None},
            {"Id": 10, "Modified": "2026-08-05T08:16:00Z", "ETag": '"7"'},
        )
    )

    first = reader(lonely, columns=()).read().to_pandas()
    second = reader(beside_a_stamped_row, columns=("ETag",)).read().to_pandas()

    assert second["source_version"][0] == first["source_version"][0]


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
        == "3ab0b1fba767825318a63ed8699d8384a30d67bbc88233ac7134c1b37f6361a4"
    )


def test_an_empty_response_is_a_zero_row_dataset_with_the_declared_columns():
    # A window with no changes is not an error: the declared projection and the
    # metadata are present either way, so a schema check over *those* does not
    # depend on volume.
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


def test_a_quiet_window_cannot_declare_a_column_the_client_adds_itself():
    # The limit of the guarantee above, pinned rather than left to be discovered
    # on the first quiet night: an expanded lookup the client appends is not in
    # the projection, so nothing here can invent it for an empty window. A
    # downstream schema check must be over the declared columns.
    expanded = {
        "Id": 1,
        "Modified": "2026-08-05T08:15:00Z",
        "CaseRef": "c1",
        "Owner/Title": "Ada",
    }
    populated = reader(
        FakeListClient(items(expanded)), columns=("CaseRef",), expand_fields=("Owner",)
    ).read()
    quiet = reader(
        FakeListClient(pd.DataFrame()), columns=("CaseRef",), expand_fields=("Owner",)
    ).read()

    assert "Owner/Title" in populated.columns
    assert "Owner/Title" not in quiet.columns
    declared = ["Id", "Modified", "CaseRef", *METADATA_COLUMNS]
    assert all(column in populated.columns for column in declared)
    assert quiet.columns == declared


@pytest.mark.parametrize(
    "null_id",
    [
        pytest.param(pd.array([None], dtype="Int64"), id="nullable-int64"),
        pytest.param(pd.array([None], dtype="string"), id="nullable-string"),
        pytest.param([float("nan")], id="float-nan"),
        pytest.param([None], id="object-none"),
    ],
)
def test_every_flavour_of_null_id_is_rejected(null_id):
    # A nullable Int64 null once stringified to "<NA>" and a float32 NaN to
    # "nan" — both looked like present ids to the blank check and landed as
    # un-addressable rows rather than failing.
    client = FakeListClient(
        pd.DataFrame({"Id": null_id, "Modified": ["2026-08-05T08:15:00Z"]})
    )

    with pytest.raises(SharePointFeedError) as failure:
        reader(client, columns=()).read()

    assert "row 0" in str(failure.value) and "Id" in str(failure.value)


def test_a_value_containing_the_digest_separator_cannot_forge_another_item():
    # The digest was a "field=value" join on control characters, so a value
    # holding one could reproduce a different item's payload exactly.
    forged = FakeListClient(
        items({"Id": 1, "Modified": "2026-08-05T08:15:00Z", "a": "x\x1fb=y"})
    )
    plain = FakeListClient(
        items({"Id": 1, "Modified": "2026-08-05T08:15:00Z", "a": "x", "b": "y"})
    )

    first = reader(forged, columns=("a",)).read().to_pandas()
    second = reader(plain, columns=("a", "b")).read().to_pandas()

    assert first["source_version"][0] != second["source_version"][0]


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
