"""The composed plan: every step one poll takes, in the order it takes them.

The steps are eager, so what the feed *did* is what it recorded -- which is
both a stronger pin than reading a plan and the thing an operator actually
sees. Each step name is prefixed with the table it is building, so the records
group by that prefix.
"""

from __future__ import annotations

import pytest

from framework.run import RunContext
from pipelines.sharepoint_cases.gold import CURRENT_TABLE, DETAIL_TABLES
from pipelines.sharepoint_cases.pipeline import FEED_NAME
from tests._sharepoint_cases_fixtures import COMPLAINTS, FakeListClient, run
from tests.framework_testing import RecordingRunLog


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


def test_all_nine_ingest_steps_record_exactly_what_they_always_have(recorded):
    silver = f"silver:{COMPLAINTS.case_type}"

    # No column gate on the source -> raw step, unlike a file feed: the
    # observation transform projects onto exactly the stored columns, so a
    # presence check below it could never fire. Each step name carries the list
    # it polled, which is what keeps 134 records in one poll readable.
    assert steps_of(recorded, f"raw:{COMPLAINTS.case_type}") == [
        "read",
        "observation",
        "write",
    ]
    # coerce / quarantine / schema_validator are ``enforce``'s three steps: it
    # is shorthand for the sequence, not a step of its own, so the run log reads
    # exactly as it did when they were written out by hand.
    assert steps_of(recorded, silver) == [
        "read",
        "rename",
        "case-type",
        "coerce",
        "quarantine",
        "schema_validator",
        "write",
    ]
    assert steps_of(recorded, f"{silver}:answer") == [
        "read",
        "explode",
        "value-text",
        "coerce",
        "quarantine",
        "schema_validator",
        "write",
    ]
    # The one that cannot use ``enforce``: raw_value is dropped between the
    # quarantine and the validate, so the three are written out.
    assert steps_of(recorded, f"{silver}:answer_capture") == [
        "read",
        "explode-answers",
        "explode-capture",
        "discriminate",
        "coerce",
        "quarantine",
        "drop-raw-value",
        "schema_validator",
        "write",
    ]
    assert steps_of(recorded, f"{silver}:answer_action") == [
        "read",
        "explode-answers",
        "explode-actions",
        "coerce",
        "quarantine",
        "schema_validator",
        "write",
    ]
    assert steps_of(recorded, f"{silver}:general_answer") == [
        "read",
        "explode",
        "value-text",
        "coerce",
        "quarantine",
        "schema_validator",
        "write",
    ]
    assert steps_of(recorded, f"{silver}:conversation_message") == [
        "read",
        "explode",
        "coerce",
        "quarantine",
        "schema_validator",
        "write",
    ]
    assert steps_of(recorded, f"{silver}:appeal") == [
        "read",
        "explode",
        "coerce",
        "quarantine",
        "schema_validator",
        "write",
    ]
    assert steps_of(recorded, f"{silver}:case_detail") == [
        "read",
        "explode",
        "encode-value",
        "coerce",
        "quarantine",
        "schema_validator",
        "write",
    ]


def test_the_gold_tables_record_exactly_the_steps_they_always_have(recorded):
    # Only the current table carries a grain gate; see to_gold_case_current.
    assert steps_of(recorded, f"gold:{CURRENT_TABLE}") == [
        "read",
        "derive-key",
        "latest-version",
        "flatten-amended-outcome",
        "drop-blobs",
        "stamp-as-of",
        "unique-validate",
        "write",
    ]
    for table in DETAIL_TABLES:
        assert steps_of(recorded, f"gold:{table}") == [
            "read",
            "derive-key",
            "latest-observation",
            "stamp-as-of",
            "unique-validate",
            "write",
        ], table
    for table, step in (
        ("case_counts_current", "count-by-base-grain-and-status"),
        ("case_age_buckets_current", "bucket-by-age"),
        ("case_age_from_assigned_buckets_current", "bucket-by-age-from-assigned"),
        ("case_throughput_daily", "count-by-terminal-date"),
        ("answer_remediation_current", "count-by-remediation"),
        ("appeal_outcomes_current", "count-by-outcome"),
    ):
        assert steps_of(recorded, f"gold:{table}") == [
            "read",
            step,
            "stamp-as-of",
            "write",
        ], table
