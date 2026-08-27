"""One real poll, end to end under ``tmp_path``: what lands in raw and silver,
what a quiet window does, and what an operator sees.

Only the behaviours that *are* the store -- append-only idempotence, a
conflicting re-observation, a quiet window creating typed columns -- need a
real database, so those live here rather than behind a ``RecordingWriter``.
"""

from __future__ import annotations

import pandas as pd
import pytest

from framework.core import ErrorCategory
from framework.io import AppendOnlyConflictError
from framework.run import RunContext, RunLog, dry_run_pipeline
from pipelines.sharepoint_cases.gold import GOLD_TABLES
from pipelines.sharepoint_cases.pipeline import (
    FEED_NAME,
    SAFETY_LAG,
    LocalJsonListClient,
    NoClientError,
    main,
)
from pipelines.sharepoint_cases.schema import CASE_STATUSES
from tests._sharepoint_cases_fixtures import (
    COMPLAINTS,
    NEXT_POLL,
    OTHER,
    SERVER_NOW,
    SOURCE,
    FakeListClient,
    item,
    items,
    later_item,
    nothing_landed,
    run,
)
from tests.framework_testing import read_rows, read_run_log
from tools.integrations.sharepoint_checkpoint import SharePointCheckpointStore
from tools.integrations.sharepoint_rest import SharePointFeedError
from tools.medallion import medallion
from tools.store import StoreRegistry

# Every pipeline one poll of one list runs, in the run log's vocabulary.
# The name prefix each step of the feed carries. There is no separate grouping
# field any more: a step names the table it is building, and the record's
# ``pipeline`` stays the run's own label throughout.
EVERY_STEP_PREFIX = {
    f"raw:{COMPLAINTS.case_type}",
    f"silver:{COMPLAINTS.case_type}",
    f"silver:{COMPLAINTS.case_type}:answer",
    f"silver:{COMPLAINTS.case_type}:answer_capture",
    f"silver:{COMPLAINTS.case_type}:answer_action",
    f"silver:{COMPLAINTS.case_type}:general_answer",
    f"silver:{COMPLAINTS.case_type}:conversation_message",
    f"silver:{COMPLAINTS.case_type}:appeal",
    f"silver:{COMPLAINTS.case_type}:case_detail",
    *(f"gold:{table}" for table in GOLD_TABLES),
}


def test_the_bundled_sample_lands_every_item_across_both_pages(base_dir, capsys):
    [poll] = run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME), client=LocalJsonListClient()
    )

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    landed_raw = read_rows(med.raw, "case_observation")
    assert [row["source_item_id"] for row in landed_raw] == [
        "101",
        "102",
        "103",
        "104",
        "105",
    ]
    # One fixture Case carries no Case Reference at all, which is ordinary.
    assert [row["Title"] for row in landed_raw][:2] == ["CMP-000101", "CMP-000102"]
    assert pd.isna(landed_raw[2]["Title"])
    # Counts below are derived from cases_page_1.json / cases_page_2.json's
    # per-item content -- see those fixtures for the breakdown. Both Conversation
    # and Appeals timestamps there deliberately mix formats.
    assert (poll.raw_rows, poll.silver_rows) == (5, 5)
    assert poll.detail_rows == {
        "answer": 6,
        "answer_capture": 2,
        "answer_action": 1,
        "general_answer": 1,
        "conversation_message": 3,
        "appeal": 2,
        "case_detail": 13,
    }
    # The fixture exercises every real status, so the whole vocabulary passes
    # the schema gate rather than only the one a happy path would use.
    assert {row["status"] for row in read_rows(med.silver, "case_version")} == set(
        CASE_STATUSES
    )
    # A single poll, so every Case's only observation is its winning one.
    assert sum(
        row["answer_count"] for row in read_rows(med.gold, "answer_remediation_current")
    ) == len(read_rows(med.gold, "answer"))
    assert sum(
        row["appeal_count"] for row in read_rows(med.gold, "appeal_outcomes_current")
    ) == len(read_rows(med.gold, "appeal"))

    # main()'s per-poll line is derived from detail_rows and otherwise
    # unpinned; exercise the CLI path once, against a separate base dir, to
    # lock its shape down.
    exit_code = main(["prog", "--base-dir", str(base_dir / "via-cli"), "--sample"])
    assert exit_code == 0
    assert (
        "5 observation(s) -> 5 case version(s), 6 answer row(s), "
        "2 answer_capture row(s), 1 answer_action row(s), "
        "1 general_answer row(s), 3 conversation_message row(s), "
        "2 appeal row(s), 13 case_detail row(s)."
    ) in capsys.readouterr().out


def test_a_repeated_observation_is_a_no_op_in_raw_and_silver(base_dir):
    client = FakeListClient(advance=NEXT_POLL)
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)

    run(context, client=client)
    run(context, client=client)

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert len(read_rows(med.raw, "case_observation")) == 1
    assert len(read_rows(med.silver, "case_version")) == 1


def test_a_later_source_version_appends_a_second_case_version(base_dir):
    client = FakeListClient(
        items(item()), items(later_item(Status="Completed")), advance=NEXT_POLL
    )
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)

    run(context, client=client)
    run(context, client=client)

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert [
        (row["status"], row["source_version"])
        for row in read_rows(med.silver, "case_version")
    ] == [("In-progress", '"3"'), ("Completed", '"4"')]


def test_the_same_observation_carrying_a_different_payload_is_refused(base_dir):
    # Same Id and same etag, so the same observation id -- but the row moved.
    client = FakeListClient(
        items(item()), items(item(Status="Completed")), advance=NEXT_POLL
    )
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)

    run(context, client=client)

    with pytest.raises(AppendOnlyConflictError, match="already present with different"):
        run(context, client=client)


def test_a_quiet_window_writes_cleanly_and_a_later_one_still_appends(base_dir):
    # The common steady-state poll: nothing changed in the window.
    client = FakeListClient(pd.DataFrame(), items(item()), advance=NEXT_POLL)
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)

    [quiet] = run(context, client=client)
    [busy] = run(context, client=client)

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert (quiet.raw_rows, quiet.silver_rows) == (0, 0)
    assert (busy.raw_rows, busy.silver_rows) == (1, 1)
    assert len(read_rows(med.raw, "case_observation")) == 1
    assert len(read_rows(med.silver, "case_version")) == 1


def test_a_quiet_first_window_still_types_the_columns_it_creates(base_dir):
    # The steady-state poll is a quiet one, so a feed's *first* run is quite
    # likely to be empty -- and an empty write is what creates the silver table,
    # fixing each column's SQLite affinity for the life of the feed. A zero-row
    # frame carrying object columns would create `id` as TEXT and store every
    # later integer id as text, silently, for as long as nobody compared types.
    # So the id a quiet-first feed lands must be the id a busy-first one lands.
    quiet_first = FakeListClient(pd.DataFrame(), items(item()), advance=NEXT_POLL)
    busy_first = FakeListClient(items(item()), pd.DataFrame(), advance=NEXT_POLL)

    landed_ids = []
    for order, client in (("quiet", quiet_first), ("busy", busy_first)):
        base = base_dir / order
        context = RunContext(base_dir=base, pipeline=FEED_NAME)
        run(context, client=client)
        run(context, client=client)
        med = medallion(StoreRegistry(base), FEED_NAME)
        landed_ids.append(read_rows(med.silver, "case_version")[0]["id"])

    assert landed_ids[0] == landed_ids[1]
    assert isinstance(landed_ids[0], int)


def test_a_quiet_window_still_runs_and_records_every_step(base_dir):
    # A quiet poll is not a different pipeline: an operator reading the run log
    # still sees every step, against every table, with zero rows -- and the same
    # data locations a busy one names, since the wiring declares those, not the
    # row count.
    log_path = base_dir / "runs.log"
    context = RunContext(
        base_dir=base_dir, pipeline=FEED_NAME, run_log=RunLog(log_path)
    )

    run(context, client=FakeListClient(pd.DataFrame()))

    records = read_run_log(log_path)
    assert {record["step"].rsplit(":", 1)[0] for record in records} == EVERY_STEP_PREFIX
    # One label for the whole poll: the grouping is in the step name, not in a
    # second identity the run also records under.
    assert {record["pipeline"] for record in records} == {FEED_NAME}
    locations = [
        location for record in records for location in record["data_locations"]
    ]
    # The list is named by its site, which is the only location not a database.
    assert {"namespace": COMPLAINTS.site, "name": COMPLAINTS.list_name} in locations
    assert {location["name"] for location in locations} == {
        COMPLAINTS.list_name,
        "case_observation",
        "case_version",
        *GOLD_TABLES,
    }
    # "answer" is a table in both silver.db (the exploded rows) and gold.db
    # (the Detail Table's reduction) -- the same name, two different bases.
    answer_namespaces = {
        location["namespace"] for location in locations if location["name"] == "answer"
    }
    assert any(ns.endswith("silver.db") for ns in answer_namespaces)
    assert any(ns.endswith("gold.db") for ns in answer_namespaces)
    assert {record["rows_out"] for record in records} == {0}

    # Gold publishes in GOLD_TABLES's declared order.
    gold_names = [
        record["step"].rsplit(":", 1)[0]
        for record in records
        if record["step"].startswith("gold:")
    ]
    assert list(dict.fromkeys(gold_names)) == [f"gold:{table}" for table in GOLD_TABLES]


def test_nothing_safe_to_poll_returns_nothing_and_writes_nothing(base_dir):
    SharePointCheckpointStore(base_dir).commit(
        SOURCE,
        window_end=SERVER_NOW,
        ingestion_batch_id="earlier",
        pipeline_run_id="earlier-run",
    )

    assert (
        run(RunContext(base_dir=base_dir, pipeline=FEED_NAME), client=FakeListClient())
        == []
    )
    assert nothing_landed(base_dir)


def test_running_with_no_client_refuses_as_an_operator_failure(base_dir, capsys):
    # The documented default invocation without --sample. Forgetting the client
    # is an operator's mistake, and the message names the fix, so it is worth
    # more to print it than a stack trace.
    exit_code = main(["prog", "--base-dir", str(base_dir)])

    assert exit_code == 1
    assert "--sample" in capsys.readouterr().err
    assert nothing_landed(base_dir)


def test_run_with_no_client_refuses_as_a_wiring_failure(base_dir):
    # How the operator CLI and the orchestrator both reach a feed: run(context),
    # with no way to pass a client. That must abort as a caught, categorised
    # failure rather than as a stack trace the operator has to read.
    with pytest.raises(NoClientError) as refused:
        run(RunContext(base_dir=base_dir, pipeline=FEED_NAME))

    assert refused.value.category == ErrorCategory.CONFIG
    assert nothing_landed(base_dir)


def test_the_sample_client_replays_both_pages_as_one_first_load():
    frame = LocalJsonListClient().fetch_items(COMPLAINTS.list_name, (), (), ())

    assert list(frame["Id"]) == [101, 102, 103, 104, 105]


def test_the_sample_client_names_a_list_it_has_no_pages_for():
    with pytest.raises(SharePointFeedError, match="Cases-Other"):
        LocalJsonListClient().fetch_items(OTHER.list_name, (), (), ())


# --- the dry run -------------------------------------------------------------


def test_a_dry_run_on_a_fresh_base_dir_writes_no_gold_and_commits_nothing(base_dir):
    # The silver write is previewed rather than performed, so there is no table
    # for gold to reduce. Previewing no gold steps is the honest answer.
    report = dry_run_pipeline(
        lambda ctx: run(ctx, client=FakeListClient()), FEED_NAME, base_dir
    )

    assert not report.failed
    assert nothing_landed(base_dir)
    assert not SharePointCheckpointStore(base_dir).path.exists()


def test_a_dry_run_previews_every_write_and_commits_none_of_them(base_dir):
    client = FakeListClient(advance=NEXT_POLL)
    run(RunContext(base_dir=base_dir, pipeline=FEED_NAME), client=client)
    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    before = read_rows(med.gold, "case_current")

    report = dry_run_pipeline(lambda ctx: run(ctx, client=client), FEED_NAME, base_dir)

    # The fixture item carries no capture map, remediationActions, general
    # answer, Conversation, Appeals or Details, so these six preview empty.
    empty_detail_tables = (
        "answer_capture",
        "answer_action",
        "general_answer",
        "conversation_message",
        "appeal",
        "case_detail",
    )
    expected = [
        ("raw case_observation", 1),
        ("silver case_version", 1),
        ("silver answer", 1),
        *((f"silver {t}", 0) for t in empty_detail_tables),
        ("gold case_current", 1),
        ("gold answer", 1),
        *((f"gold {t}", 0) for t in empty_detail_tables),
        ("gold case_counts_current", 1),
        ("gold case_age_buckets_current", 1),
        ("gold case_age_from_assigned_buckets_current", 1),
        ("gold case_throughput_daily", 0),
        # The fixture's one answer row is undecided, so it lands under the
        # UNDECIDED/UNRESOLVED fills; no Appeals means the next row is empty.
        ("gold answer_remediation_current", 1),
        ("gold appeal_outcomes_current", 0),
    ]
    assert [step.note for step in report.steps if step.node_type == "Write"] == [
        f"would write {n} row(s)" for _, n in expected
    ]
    assert read_rows(med.gold, "case_current") == before
    # The real run's watermark stands; the preview did not move it on.
    assert SharePointCheckpointStore(base_dir).committed_watermark(SOURCE) == (
        SERVER_NOW - SAFETY_LAG
    )
