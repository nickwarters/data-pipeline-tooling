```python
"""Declared gold schemas for the ``pipeline_run_metric`` Reporting subject.

Three tables, each reduced from the run registry's ``run_records`` -- the
step-level records every pipeline run emits (``tools.observability``). The
registry stores one row per step execution; none of these tables is at that
grain, and each states its own below.

Durations are seconds, as the registry records them. Statistics over an empty
set are NULL, never zero.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from framework.core import NonNull, OneOf, Range

SUBJECT = "pipeline_run_metric"

# A run's overall outcome: the summary record's status where one was written,
# else derived from its steps.
RUN_STATUSES = ("ok", "error")


@dataclass
class PipelineRunSummary:
    """``pipeline_run_summary`` -- one row per pipeline run.

    Grain: ``run_id`` -- the registry's ``pipeline_run_id``, renamed because
    every table-backed Writer stamps its *own* run's id into a reserved
    ``pipeline_run_id`` column, and a grain column of that name would be
    overwritten. The registry has only step rows; this is the "one row per
    run" every other operational question joins to.
    """

    run_id: Annotated[str, NonNull()]
    pipeline: Annotated[str, NonNull()]
    logical_run_id: str
    run_date: Annotated[str, NonNull()]
    started_at: Annotated[str, NonNull()]
    finished_at: Annotated[str, NonNull()]
    wall_clock_seconds: Annotated[float, NonNull(), Range(minimum=0)]
    step_duration_seconds: Annotated[float, NonNull(), Range(minimum=0)]
    step_count: Annotated[int, NonNull(), Range(minimum=0)]
    failed_step_count: Annotated[int, NonNull(), Range(minimum=0)]
    committed_step_count: Annotated[int, NonNull(), Range(minimum=0)]
    warn_hit_count: Annotated[int, NonNull(), Range(minimum=0)]
    status: Annotated[str, NonNull(), OneOf(*RUN_STATUSES)]
    error_category: str
    attempt_number: Annotated[int, NonNull(), Range(minimum=1)]
    is_latest_attempt: Annotated[bool, NonNull()]
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class StepDurationTrendDaily:
    """``step_duration_trend_daily`` -- how long each step takes, per day,
    against its recent past.

    Grain: ``pipeline`` x ``step_address`` x ``run_date``. The trailing
    baseline is the median of the step's daily p50 over the previous
    ``TRAILING_DAYS`` run dates that have data; NULL on a step's first day.
    """

    pipeline: Annotated[str, NonNull()]
    step_address: Annotated[str, NonNull()]
    run_date: Annotated[str, NonNull()]
    execution_count: Annotated[int, NonNull(), Range(minimum=1)]
    duration_p50: Annotated[float, NonNull(), Range(minimum=0)]
    duration_p95: Annotated[float, NonNull(), Range(minimum=0)]
    duration_max: Annotated[float, NonNull(), Range(minimum=0)]
    trailing_p50_median: float
    delta_seconds: float
    delta_ratio: float
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class StepRowFlow:
    """``step_row_flow`` -- the row funnel through each step of each run.

    Grain: ``run_id`` x ``step_address`` (``run_id`` as in
    ``PipelineRunSummary``). A step executed more than once in a run is
    summed; the ratios are against the summed ``rows_in``.
    """

    run_id: Annotated[str, NonNull()]
    pipeline: Annotated[str, NonNull()]
    step_address: Annotated[str, NonNull()]
    run_date: Annotated[str, NonNull()]
    execution_count: Annotated[int, NonNull(), Range(minimum=1)]
    rows_in: float
    rows_out: float
    rows_quarantined: float
    rows_excluded: float
    out_ratio: float
    quarantine_ratio: float
    as_of_utc: Annotated[str, NonNull()]

```
