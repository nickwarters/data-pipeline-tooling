```python
"""The composed plan: the shape every step one poll takes, table by table.

The steps are eager, so what the feed *did* is what it recorded -- which is
both a stronger pin than reading a plan and the thing an operator actually
sees. Each step name is prefixed with the table it is building, so the records
group by that prefix.

What is held here is the *shape* of each table's sequence -- it reads first,
writes last, and the gates every table of a layer shares sit between them in
the order the layer promises -- not the name of every step in between. A step
renamed, or a reshaping step added, is the feed's business; a gate skipped or
reordered is not.
"""

from __future__ import annotations

import pytest

from framework.run import RunContext
from pipelines.sharepoint_cases.gold import (
    CURRENT_TABLE,
    DETAIL_AGGREGATES,
    DETAIL_TABLES,
    GOLD_TABLES,
)
from pipelines.sharepoint_cases.pipeline import FEED_NAME
from tests._sharepoint_cases_fixtures import COMPLAINTS, FakeListClient, run
from tests.framework_testing import RecordingRunLog

RAW = f"raw:{COMPLAINTS.case_type}"
SILVER = f"silver:{COMPLAINTS.case_type}"
SILVER_DETAIL = tuple(f"{SILVER}:{table}" for table in DETAIL_TABLES)
GOLD = tuple(f"gold:{table}" for table in GOLD_TABLES)
# The gold tables reduced on a declared grain -- the ones that validate it.
GOLD_KEYED = tuple(f"gold:{table}" for table in (CURRENT_TABLE, *DETAIL_TABLES))
GOLD_AGGREGATES = tuple(prefix for prefix in GOLD if prefix not in GOLD_KEYED)

# ``enforce``'s three steps, in the order it promises: coerce first, so the
# rules judge typed values; quarantine next, so a breach is routed aside rather
# than aborting; validate last, over what survived.
ENFORCE = ("coerce", "quarantine", "schema_validator")


@pytest.fixture
def recorded(base_dir) -> RecordingRunLog:
    """One real poll, with every step it took captured."""
    run_log = RecordingRunLog()
    run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME, run_log=run_log),
        client=FakeListClient(),
    )
    return run_log


def steps_of(run_log: RecordingRunLog, prefix: str) -> list[str]:
    """The steps recorded under one name prefix, in the order they were taken."""
    return [
        record["step"].rsplit(":", 1)[1]
        for record in run_log.records
        if record["step"].rsplit(":", 1)[0] == prefix
    ]


def assert_in_order(steps: list[str], *expected: str) -> None:
    """``expected`` all occur in ``steps``, once each, in this relative order."""
    positions = []
    for step in expected:
        assert steps.count(step) == 1, (step, steps)
        positions.append(steps.index(step))
    assert positions == sorted(positions), (expected, steps)


def test_every_table_reads_first_and_writes_last(recorded):
    for prefix in (RAW, SILVER, *SILVER_DETAIL, *GOLD):
        steps = steps_of(recorded, prefix)
        assert steps, prefix
        assert steps[0] == "read", (prefix, steps)
        assert steps[-1] == "write", (prefix, steps)
        assert steps.count("write") == 1, (prefix, steps)


def test_raw_lands_the_observation_without_a_gate(recorded):
    # No column gate on the source -> raw step, unlike a file feed: the
    # observation transform projects onto exactly the stored columns, so a
    # presence check below it could never fire -- and nothing is validated or
    # quarantined before a faithful landing.
    steps = steps_of(recorded, RAW)

    assert not set(steps) & {*ENFORCE, "unique-validate"}
    assert "observation" in steps


def test_every_silver_table_is_enforced_in_order_before_it_writes(recorded):
    # coerce / quarantine / schema_validator are ``enforce``'s three steps: it
    # is shorthand for the sequence, not a step of its own. Whether a table
    # spells them out (answer_capture drops raw_value between the quarantine
    # and the validate) or calls the shorthand, the order is the same promise.
    for prefix in (SILVER, *SILVER_DETAIL):
        steps = steps_of(recorded, prefix)
        assert_in_order(steps, "read", *ENFORCE, "write")


def test_silver_settles_the_case_type_before_it_is_enforced(recorded):
    # The declared Case Type replaces the cell before any rule reads it: gold
    # keys on it, so it must be the settled value that is validated.
    assert_in_order(steps_of(recorded, SILVER), "rename", "case-type", "coerce")


def test_every_silver_detail_table_explodes_before_it_is_enforced(recorded):
    # Each Detail Table is one blob fanned out then enforced -- however many
    # explode steps it takes to reach its grain.
    for prefix in SILVER_DETAIL:
        steps = steps_of(recorded, prefix)
        explodes = [i for i, step in enumerate(steps) if step.startswith("explode")]
        assert explodes, (prefix, steps)
        assert max(explodes) < steps.index("coerce"), (prefix, steps)


def test_every_gold_table_is_stamped_as_of_before_it_writes(recorded):
    for prefix in GOLD:
        assert_in_order(steps_of(recorded, prefix), "read", "stamp-as-of", "write")


def test_a_keyed_gold_table_validates_its_grain_last_and_an_aggregate_does_not(
    recorded,
):
    # Only the tables reduced on a declared grain carry a uniqueness gate, and
    # it is the last thing before the write, over the stamped rows.
    for prefix in GOLD_KEYED:
        steps = steps_of(recorded, prefix)
        assert steps[-2:] == ["unique-validate", "write"], (prefix, steps)
        assert_in_order(steps, "derive-key", "stamp-as-of", "unique-validate")
    for prefix in GOLD_AGGREGATES:
        steps = steps_of(recorded, prefix)
        assert "unique-validate" not in steps, (prefix, steps)
        # One reduction, then the stamp, then the write.
        assert len(steps) == 4, (prefix, steps)


def test_every_gold_table_reduces_to_one_observation_or_one_count(recorded):
    # The current table and every Detail Table settle on a *latest* something;
    # every aggregate is a count or a bucketing. Naming the family, not the
    # step, holds the reduction's intent without pinning its label.
    for prefix in GOLD_KEYED:
        assert any(step.startswith("latest-") for step in steps_of(recorded, prefix)), (
            prefix
        )
    for prefix in GOLD_AGGREGATES:
        [reduction] = steps_of(recorded, prefix)[1:2]
        assert reduction.startswith(("count-by-", "bucket-by-")), (prefix, reduction)


def test_the_detail_aggregates_are_named_to_a_published_detail_table():
    assert set(DETAIL_AGGREGATES.values()) <= set(DETAIL_TABLES)
    assert set(DETAIL_AGGREGATES) <= set(GOLD_TABLES)

```
