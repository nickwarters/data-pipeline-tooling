"""A minimal orchestration app for CLI tests: schedules path-addressed feeds.

Stands in for a real application's registry module — the ``--app`` argument to
``python -m cli orchestrate``. It exposes only ``build_pipeline_sets()`` (the
schedules); there is no ``build_runner()`` any more, because orchestrate now
addresses each pipeline by its ``pipelines/<name>`` path exactly as ``run`` does.
The scheduled pipelines are the throwaway fixtures under
``tests/fixtures/clipipelines/``.
"""

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
