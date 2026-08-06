"""Tests for the ``sharepoint_cases`` SharePoint list ingest.

Most of these drive a builder directly, in memory: `given_rows` (or a fake list
client) as the Reader, `RecordingWriter` as the Writer, no SQLite and no
filesystem. Only the behaviours that *are* the store — append-only idempotence,
a conflicting re-observation, the checkpoint being left alone — go end to end
under `tmp_path`.

No network, no tenant, no auth: the organisational SharePoint client is a seam,
so every test here hands the Reader a fake that replays frames.
"""

from __future__ import annotations

import datetime as dt
import json

import pandas as pd
import pytest

from framework.core import ValidationError
from framework.io import AppendOnlyConflictError
from framework.run import RunContext, RunLog
from pipelines.sharepoint_cases.pipeline import (
    EXPAND_FIELDS,
    FEED_NAME,
    LIST_ID,
    LIST_NAME,
    MULTI_VALUE_COLUMNS,
    RAW_FEED_COLUMNS,
    SAFETY_LAG,
    SILVER_SOURCE_COLUMNS,
    SITE,
    SOURCE_COLUMNS,
    LocalJsonListClient,
    StorableObservations,
    party_builder,
    raw_builder,
    run,
    silver_builder,
)
from tests.framework_testing import (
    RecordingWriter,
    given_rows,
    read_rows,
    read_run_log,
    rows_of,
)
from tools.integrations.sharepoint_checkpoint import (
    SharePointCheckpointStore,
    SharePointSource,
)
from tools.integrations.sharepoint_rest import (
    ModifiedWindow,
    SharePointModifiedReader,
)
from tools.medallion import medallion
from tools.store import StoreRegistry

SERVER_NOW = dt.datetime(2026, 8, 5, 9, tzinfo=dt.timezone.utc)
WINDOW = ModifiedWindow(start=None, end=SERVER_NOW - SAFETY_LAG)
SOURCE = SharePointSource(SITE, LIST_ID)


class FakeListClient:
    """A ``SharePointListClient`` replaying one frame per call, with a clock."""

    def __init__(self, *frames: pd.DataFrame, server_now: dt.datetime = SERVER_NOW):
        self._frames = list(frames) or [items()]
        self._server_now = server_now
        self.calls: list[dict[str, object]] = []

    def fetch_items(self, list_name, expand_fields, select_fields, filters):
        self.calls.append({"list_name": list_name, "filters": list(filters)})
        return self._frames[min(len(self.calls) - 1, len(self._frames) - 1)].copy()

    def server_time(self) -> dt.datetime:
        return self._server_now


def item(
    *,
    item_id: int = 101,
    modified: str = "2026-08-05T08:10:00Z",
    etag: str = "3",
    case_ref: str = "C000101",
    status: str = "Open",
    risk_score: int = 42,
    owner_id: int = 17,
    owner_title: str = "A. Khan",
    party_ids: list[int] | None = None,
    party_titles: list[str] | None = None,
) -> dict[str, object]:
    """One list item in the shape the organisational client returns."""
    return {
        "Id": item_id,
        "Modified": modified,
        "odata.etag": etag,
        "CaseRef": case_ref,
        "Status": status,
        "OpenedOn": "2026-07-01T00:00:00Z",
        "TargetCloseOn": "2026-08-01T00:00:00Z",
        "RiskScore": risk_score,
        "OwnerId": owner_id,
        "Owner/Title": owner_title,
        "PartiesId": [17, 23] if party_ids is None else party_ids,
        "Parties/Title": (
            ["A. Khan", "B. Okafor"] if party_titles is None else party_titles
        ),
    }


def items(*rows: dict[str, object]) -> pd.DataFrame:
    return pd.DataFrame(list(rows) or [item()])


def observations(client: FakeListClient) -> StorableObservations:
    """The feed's real Reader stack over a fake client."""
    return StorableObservations(
        SharePointModifiedReader(
            SITE,
            LIST_NAME,
            SOURCE_COLUMNS,
            WINDOW,
            expand_fields=EXPAND_FIELDS,
            client=client,
        ),
        RAW_FEED_COLUMNS,
        MULTI_VALUE_COLUMNS,
    )


def landed(rows: list[dict]) -> list[dict]:
    """The raw rows, projected to the source columns silver reads."""
    return [{k: row[k] for k in SILVER_SOURCE_COLUMNS} for row in rows]


# --- raw -------------------------------------------------------------------


def test_raw_keeps_the_source_names_and_the_stamped_observation():
    writer = RecordingWriter()

    raw_builder(observations(FakeListClient()), writer).run()

    [row] = rows_of(writer)
    assert row["CaseRef"] == "C000101"
    assert row["Owner/Title"] == "A. Khan"
    assert row["source_list_name"] == LIST_NAME
    assert row["source_item_id"] == "101"
    assert row["source_version"] == "3"
    assert len(row["source_observation_id"]) == 64
    # The identity columns say what Id/Modified/etag said, so raw does not also
    # carry them -- nor when we happened to look.
    assert not {"Id", "Modified", "odata.etag", "observed_at"} & set(row)


def test_raw_stores_a_multi_value_cell_as_json_text():
    writer = RecordingWriter()

    raw_builder(observations(FakeListClient()), writer).run()

    [row] = rows_of(writer)
    assert row["PartiesId"] == "[17,23]"
    assert row["Parties/Title"] == '["A. Khan","B. Okafor"]'


def test_raw_reads_a_quiet_window_as_the_declared_shape():
    # The client adds Owner/Title and Parties/Title by expanding a lookup, so an
    # empty response cannot carry them; the read still has to present the
    # columns the raw gate checks.
    writer = RecordingWriter()

    raw_builder(observations(FakeListClient(pd.DataFrame())), writer).run()

    assert rows_of(writer) == []
    assert "Owner/Title" in writer.writes[0].to_pandas().columns


def test_raw_gates_the_columns_it_stores():
    writer = RecordingWriter()
    reader = given_rows([{"CaseRef": "C000101"}])

    with pytest.raises(ValidationError, match="missing required column.*Status"):
        raw_builder(reader, writer).run()

    assert writer.writes == []


# --- silver ----------------------------------------------------------------


def test_silver_renames_coerces_and_keeps_the_provenance():
    raw = RecordingWriter()
    raw_builder(observations(FakeListClient()), raw).run()
    writer = RecordingWriter()

    silver_builder(given_rows(landed(rows_of(raw))), writer).run()

    [row] = rows_of(writer)
    assert row["case_ref"] == "C000101"
    assert row["owner_user_id"] == 17
    assert row["owner_display_name"] == "A. Khan"
    assert row["opened_on"] == pd.Timestamp("2026-07-01T00:00:00Z")
    assert row["source_item_id"] == "101"
    assert row["source_version"] == "3"


def test_silver_quarantines_a_bad_risk_score_while_raw_keeps_every_row():
    raw = RecordingWriter()
    raw_builder(
        observations(
            FakeListClient(items(item(), item(item_id=102, etag="1", risk_score=250)))
        ),
        raw,
    ).run()
    writer, rejects = RecordingWriter(), RecordingWriter()

    silver_builder(given_rows(landed(rows_of(raw))), writer, rejects).run()

    assert len(rows_of(raw)) == 2
    assert [row["source_item_id"] for row in rows_of(writer)] == ["101"]
    [rejected] = rows_of(rejects)
    assert rejected["source_item_id"] == "102"
    assert "value not in [0, 100]" in rejected["failed_rule"]


# --- the party bridge ------------------------------------------------------


def test_a_multi_value_cell_fans_out_to_the_bridge_at_its_own_grain():
    raw = RecordingWriter()
    raw_builder(observations(FakeListClient()), raw).run()
    writer = RecordingWriter()

    party_builder(given_rows(rows_of(raw)), writer).run()

    assert [
        (row["party_user_id"], row["party_display_name"], row["party_position"])
        for row in rows_of(writer)
    ] == [(17, "A. Khan", 0), (23, "B. Okafor", 1)]
    assert {row["source_item_id"] for row in rows_of(writer)} == {"101"}


def test_an_empty_parties_cell_yields_no_bridge_rows():
    raw = RecordingWriter()
    raw_builder(
        observations(FakeListClient(items(item(party_ids=[], party_titles=[])))), raw
    ).run()
    writer = RecordingWriter()

    party_builder(given_rows(rows_of(raw)), writer).run()

    assert rows_of(writer) == []


def test_ids_and_titles_that_do_not_pair_positionally_are_refused():
    raw = RecordingWriter()
    raw_builder(
        observations(FakeListClient(items(item(party_titles=["A. Khan"])))), raw
    ).run()

    with pytest.raises(Exception, match="item 101.*2 value.*1"):
        party_builder(given_rows(rows_of(raw)), RecordingWriter()).run()


def test_a_person_named_twice_in_one_cell_is_two_bridge_rows(tmp_path):
    # Keyed on the position, not the person: a legally duplicated party must not
    # read as an append-only contradiction when the observation is re-read.
    client = FakeListClient(
        items(item(party_ids=[17, 17], party_titles=["A. Khan", "A. Khan"]))
    )
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)

    run(context, client=client)
    result = run(context, client=client)

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    parties = read_rows(med.silver, "case_party_version")
    assert [row["party_position"] for row in parties] == [0, 1]
    assert result.party_rows == 2


# --- the composed plan -----------------------------------------------------


def test_all_three_hops_plan_exactly_the_steps_they_always_have():
    reader, writer, rejects = given_rows([]), RecordingWriter(), RecordingWriter()

    assert raw_builder(reader, writer).describe().splitlines() == [
        "Pipeline: sharepoint_cases:raw",
        "  [Read] read",
        "  [Validate] columns (depends on: read)",
        "  [Write] write (depends on: columns)",
    ]
    assert silver_builder(reader, writer, rejects).describe().splitlines() == [
        "Pipeline: sharepoint_cases:silver",
        "  [Read] read",
        "  [Transform] rename (depends on: read)",
        "  [Transform] coerce (depends on: rename)",
        "  [Quarantine] quarantine (depends on: coerce)",
        "  [Validate] post-validate (depends on: quarantine)",
        "  [Write] write (depends on: post-validate)",
    ]
    assert party_builder(reader, writer).describe().splitlines() == [
        "Pipeline: sharepoint_cases:parties",
        "  [Read] read",
        "  [Transform] explode (depends on: read)",
        "  [Transform] coerce (depends on: explode)",
        "  [Validate] post-validate (depends on: coerce)",
        "  [Write] write (depends on: post-validate)",
    ]


# --- end to end ------------------------------------------------------------


def test_the_bundled_sample_lands_every_item_across_both_pages(tmp_path):
    result = run(
        RunContext(base_dir=tmp_path, pipeline=FEED_NAME), client=LocalJsonListClient()
    )

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    assert [row["CaseRef"] for row in read_rows(med.raw, "case_observation")] == [
        "C000101",
        "C000102",
        "C000103",
        "C000104",
        "C000105",
    ]
    assert result.raw_rows == 5
    assert result.silver_rows == 5
    # 2 + 1 + 0 + 1 + 2 parties across the five items.
    assert result.party_rows == 6
    assert len(read_rows(med.silver, "case_party_version")) == 6


def test_a_repeated_observation_is_a_no_op_in_raw_and_silver(tmp_path):
    client = FakeListClient()
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)

    run(context, client=client)
    run(context, client=client)

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    assert len(read_rows(med.raw, "case_observation")) == 1
    assert len(read_rows(med.silver, "case_version")) == 1


def test_a_later_source_version_appends_a_second_case_version(tmp_path):
    client = FakeListClient(
        items(item()),
        items(item(modified="2026-08-05T08:45:00Z", etag="4", status="Closed")),
    )
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)

    run(context, client=client)
    run(context, client=client)

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    assert [
        (row["status"], row["source_version"])
        for row in read_rows(med.silver, "case_version")
    ] == [("Open", "3"), ("Closed", "4")]


def test_the_same_observation_carrying_a_different_payload_is_refused(tmp_path):
    # Same Id and same etag, so the same observation id -- but the row moved.
    client = FakeListClient(items(item()), items(item(status="Closed")))
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)

    run(context, client=client)

    with pytest.raises(AppendOnlyConflictError, match="already present with different"):
        run(context, client=client)


def test_a_quiet_window_writes_cleanly_and_a_later_one_still_appends(tmp_path):
    # The common steady-state poll: nothing changed in the window.
    client = FakeListClient(pd.DataFrame(), items(item()))
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)

    quiet = run(context, client=client)
    busy = run(context, client=client)

    med = medallion(StoreRegistry(tmp_path), FEED_NAME)
    assert (quiet.raw_rows, quiet.silver_rows, quiet.party_rows) == (0, 0, 0)
    assert (busy.raw_rows, busy.silver_rows, busy.party_rows) == (1, 1, 2)
    assert len(read_rows(med.raw, "case_observation")) == 1
    assert len(read_rows(med.silver, "case_version")) == 1


def test_nothing_safe_to_poll_returns_none_and_writes_nothing(tmp_path):
    SharePointCheckpointStore(tmp_path).commit(
        SOURCE,
        window_end=SERVER_NOW,
        ingestion_batch_id="earlier",
        pipeline_run_id="earlier-run",
    )

    assert (
        run(RunContext(base_dir=tmp_path, pipeline=FEED_NAME), client=FakeListClient())
        is None
    )
    assert not (tmp_path / FEED_NAME).exists()


def test_the_result_carries_the_candidate_end_but_commits_no_checkpoint(tmp_path):
    result = run(
        RunContext(base_dir=tmp_path, pipeline=FEED_NAME), client=FakeListClient()
    )

    assert result.window.end == SERVER_NOW - SAFETY_LAG
    assert result.ingestion_batch_id == f"{LIST_ID}:first-load"
    checkpoints = SharePointCheckpointStore(tmp_path)
    assert checkpoints.committed_watermark(SOURCE) is None
    assert not checkpoints.path.exists()


def test_the_run_log_identifies_the_list_and_the_three_tables(tmp_path):
    log_path = tmp_path / "runs.log"
    context = RunContext(
        base_dir=tmp_path, pipeline=FEED_NAME, run_log=RunLog(log_path)
    )

    run(context, client=FakeListClient())

    located = [
        location
        for record in read_run_log(log_path)
        for location in record["data_locations"]
    ]
    assert {"namespace": SITE, "name": LIST_NAME} in located
    assert {location["name"] for location in located} == {
        LIST_NAME,
        "case_observation",
        "case_version",
        "case_party_version",
    }
    assert not any("@" in location["namespace"] for location in located)


def test_the_sample_client_replays_both_pages_as_one_first_load():
    frame = LocalJsonListClient().fetch_items(LIST_NAME, (), (), ())

    assert list(frame["Id"]) == [101, 102, 103, 104, 105]
    assert json.loads(json.dumps(list(frame["PartiesId"])[0])) == [17, 23]
