"""A month-walk orchestration app for CLI tests: the working-day-of-month
schedule.

Stands in for a real application's registry module — the ``--app`` argument to
``python -m cli orchestrate`` — exactly as ``cliapp`` does, but schedules the
same throwaway fixture pipeline on ``NthWorkingDayOfMonth``. That schedule walks
the month and counts against the *seeded* calendar, so it is what proves
``--calendar`` reaches the month arithmetic and not merely the
``is_working_day`` gate. The month walk in the opposite direction
(``LastWorkingDayOfMonth``) is proven by a unit test over the orchestrator
rather than by a second trip through the CLI.

The ``PipelineSet`` is named so a decision line names what made it. The
scheduled pipeline is the throwaway fixture under
``tests/fixtures/clipipelines/``.
"""

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
