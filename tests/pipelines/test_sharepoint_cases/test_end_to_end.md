```python
"""One real poll, end to end under ``tmp_path``: what lands in raw and silver,
what a quiet window does, and what an operator sees.

Only the behaviours that *are* the store -- append-only idempotence, a
conflicting re-observation, a quiet window creating typed columns -- need a
real database, so those live here rather than behind a ``RecordingWriter``.
"""

from __future__ import annotations

import re

import pandas as pd
import pytest

from framework.core import ErrorCategory
from framework.io import AppendOnlyConflictError
from framework.run import RunContext, RunLog, dry_run_pipeline
from pipelines.sharepoint_cases.gold import (
    CURRENT_TABLE,
    DETAIL_AGGREGATES,
    DETAIL_TABLES,
    GOLD_TABLES,
)
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
RAW_PREFIX = f"raw:{COMPLAINTS.case_type}"
SILVER_PREFIX = f"silver:{COMPLAINTS.case_type}"
SILVER_DETAIL_PREFIX = {f"{SILVER_PREFIX}:{table}": table for table in DETAIL_TABLES}
GOLD_PREFIX = {f"gold:{table}": table for table in GOLD_TABLES}
EVERY_STEP_PREFIX = {RAW_PREFIX, SILVER_PREFIX, *SILVER_DETAIL_PREFIX, *GOLD_PREFIX}


def prefix_of(step: str) -> str:
    return step.rsplit(":", 1)[0]


def test_the_bundled_sample_lands_every_item_across_both_pages(base_dir, capsys):
    sample = LocalJsonListClient().fetch_items(COMPLAINTS.list_name, (), (), ())

    [poll] = run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME), client=LocalJsonListClient()
    )

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    landed_raw = read_rows(med.raw, "case_observation")
    assert [row["source_item_id"] for row in landed_raw] == [
        str(item_id) for item_id in sample["Id"]
    ]
    # Faithful to the fixture, including the one Case that carries no Case
    # Reference at all -- which is ordinary.
    assert [row["Title"] for row in landed_raw if not pd.isna(row["Title"])] == list(
        sample["Title"].dropna()
    )
    assert sample["Title"].isna().any()
    assert (poll.raw_rows, poll.silver_rows) == (len(sample), len(sample))
    # The fixture pages are written to populate every Detail Table (both
    # Conversation and Appeals timestamps there deliberately mix formats), and
    # what the poll reports for each is what landed in silver.
    assert set(poll.detail_rows) == set(DETAIL_TABLES)
    assert all(count > 0 for count in poll.detail_rows.values()), poll.detail_rows
    assert poll.detail_rows == {
        table: len(read_rows(med.silver, table)) for table in DETAIL_TABLES
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
    out = capsys.readouterr().out
    assert f"{poll.raw_rows} observation(s)" in out
    assert f"{poll.silver_rows} case version(s)" in out
    for table, count in poll.detail_rows.items():
        assert f"{count} {table} row(s)" in out, table


def test_a_repeated_observation_is_a_no_op_in_raw_and_silver(base_dir):
    client = FakeListClient(advance=NEXT_POLL)
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)

    run(context, client=client)
    run(context, client=client)

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert len(read_rows(med.raw, "case_observation")) == 1
    assert len(read_rows(med.silver, "case_version")) == 1


def test_a_later_source_version_appends_a_second_case_version(base_dir):
    first, second = item(), later_item(Status="Completed")
    client = FakeListClient(items(first), items(second), advance=NEXT_POLL)
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)

    run(context, client=client)
    run(context, client=client)

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert [
        (row["status"], row["source_version"])
        for row in read_rows(med.silver, "case_version")
    ] == [
        (first["Status"], first["odata.etag"]),
        (second["Status"], second["odata.etag"]),
    ]


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
    assert {prefix_of(record["step"]) for record in records} == EVERY_STEP_PREFIX
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

    # Gold publishes each table after the one it reads: the Detail Tables
    # semi-join to case_current, and each Detail aggregate counts a Detail
    # Table. That is the order that matters; the rest of GOLD_TABLES's order
    # is a convenience.
    first_write = {}
    for position, record in enumerate(records):
        if record["step"].startswith("gold:") and record["step"].endswith(":write"):
            first_write.setdefault(GOLD_PREFIX[prefix_of(record["step"])], position)
    assert set(first_write) == set(GOLD_TABLES)
    for table in DETAIL_TABLES:
        assert first_write[CURRENT_TABLE] < first_write[table], table
    for aggregate, detail_table in DETAIL_AGGREGATES.items():
        assert first_write[detail_table] < first_write[aggregate], aggregate


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

    # Every write one poll takes is previewed, once -- and since the preview
    # re-reads the same item over the same history, each table's previewed
    # count is what the real run already landed there.
    previewed = {
        prefix_of(step.name): int(re.search(r"would write (\d+) row", step.note)[1])
        for step in report.steps
        if step.node_type == "Write"
    }
    assert set(previewed) == EVERY_STEP_PREFIX
    assert sum(1 for step in report.steps if step.node_type == "Write") == len(
        EVERY_STEP_PREFIX
    )
    assert previewed[RAW_PREFIX] == len(read_rows(med.raw, "case_observation"))
    assert previewed[SILVER_PREFIX] == len(read_rows(med.silver, "case_version"))
    for prefix, table in SILVER_DETAIL_PREFIX.items():
        assert previewed[prefix] == len(read_rows(med.silver, table)), table
    for prefix, table in GOLD_PREFIX.items():
        assert previewed[prefix] == len(read_rows(med.gold, table)), table
    # ... and it previewed something: the fixture item is a Case with an answer.
    assert previewed[SILVER_PREFIX] == previewed[f"gold:{CURRENT_TABLE}"] == 1
    assert read_rows(med.gold, "case_current") == before
    # The real run's watermark stands; the preview did not move it on.
    assert SharePointCheckpointStore(base_dir).committed_watermark(SOURCE) == (
        SERVER_NOW - SAFETY_LAG
    )

```
