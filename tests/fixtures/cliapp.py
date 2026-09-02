"""Path-addressed fixture app for operator CLI tests."""

from __future__ import annotations

from tools.orchestration import PipelineSet, Schedule, ScheduledPipeline


def build_pipeline_sets():
    return (
        PipelineSet(
            "fixture",
            (
                ScheduledPipeline("clipipelines/_source", Schedule.daily()),
                # _downstream declares UPSTREAMS gating on _source freshness, so
                # the path invoker composes that with the schedule automatically.
                ScheduledPipeline("clipipelines/_downstream", Schedule.daily()),
            ),
        ),
    )
