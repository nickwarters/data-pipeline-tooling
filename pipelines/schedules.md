```python
"""The case-review application's orchestration schedules.

Declared beside the ``pipelines/<name>`` feeds they address, not in the domain
package: a schedule names a path in this tree and nothing in ``case_review/``.

The module an operator names on the command line::

    python -m cli orchestrate --app pipelines.schedules --base-dir BASE_DIR --once

The schedule gates only the *day*; the feed's own watermark gates the *data*.
Every other item runs once per run date (``allow_multiple_runs`` defaults to
False). See ``docs/sharepoint-rest-ingest.md`` for the runbook.
"""

from __future__ import annotations

from framework.run import FreshnessRequirement
from tools.orchestration import PipelineSet, Schedule, ScheduledPipeline


def build_pipeline_sets():
    return (
        PipelineSet(
            "case_management",
            (
                # Polling feeds: a watermark makes each repeat pass cheap
                ScheduledPipeline(
                    "pipelines/sharepoint_cases",
                    Schedule.daily(),
                    allow_multiple_runs=True,
                ),
                ScheduledPipeline(
                    "pipelines/case_support_log",
                    Schedule.daily(),
                    allow_multiple_runs=True,
                ),
                ScheduledPipeline(
                    "pipelines/cora_access_log",
                    Schedule.daily(),
                    allow_multiple_runs=True,
                ),
                ScheduledPipeline(
                    "pipelines/reviewer_activity",
                    Schedule.daily(),
                    depends_on=(FreshnessRequirement("sharepoint_cases"),),
                ),
                ScheduledPipeline(
                    "pipelines/cora_platform_metric",
                    Schedule.daily(),
                    depends_on=(
                        FreshnessRequirement("sharepoint_cases", max_age_days=0),
                    ),
                ),
            ),
        ),
        PipelineSet(
            "selection",
            (ScheduledPipeline("pipelines/complaint_selection", Schedule.daily()),),
        ),
        # Last, so the day's other runs are in the registry it reads.
        PipelineSet(
            "operations",
            (ScheduledPipeline("pipelines/pipeline_run_metric", Schedule.daily()),),
        ),
    )

```
