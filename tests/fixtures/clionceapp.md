```python
"""Fixture app whose source may succeed only once per run date."""

from __future__ import annotations

from tools.orchestration import PipelineSet, Schedule, ScheduledPipeline


def build_pipeline_sets():
    return (
        PipelineSet(
            "fixture",
            (
                ScheduledPipeline(
                    "clipipelines/_source",
                    Schedule.daily(),
                    allow_multiple_runs=False,
                ),
            ),
        ),
    )

```
