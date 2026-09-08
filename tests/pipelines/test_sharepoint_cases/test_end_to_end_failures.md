```python
"""What a failed poll leaves behind, and what the retry after it converges on.

One rule under all of these: the watermark is committed **last**, so a run that
aborts anywhere leaves it where it was and the next run re-polls the same
window. Silver's append-only writes no-op on the re-read and gold rebuilds
whole, so the two paths converge on the same state.
"""

from __future__ import annotations

import json

import pytest

from framework.run import RunContext
from framework.transform import JsonShapeError
from pipelines.sharepoint_cases import gold
from pipelines.sharepoint_cases.gold import GOLD_TABLES
from pipelines.sharepoint_cases.pipeline import FEED_NAME, SAFETY_LAG
from tests._sharepoint_cases_fixtures import (
    NEXT_POLL,
    SERVER_NOW,
    SOURCE,
    FakeListClient,
    appeal,
    item,
    items,
    published_gold,
    quarantine_rows,
    run,
)
from tests.framework_testing import RecordingRunLog, read_rows
from tools.integrations.sharepoint_checkpoint import SharePointCheckpointStore
from tools.medallion import medallion
from tools.store import StoreRegistry


def explode(*args: object, **kwargs: object):
    raise RuntimeError("boom")


# --- a blob the feed cannot parse --------------------------------------------


def test_a_malformed_answers_blob_raises_and_case_version_still_lands(base_dir):
    run_log = RecordingRunLog()
    client = FakeListClient(items(item(Answers="not json")))
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME, run_log=run_log)

    with pytest.raises(JsonShapeError):
        run(context, client=client)

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert len(read_rows(med.silver, "case_version")) == 1
    assert published_gold(run_log) == set()
    assert SharePointCheckpointStore(base_dir).committed_watermark(SOURCE) is None


def test_a_malformed_details_blob_raises_and_case_version_details_still_holds_it(
    base_dir,
):
    run_log = RecordingRunLog()
    client = FakeListClient(items(item(Details="not json")))
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME, run_log=run_log)

    with pytest.raises(JsonShapeError):
        run(context, client=client)

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert published_gold(run_log) == set()
    assert SharePointCheckpointStore(base_dir).committed_watermark(SOURCE) is None
    # The frontend's Details parse fallback is undefined, so absent and
    # unparseable are indistinguishable downstream -- silver is the only place
    # the raw text survives.
    [case_version] = read_rows(med.silver, "case_version")
    assert case_version["details"] == "not json"


# --- a gold build that blows up ----------------------------------------------


def test_a_failure_in_current_gold_leaves_no_gold_and_no_checkpoint(
    base_dir, monkeypatch
):
    run_log = RecordingRunLog()
    monkeypatch.setattr(gold, "to_gold_case_current", explode)

    with pytest.raises(RuntimeError, match="boom"):
        run(
            RunContext(base_dir=base_dir, pipeline=FEED_NAME, run_log=run_log),
            client=FakeListClient(),
        )

    checkpoints = SharePointCheckpointStore(base_dir)
    assert published_gold(run_log) == set()
    assert checkpoints.committed_watermark(SOURCE) is None
    assert not checkpoints.path.exists()


def test_a_failure_in_the_last_aggregate_leaves_the_earlier_gold_and_no_checkpoint(
    base_dir, monkeypatch
):
    # Gold Writers commit independently, so an earlier table stays refreshed.
    # That is acceptable evidence: the watermark did not move, so the next run
    # rebuilds everything from the same history and converges.
    run_log = RecordingRunLog()
    failed_table = GOLD_TABLES[-1]
    assert failed_table == "appeal_outcomes_current", "the reduce patched below"
    monkeypatch.setattr(gold, "appeal_outcomes", explode)

    with pytest.raises(RuntimeError, match="boom"):
        run(
            RunContext(base_dir=base_dir, pipeline=FEED_NAME, run_log=run_log),
            client=FakeListClient(),
        )

    checkpoints = SharePointCheckpointStore(base_dir)
    # Everything before the failure was published; the failed table was not.
    assert published_gold(run_log) == set(GOLD_TABLES) - {failed_table}
    assert checkpoints.committed_watermark(SOURCE) is None
    assert not checkpoints.path.exists()


def test_a_retry_after_a_partial_failure_converges_and_advances_once(
    base_dir, monkeypatch
):
    run_log = RecordingRunLog()
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME, run_log=run_log)
    client = FakeListClient(advance=NEXT_POLL)
    checkpoints = SharePointCheckpointStore(base_dir)
    monkeypatch.setattr(gold, "throughput", explode)

    with pytest.raises(RuntimeError, match="boom"):
        run(context, client=client)
    assert checkpoints.committed_watermark(SOURCE) is None

    monkeypatch.undo()
    run(context, client=client)

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    assert published_gold(run_log) == set(GOLD_TABLES)
    assert len(read_rows(med.gold, "case_current")) == 1
    # The first attempt left the watermark alone, so exactly one advance has
    # happened: to the *retry's* candidate end.
    assert checkpoints.committed_watermark(SOURCE) == (
        SERVER_NOW + NEXT_POLL - SAFETY_LAG
    )


# --- a value rule breached in a Detail Table ---------------------------------


def test_a_quarantined_detail_row_is_routed_aside_rather_than_aborting_the_poll(
    base_dir,
):
    # Every Detail Table step is handed a quarantine Writer, and this subject is
    # under migration control -- so a reject table the migrations forgot is not
    # a gap in the reject history but a `MissingTableError` that aborts the
    # whole poll, at `answer`, before `answer_action` and the four tables after
    # it are ever written. The unit tests prove each partitioner against a
    # RecordingWriter, which is exactly the seam that cannot see it: only a real
    # store can say whether the row has somewhere to land.
    answers = json.dumps(
        {
            "q-bad": {"value": "A", "remediationStatus": {"status": "resolved"}},
            "q-good": {
                "value": "B",
                "remediationRequired": "yes",
                "remediationActions": [{"id": "q-good-ra-0", "text": "Retrain."}],
            },
        }
    )
    appeals = json.dumps([appeal(id="appeal-1"), appeal(id="appeal-2", state="lapsed")])
    client = FakeListClient(items(item(Answers=answers, Appeals=appeals)))

    [poll] = run(RunContext(base_dir=base_dir, pipeline=FEED_NAME), client=client)

    # The breach is routed aside and the poll publishes: the good answer, the
    # good appeal and -- the table furthest downstream of the first breach --
    # the action land at silver and gold.
    assert poll.detail_rows["answer_action"] == 1
    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    for layer in (med.silver, med.gold):
        assert {row["question_id"] for row in read_rows(layer, "answer")} == {"q-good"}
        assert {row["action_id"] for row in read_rows(layer, "answer_action")} == {
            "q-good-ra-0"
        }
        assert {row["appeal_id"] for row in read_rows(layer, "appeal")} == {"appeal-1"}

    # Only the two breached tables have rejects, and each names the rule.
    quarantined = quarantine_rows(base_dir)
    assert set(quarantined) == {"answer", "appeal"}
    [bad_answer] = quarantined["answer"]
    assert bad_answer["question_id"] == "q-bad"
    assert "remediation_status" in bad_answer["failed_rule"]
    [bad_appeal] = quarantined["appeal"]
    assert bad_appeal["appeal_id"] == "appeal-2"
    assert "state" in bad_appeal["failed_rule"]

```
