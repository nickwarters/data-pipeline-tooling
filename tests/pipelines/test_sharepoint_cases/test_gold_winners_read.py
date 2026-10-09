"""Gold reads a Detail Table's *winning* rows, not its history -- and lands the
same rows the whole-table read would have.

``publish_gold`` used to read each silver Detail Table whole, hash every
historical row, and let the semi-join to ``case_current`` throw the losers away.
It now reads only the rows of the winning observations. Nothing about gold may
change, so the oracle here is the old path itself: the same silver, reduced by
``to_gold_detail`` over a whole-table ``Store.reader``, into a second gold.
"""

from __future__ import annotations

import json

import pytest

from framework.io import DatasetReader, Refresh
from framework.run import RunContext, active_context
from pipelines.sharepoint_cases.gold import (
    DETAIL_GRAIN,
    DETAIL_TABLES,
    publish_gold,
    to_gold_detail,
)
from pipelines.sharepoint_cases.pipeline import FEED_NAME
from tests._sharepoint_cases_fixtures import (
    AS_OF,
    NEXT_POLL,
    FakeListClient,
    item,
    items,
    run,
)
from tests.framework_testing import (
    RecordingRunLog,
    build_databases,
    read_rows,
    without_columns,
)
from tools.medallion import medallion
from tools.store import StoreRegistry

# Two versions of one Case sharing a Modified to the second: the version breaks
# the tie, and the loser still has Detail rows.
TIED = "2026-08-05T08:10:00Z"


def _etag(version: int) -> dict[str, str]:
    return {"odata.etag": f'"{version}"'}


def _detail_blobs(tag: str, *, messages: int) -> dict[str, str]:
    """Every Detail Table's blob for one observation, distinguishable by ``tag``."""
    return {
        "Answers": json.dumps(
            {
                f"q-{tag}": {
                    "value": tag,
                    "remediationRequired": "yes",
                    "remediationActions": [{"id": f"ra-{tag}", "text": tag}],
                    "capture": {f"field-{tag}": tag},
                },
                "general:note": {"value": tag},
            }
        ),
        "Conversation": json.dumps(
            [
                {
                    "author": {"loginName": "a.khan", "displayName": "Amira Khan"},
                    "timestamp": "2026-08-04T16:02:00Z",
                    "body": f"{tag} {n}",
                }
                for n in range(messages)
            ]
        ),
        "Appeals": json.dumps(
            [
                {
                    "id": f"appeal-{tag}",
                    "appellant": "e.novak",
                    "at": "2026-08-04T09:00:00Z",
                    "rationale": tag,
                    "state": "raised",
                }
            ]
        ),
        "Details": json.dumps({f"field-{tag}": tag, "shared": "x"}),
    }


@pytest.fixture
def several_versions(base_dir):
    """Three Cases whose silver holds 2 + 2 + 3 + ... observations, polled in turn.

    101 is observed three times, each with its own Detail rows; 102 twice at
    the *same* ``Modified`` (a tie the version breaks); 103 once.
    """
    polls = [
        items(
            item(Id=101, **_etag(3), **_detail_blobs("a", messages=1)),
            item(Id=102, Modified=TIED, **_etag(3), **_detail_blobs("t3", messages=1)),
            item(Id=103, **_etag(3), **_detail_blobs("c", messages=2)),
        ),
        items(
            item(
                Id=101,
                Modified="2026-08-05T08:30:00Z",
                **_etag(4),
                **_detail_blobs("b", messages=2),
            ),
            item(Id=102, Modified=TIED, **_etag(4), **_detail_blobs("t4", messages=3)),
        ),
        items(
            item(
                Id=101,
                Modified="2026-08-05T08:50:00Z",
                Status="Completed",
                **_etag(5),
                **_detail_blobs("z", messages=3),
            ),
        ),
    ]
    client = FakeListClient(*polls, advance=NEXT_POLL)
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)
    for _ in polls:
        run(context, client=client)
    return medallion(StoreRegistry(base_dir), FEED_NAME)


def _winning_ids(med) -> set[str]:
    return {row["source_observation_id"] for row in read_rows(med.gold, "case_current")}


def test_the_seeded_history_holds_losing_observations_with_detail_rows(
    several_versions,
):
    # The premise: without losing rows in every Detail Table there is nothing
    # for a narrowed read to leave out, and the tests below would pass vacuously.
    med = several_versions
    winners = _winning_ids(med)
    assert len(winners) == 3
    for table in DETAIL_TABLES:
        observed = {
            row["source_observation_id"] for row in read_rows(med.silver, table)
        }
        assert observed > winners, table


def test_the_same_version_tie_resolves_to_the_higher_version(several_versions):
    # The tie is part of the fixture's point: the losing 102 observation has
    # Detail rows, and gold must keep the other's.
    med = several_versions
    winner = next(
        row
        for row in read_rows(med.gold, "case_current")
        if row["source_item_id"] == "102"
    )
    assert winner["source_version"] == '"4"'


def test_gold_detail_equals_what_the_whole_table_read_produced(
    several_versions, base_dir, tmp_path
):
    med = several_versions
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)
    with active_context(context):
        publish_gold(med, as_of=AS_OF)

    # The old path: the same silver read whole, reduced against the same
    # winners, landed into a second gold.
    old_dir = build_databases(tmp_path / "old", FEED_NAME)
    old = medallion(StoreRegistry(old_dir), FEED_NAME)
    winners = DatasetReader(med.gold.reader("case_current").read())
    with active_context(RunContext(base_dir=old_dir, pipeline=FEED_NAME)):
        for table in DETAIL_TABLES:
            to_gold_detail(
                med.silver.reader(table),
                old.gold.writer(table, Refresh()),
                grain=DETAIL_GRAIN[table],
                observations=winners,
                as_of=AS_OF,
                name=f"old:{table}",
            )

    # Row for row and in order; only the run id, which is per run, differs.
    for table in DETAIL_TABLES:
        landed = without_columns(read_rows(med.gold, table), "pipeline_run_id")
        expected = without_columns(read_rows(old.gold, table), "pipeline_run_id")
        assert landed == expected, table
        assert landed, f"{table}: nothing was compared"


def test_the_detail_read_step_counts_only_the_winning_rows(several_versions, base_dir):
    med = several_versions
    run_log = RecordingRunLog()
    with active_context(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME, run_log=run_log)
    ):
        publish_gold(med, as_of=AS_OF)

    winners = _winning_ids(med)
    for table in DETAIL_TABLES:
        silver = read_rows(med.silver, table)
        winning = [row for row in silver if row["source_observation_id"] in winners]
        [read_step] = [
            record
            for record in run_log.records
            if record["step"] == f"gold:{table}:read"
        ]
        assert read_step["rows_out"] == len(winning), table
        assert len(winning) < len(silver), table
        # And the narrowing is the read's, not the semi-join's: the join keeps
        # every row it is given.
        [join_step] = [
            record
            for record in run_log.records
            if record["step"] == f"gold:{table}:latest-observation"
        ]
        assert join_step["rows_out"] == len(winning), table
