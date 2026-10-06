"""A Case a Maintainer reopens, polled through the whole ``sharepoint_cases`` feed.

Reporting reads each Case's latest observation, so reopening moves the Case out
of every completed count until it is completed again, and the second completion
is the date it then counts on. What the Reopen set aside is kept in the
Support Log, not on the Case row.
"""

from __future__ import annotations

import pandas as pd

from framework.run import RunContext
from pipelines.sharepoint_cases.gold import CURRENT_TABLE
from pipelines.sharepoint_cases.pipeline import FEED_NAME
from tests._sharepoint_cases_fixtures import (
    COMPLAINTS,
    NEXT_POLL,
    SERVER_NOW,
    FakeListClient,
    item,
    run,
)
from tests.framework_testing import read_rows
from tools.medallion import medallion
from tools.store import StoreRegistry

FIRST_COMPLETION = "2026-08-03T10:00:00Z"
SECOND_COMPLETION = "2026-08-05T09:05:00Z"

COMPLETED = item(
    Status="Completed",
    Modified="2026-08-03T10:00:00Z",
    **{"odata.etag": '"3"'},
    ReportableAt=FIRST_COMPLETION,
    CompletedAt=FIRST_COMPLETION,
    OutcomeAtCompletion="fail",
    HadRemediation=False,
    EffectiveOutcome="fail",
    EffectiveHadRemediation=False,
    OutcomeOverridden=False,
    QuestionBankVersion="v1",
)
REOPENED = item(
    Status="In-progress",
    Modified="2026-08-04T08:45:00Z",
    **{"odata.etag": '"4"'},
    QuestionBankVersion="v1",
)
COMPLETED_AGAIN = item(
    Status="Completed",
    Modified="2026-08-05T09:05:00Z",
    **{"odata.etag": '"5"'},
    ReportableAt=SECOND_COMPLETION,
    CompletedAt=SECOND_COMPLETION,
    OutcomeAtCompletion="pass",
    HadRemediation=False,
    EffectiveOutcome="pass",
    EffectiveHadRemediation=False,
    OutcomeOverridden=False,
    QuestionBankVersion="v1",
)


def test_a_reopened_case_leaves_the_completed_counts_and_lands_on_its_new_date(
    tmp_path,
):
    client = FakeListClient(
        pd.DataFrame([COMPLETED]),
        pd.DataFrame([REOPENED]),
        pd.DataFrame([COMPLETED_AGAIN]),
        server_now=SERVER_NOW,
        advance=NEXT_POLL,
    )
    context = RunContext(base_dir=tmp_path, pipeline=FEED_NAME)
    med = medallion(StoreRegistry(tmp_path), FEED_NAME)

    run(context, client=client, case_lists=(COMPLAINTS,))
    [first] = read_rows(med.gold, "case_throughput_daily")
    assert first["terminal_date"] == "2026-08-03"

    run(context, client=client, case_lists=(COMPLAINTS,))
    [case] = read_rows(med.gold, CURRENT_TABLE)
    assert case["status"] == "In-progress"
    for cleared in (
        "reportable_at",
        "completed_at",
        "outcome_at_completion",
        "had_remediation",
        "effective_outcome",
    ):
        assert pd.isna(case[cleared]), cleared
    assert read_rows(med.gold, "case_throughput_daily") == [], (
        "a reopened Case is in no completed count"
    )

    run(context, client=client, case_lists=(COMPLAINTS,))
    [again] = read_rows(med.gold, "case_throughput_daily")
    assert again["terminal_date"] == "2026-08-05"
    assert again["case_count"] == 1
    [case] = read_rows(med.gold, CURRENT_TABLE)
    assert pd.Timestamp(case["reportable_at"]) == pd.Timestamp(SECOND_COMPLETION)
