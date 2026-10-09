"""Declared gold schemas for the ``pipeline_run_metric`` Reporting subject.

Four tables reduced from the run registry's ``run_records`` -- the step-level
records every pipeline run emits (``tools.observability``) -- and one from the
orchestration decision store. Neither store is at any of these grains; each
table states its own below.

Durations are seconds, as the registry records them. Statistics over an empty
set are NULL, never zero.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from framework.core import NonNull, OneOf, Range

SUBJECT = "pipeline_run_metric"

# A run's overall outcome: the summary record's status where one was written,
# else ``error`` if a step failed, else ``incomplete`` (killed or still running).
RUN_STATUSES = ("ok", "error", "incomplete")

# What a ``duration_percentiles_daily`` row measures: a whole run, or one step.
PERCENTILE_LEVELS = ("pipeline", "step")


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
    orchestration_run_id: str
    overhead_seconds: Annotated[float, NonNull(), Range(minimum=0)]
    retry_attempts: float
    retry_wait_seconds: float
    external_calls: float
    external_wait_seconds: float


@dataclass
class StepDurationTrendDaily:
    """``step_duration_trend_daily`` -- how long each step takes, per day,
    against its recent past.

    Grain: ``pipeline`` x ``step_address`` x ``run_date``. Here ``run_date``
    is the *execution* date -- the local date the run started -- not the
    business date the run summary and row flow carry under the same name, so a
    re-drive of an old date is measured on the day it ran. The column keeps the
    name its baseline migration gave it, since renaming it would be a
    migration of its own. The trailing baseline is the median of
    the step's daily p50 over the previous ``TRAILING_DAYS`` execution dates
    that have data; NULL on a step's first day.
    """

    pipeline: Annotated[str, NonNull()]
    step_address: Annotated[str, NonNull()]
    run_date: Annotated[str, NonNull()]
    execution_count: Annotated[int, NonNull(), Range(minimum=1)]
    duration_p50: Annotated[float, NonNull(), Range(minimum=0)]
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
    duration_seconds: float
    rows_per_second: float


@dataclass
class DurationPercentilesDaily:
    """``duration_percentiles_daily`` -- rolling percentiles per pipeline and
    per step, one snapshot per date, so the table is their history.

    Grain: ``level`` x ``pipeline`` x ``step_address`` x ``window_days`` x
    ``as_of_date``. A row exists for each *execution* date the subject ran on
    (the local date a run started, not the business ``run_date`` it was for)
    and covers the ``window_days`` calendar days ending on it. Durations and
    waits are over ``ok`` executions (``ok_count``); p90 is NULL below 10 of
    them and p95 below 20. The change ratios compare with the row 28 days
    earlier.
    """

    as_of_date: Annotated[str, NonNull()]
    level: Annotated[str, NonNull(), OneOf(*PERCENTILE_LEVELS)]
    pipeline: Annotated[str, NonNull()]
    step_address: Annotated[str, NonNull()]
    window_days: Annotated[int, NonNull(), Range(minimum=1)]
    execution_count: Annotated[int, NonNull(), Range(minimum=0)]
    ok_count: Annotated[int, NonNull(), Range(minimum=0)]
    duration_p50: Annotated[float, Range(minimum=0)]
    duration_p90: Annotated[float, Range(minimum=0)]
    duration_p95: Annotated[float, Range(minimum=0)]
    duration_max: Annotated[float, Range(minimum=0)]
    failure_rate: Annotated[float, Range(minimum=0, maximum=1)]
    retry_rate: Annotated[float, Range(minimum=0, maximum=1)]
    external_wait_p50: Annotated[float, Range(minimum=0)]
    external_wait_p95: Annotated[float, Range(minimum=0)]
    rows_per_second_p50: Annotated[float, Range(minimum=0)]
    p50_change_ratio_28d: float
    p90_change_ratio_28d: float
    as_of_utc: Annotated[str, NonNull()]


@dataclass
class BatchFinishDaily:
    """``batch_finish_daily`` -- when each run date's scheduled work finished.

    Grain: ``run_date`` (the orchestration's business date). From the
    orchestration decision store, not the run registry. The finish is
    measured from the start of the run date on the local calendar; its p50 and
    p90 are over the run dates in the 28 days ending on this one, p90 NULL
    below 10 of them.
    """

    run_date: Annotated[str, NonNull()]
    pass_count: Annotated[int, NonNull(), Range(minimum=1)]
    started_at: Annotated[str, NonNull()]
    finished_at: Annotated[str, NonNull()]
    finished_after_midnight_seconds: Annotated[float, NonNull()]
    finish_p50_28d: Annotated[float, NonNull()]
    finish_p90_28d: float
    items_run: Annotated[int, NonNull(), Range(minimum=1)]
    items_succeeded: Annotated[int, NonNull(), Range(minimum=0)]
    items_failed: Annotated[int, NonNull(), Range(minimum=0)]
    items_blocked: Annotated[int, NonNull(), Range(minimum=0)]
    queue_wait_max_seconds: Annotated[float, Range(minimum=0)]
    as_of_utc: Annotated[str, NonNull()]
