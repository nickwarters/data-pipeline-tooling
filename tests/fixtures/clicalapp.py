"""Month-walk CLI test app using seeded NthWorkingDayOfMonth."""

from __future__ import annotations

from tools.orchestration import PipelineSet, Schedule, ScheduledPipeline


def build_pipeline_sets():
    return (
        PipelineSet(
            "monthly_nth",
            (
                ScheduledPipeline(
                    "clipipelines/_source", Schedule.nth_working_day_of_month(1)
                ),
            ),
        ),
    )
