"""The case-review application's orchestration schedules.

The module an operator names on the command line::

    python -m cli orchestrate --app case_review.schedules --base-dir BASE_DIR --once

The schedule gates only the *day*; the feed's own watermark gates the *data*.
See ``docs/sharepoint-rest-ingest.md`` for the runbook.
"""

from __future__ import annotations

from framework.run import FreshnessRequirement
from tools.orchestration import PipelineSet, Schedule, ScheduledPipeline


def build_pipeline_sets():
    return (
        PipelineSet(
            "case_management",
            (
                ScheduledPipeline("pipelines/sharepoint_cases", Schedule.daily()),
                ScheduledPipeline(
                    "pipelines/reviewer_activity",
                    Schedule.daily(),
                    depends_on=(FreshnessRequirement("sharepoint_cases"),),
                ),
            ),
        ),
        PipelineSet(
            "selection",
            (ScheduledPipeline("pipelines/complaint_selection", Schedule.daily()),),
        ),
    )
