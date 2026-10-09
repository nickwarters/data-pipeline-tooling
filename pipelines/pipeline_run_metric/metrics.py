"""The reductions behind the ``pipeline_run_metric`` gold tables.

They read the registry's stored forms directly -- ``warn_hits`` as JSON text,
``committed`` as 0/1 -- exactly as the ``SqliteReader`` hands them over.
"""

from __future__ import annotations

import datetime as dt
import json
from typing import get_type_hints

import pandas as pd

from framework.core import Dataset
from tools.observability import timestamps
from tools.observability.timestamps import local_date

from .schema import (
    BatchFinishDaily,
    DurationPercentilesDaily,
    PipelineRunSummary,
    StepDurationTrendDaily,
    StepRowFlow,
)

AS_OF_COLUMN = "as_of_utc"

# The run's identity lands as ``run_id``: ``pipeline_run_id`` is the reserved
# provenance column every Writer stamps with the *reporting* run's id.
RUN_ID_COLUMN = "run_id"

# The run-level summary record ``run_pipeline`` writes once per run, beside the
# step records. Its duration is the run's wall clock; it is not itself a step.
RUN_SUMMARY_STEP = "run"

# What a run whose records name no pipeline is filed under.
UNKNOWN_PIPELINE = "(unknown)"

# A step record's outcomes, as the run log writes them.
ERROR_STATUS = "error"
OK_STATUS = "ok"
# A run with no summary record and no failed step: killed, or still running.
INCOMPLETE_STATUS = "incomplete"

# How many prior run dates the duration trend's baseline looks back over.
TRAILING_DAYS = 7

# What each reduction needs from the registry row; the pipeline gates the read
# on this once.
RECORD_COLUMNS = (
    "timestamp",
    "pipeline_run_id",
    "logical_run_id",
    "pipeline",
    "step",
    "step_address",
    "status",
    "rows_in",
    "rows_out",
    "rows_quarantined",
    "rows_excluded",
    "duration",
    "error_category",
    "warn_hits",
    "committed",
    "run_date",
    "orchestration_run_id",
    "retry_attempts",
    "retry_wait_seconds",
    "external_calls",
    "external_wait_seconds",
)

WAIT_COLUMNS = (
    "retry_attempts",
    "retry_wait_seconds",
    "external_calls",
    "external_wait_seconds",
)


# --- shared helpers ---------------------------------------------------------


def latest_instant(records: Dataset) -> str | None:
    """The latest record timestamp, or None for an empty registry."""
    frame = records.to_pandas()
    if frame.empty:
        return None
    return str(frame["timestamp"].astype(str).max())


def _prepared(records: Dataset) -> pd.DataFrame:
    """Records in time order with parsed instants, two dates and a pipeline per
    run, and a step address for every row (derived from pipeline + step where
    the record predates the column, as the registry's own backfill does).

    A record is stamped when its step *ends*, so its start is ``_at`` less its
    duration. The two dates answer different questions and differ only for a
    re-drive of an earlier date:

    - ``_execution_date`` is *when the run executed*: the local calendar date it
      started. The duration trend buckets on it, so a re-drive's durations land
      on the day they were measured.
    - ``run_date`` is the *business* date: the one the run summary recorded,
      else the execution date. The run summary and row flow file a run under
      it, beside its ``logical_run_id``.

    A run's ``pipeline`` is the one its last summary record names. A handler
    that runs nested ``Pipeline`` stages writes a summary per stage, under the
    stage's name, before the runner writes the run's own; labelling the run
    by its first record would file it under a stage.
    """
    frame = records.to_pandas().copy()
    frame["_at"] = pd.to_datetime(frame["timestamp"], utc=True, format="ISO8601")
    # A record with no instant cannot be placed in time; it is left out.
    frame = frame.loc[frame["_at"].notna()].sort_values("_at", kind="stable")
    took = pd.to_timedelta(pd.to_numeric(frame["duration"]).clip(lower=0), unit="s")
    frame["_start"] = (frame["_at"] - took.fillna(pd.Timedelta(0))).dt.round("us")
    frame["_is_summary"] = frame["step"].eq(RUN_SUMMARY_STEP)

    pipeline = frame["pipeline"].astype("string")
    address = frame["step_address"].astype("string")
    derived = pipeline + "." + frame["step"].astype("string")
    derived = derived.mask(frame["_is_summary"], pipeline)
    frame["step_address"] = address.mask(address.isna() | address.eq(""), derived)

    first = frame.drop_duplicates("pipeline_run_id").set_index("pipeline_run_id")
    named = pipeline.where(frame["_is_summary"])
    named = named.groupby(frame["pipeline_run_id"]).transform("last")
    named = named.fillna(frame["pipeline_run_id"].map(first["pipeline"]))
    frame["pipeline"] = named.fillna(UNKNOWN_PIPELINE)

    by_run = frame.groupby("pipeline_run_id")
    run_start = by_run["_start"].transform("min")
    # One local-date conversion per run, not per record.
    dates = {at: local_date(at).isoformat() for at in run_start.unique()}
    recorded = frame["run_date"].where(frame["_is_summary"])
    recorded = recorded.groupby(frame["pipeline_run_id"]).transform("last")
    frame["_execution_date"] = run_start.map(dates)
    frame["run_date"] = recorded.fillna(frame["_execution_date"])
    return frame


# What each declared type is held as while the table is being built.
PANDAS_DTYPES = {str: "string", int: "int64", float: "float64", bool: "bool"}


def _columns(table: type) -> dict[str, str]:
    """The columns ``table`` declares, in order, as the dtypes they land as.

    The dataclass in ``schema`` is the one statement of a table's shape; these
    reductions read it off there rather than restating it beside each one.
    """
    return {
        name: PANDAS_DTYPES[declared]
        for name, declared in get_type_hints(table).items()
    }


def _typed(frame: pd.DataFrame, table: type, *, as_of: str) -> Dataset:
    """Stamp the frame and land it as the columns and types ``table`` declares.

    Typing every column explicitly is what makes an empty result still carry
    the shape the table's ``SchemaValidator`` gates.
    """
    columns = _columns(table)
    frame = frame.copy()
    frame[AS_OF_COLUMN] = as_of
    for column, dtype in columns.items():
        frame[column] = frame[column].astype(dtype)
    return Dataset.from_pandas(frame[list(columns)].reset_index(drop=True))


def _warn_count(value: object) -> int:
    """How many warn hits a record carries; the registry stores them as JSON."""
    if isinstance(value, list):
        return len(value)
    if not isinstance(value, str) or not value.strip():
        return 0
    try:
        loaded = json.loads(value)
    except ValueError:
        return 0
    return len(loaded) if isinstance(loaded, list) else 0


# --- the tables -------------------------------------------------------------


def run_summary(records: Dataset, *, as_of: str) -> Dataset:
    """One row per pipeline run. **Grain: run_id.**

    Wall clock is the summary record's ``duration`` where one was written,
    else first start to last end, and ``overhead_seconds`` is what of it no
    step accounts for. ``status`` and the wait counters are the summary's;
    without one, ``status`` is ``error`` if any step errored, else
    ``incomplete``. ``attempt_number`` ranks a run
    among those sharing its ``logical_run_id`` by start, so a re-drive is the
    second attempt and the run it replaced is no longer the latest.
    """
    return _typed(_runs(_prepared(records)), PipelineRunSummary, as_of=as_of)


def _runs(frame: pd.DataFrame) -> pd.DataFrame:
    """``run_summary``'s rows, before they are typed."""
    is_step = ~frame["_is_summary"]
    failed = is_step & frame["status"].eq(ERROR_STATUS)
    committed = pd.to_numeric(frame["committed"]).fillna(0).astype(bool)
    frame = frame.assign(
        _step=is_step,
        _failed=failed,
        _committed=is_step & committed,
        _step_duration=pd.to_numeric(frame["duration"]).where(is_step),
        # Builder pipelines repeat every step's warns on the run summary.
        _warns=frame["warn_hits"].map(_warn_count).where(is_step, 0),
    )

    by_run = frame.groupby("pipeline_run_id", sort=False)
    # The logical run id is the first record's, even where that is NULL.
    runs = by_run[["pipeline", "logical_run_id"]].first(skipna=False)
    runs = runs.join(
        by_run.agg(
            run_date=("run_date", "first"),
            _execution_date=("_execution_date", "first"),
            started=("_start", "min"),
            finished=("_at", "max"),
            step_duration_seconds=("_step_duration", "sum"),
            step_count=("_step", "sum"),
            failed_step_count=("_failed", "sum"),
            committed_step_count=("_committed", "sum"),
            warn_hit_count=("_warns", "sum"),
            error_category=("error_category", "first"),
            orchestration_run_id=("orchestration_run_id", "first"),
        )
    )

    # The run's own summary record, where one was written; the last one wins.
    summary = (
        frame.loc[
            frame["_is_summary"],
            ["pipeline_run_id", "duration", "status", *WAIT_COLUMNS],
        ]
        .drop_duplicates("pipeline_run_id", keep="last")
        .set_index("pipeline_run_id")
        .reindex(runs.index)
    )
    span = (runs["finished"] - runs["started"]).dt.total_seconds()
    wall = pd.to_numeric(summary["duration"]).fillna(span)
    derived = (
        runs["failed_step_count"]
        .gt(0)
        .map({True: ERROR_STATUS, False: INCOMPLETE_STATUS})
    )

    summarised = (
        runs.assign(
            started_at=runs["started"].map(pd.Timestamp.isoformat),
            finished_at=runs["finished"].map(pd.Timestamp.isoformat),
            wall_clock_seconds=wall.clip(lower=0).round(6),
            step_duration_seconds=runs["step_duration_seconds"].round(6),
            overhead_seconds=(wall - runs["step_duration_seconds"])
            .clip(lower=0)
            .round(6),
            status=summary["status"].fillna(derived),
            **{
                column: pd.to_numeric(summary[column]).round(6)
                for column in WAIT_COLUMNS
            },
        )
        .rename_axis(RUN_ID_COLUMN)
        .reset_index()
        .sort_values(["started_at", RUN_ID_COLUMN], kind="stable")
    )
    # A run with no logical run id is its own attempt series. The rows are in
    # start order, so a key's last row is its latest attempt.
    attempt_key = summarised["logical_run_id"].fillna(summarised[RUN_ID_COLUMN])
    summarised["attempt_number"] = attempt_key.groupby(attempt_key).cumcount() + 1
    summarised["is_latest_attempt"] = ~attempt_key.duplicated(keep="last")
    return summarised


# The trend's measures, rounded to the same place before they are published.
TREND_MEASURES = (
    "duration_p50",
    "duration_max",
    "trailing_p50_median",
    "delta_seconds",
    "delta_ratio",
)


def step_duration_trend(
    records: Dataset, *, as_of: str, trailing_days: int = TRAILING_DAYS
) -> Dataset:
    """Step duration per day against its recent past. **Grain: pipeline x
    step_address x run_date**, where ``run_date`` is the *execution* date: the
    local date the run started, not the business date it recorded.

    "Is this step slower than its recent past?" is a question about when it
    ran, so a re-drive of an old date lands on the day it executed and leaves
    that old date's row, and the baselines after it, as they were.

    ``trailing_p50_median`` is the median of the step's daily p50 over its
    previous ``trailing_days`` execution dates *with data* (a step that ran
    three times last fortnight has a three-day baseline), NULL on its first
    day. ``delta_ratio`` is NULL where the baseline is NULL or zero.
    """
    frame = _prepared(records)
    # A failed step's duration says how long it took to fail, not to run.
    ran = frame["status"].eq(OK_STATUS) & frame["duration"].notna()
    steps = frame.loc[~frame["_is_summary"] & ran].copy()
    steps["duration"] = pd.to_numeric(steps["duration"])

    # The table's ``run_date`` column carries the execution date (see above).
    steps["run_date"] = steps["_execution_date"]
    by_day = steps.groupby(["pipeline", "step_address", "run_date"], sort=True)
    durations = by_day["duration"]
    daily = durations.agg(
        execution_count="size", duration_p50="median", duration_max="max"
    ).reset_index()

    # Shift each step's daily p50 back a day, then take a rolling median within
    # the step; both run per step in compiled code, not per step in Python.
    step_keys = [daily["pipeline"], daily["step_address"]]
    previous = daily["duration_p50"].groupby(step_keys, sort=False).shift(1)
    daily["trailing_p50_median"] = (
        previous.groupby(step_keys, sort=False)
        .rolling(trailing_days, min_periods=1)
        .median()
        .droplevel([0, 1])
    )
    baseline = daily["trailing_p50_median"]
    daily["delta_seconds"] = daily["duration_p50"] - baseline
    daily["delta_ratio"] = daily["delta_seconds"] / baseline.where(baseline > 0)
    for column in TREND_MEASURES:
        daily[column] = daily[column].round(6)

    return _typed(daily, StepDurationTrendDaily, as_of=as_of)


COUNT_COLUMNS = ("rows_in", "rows_out", "rows_quarantined", "rows_excluded")


def step_row_flow(records: Dataset, *, as_of: str) -> Dataset:
    """The row funnel through each step of each run. **Grain: run_id x
    step_address.** Only steps that reported a row count appear; a count no
    execution reported stays NULL rather than becoming zero.
    ``rows_per_second`` is ``rows_out`` over the step's duration."""
    frame = _prepared(records)
    for column in (*COUNT_COLUMNS, "duration"):
        frame[column] = pd.to_numeric(frame[column])
    reported = frame[list(COUNT_COLUMNS)].notna().any(axis=1)
    steps = frame.loc[~frame["_is_summary"] & reported]

    by_step = steps.groupby(
        ["pipeline_run_id", "pipeline", "step_address", "run_date"], sort=True
    )
    # ``min_count=1`` keeps a count no execution reported NULL, not zero.
    flow = by_step[[*COUNT_COLUMNS, "duration"]].sum(min_count=1)
    flow.insert(0, "execution_count", by_step.size())
    flow = flow.reset_index().rename(
        columns={"pipeline_run_id": RUN_ID_COLUMN, "duration": "duration_seconds"}
    )
    rows_in = flow["rows_in"].where(flow["rows_in"] > 0)
    flow["out_ratio"] = (flow["rows_out"] / rows_in).round(6)
    flow["quarantine_ratio"] = (flow["rows_quarantined"] / rows_in).round(6)
    took = flow["duration_seconds"].where(flow["duration_seconds"] > 0)
    flow["rows_per_second"] = (flow["rows_out"] / took).round(6)
    flow["duration_seconds"] = flow["duration_seconds"].round(6)

    return _typed(flow, StepRowFlow, as_of=as_of)


# --- percentiles over rolling windows -------------------------------------------

# The windows a percentile is taken over: calendar days ending on the as-of
# date. 28 days gives a daily job about 20 samples; 90 days shows the slow tail.
WINDOWS = (28, 90)
# Below these sample counts a p90 / p95 is in effect the max, so it is NULL.
MIN_SAMPLES_P90 = 10
MIN_SAMPLES_P95 = 20
# The change columns compare with the row this many days earlier, or the latest
# one within the tolerance before it when the subject did not run that day.
CHANGE_DAYS = 28
CHANGE_TOLERANCE_DAYS = 7

PIPELINE_LEVEL = "pipeline"
STEP_LEVEL = "step"
SUBJECT_KEYS = ["level", "pipeline", "step_address"]


def _executions(frame: pd.DataFrame) -> pd.DataFrame:
    """One row per execution of a run (``level`` pipeline) or of a step,
    dated by its *execution* date: the local date its run started.

    "Is this getting slower?" is a question about when it ran, so a re-drive
    of an old date lands on the day it executed, as in the duration trend.
    Durations, external waits and throughput are kept for ``ok`` executions
    only: a failure's duration says how long it took to fail.
    """
    runs = _runs(frame)
    run_ok = runs["status"].eq(OK_STATUS)
    pipelines = pd.DataFrame(
        {
            "level": PIPELINE_LEVEL,
            "pipeline": runs["pipeline"],
            "step_address": runs["pipeline"],
            "execution_date": runs["_execution_date"],
            "finished": runs["status"].isin([OK_STATUS, ERROR_STATUS]),
            "failed": runs["status"].eq(ERROR_STATUS),
            "duration": runs["wall_clock_seconds"].where(run_ok),
            "retry_attempts": runs["retry_attempts"],
            "external_wait": runs["external_wait_seconds"].where(run_ok),
            "rows_per_second": float("nan"),
        }
    )

    steps = frame.loc[~frame["_is_summary"]]
    step_ok = steps["status"].eq(OK_STATUS)
    took = pd.to_numeric(steps["duration"]).where(step_ok)
    rows_out = pd.to_numeric(steps["rows_out"])
    steps = pd.DataFrame(
        {
            "level": STEP_LEVEL,
            "pipeline": steps["pipeline"],
            "step_address": steps["step_address"],
            "execution_date": steps["_execution_date"],
            "finished": steps["status"].isin([OK_STATUS, ERROR_STATUS]),
            "failed": steps["status"].eq(ERROR_STATUS),
            "duration": took,
            "retry_attempts": pd.to_numeric(steps["retry_attempts"]),
            "external_wait": pd.to_numeric(steps["external_wait_seconds"]).where(
                step_ok
            ),
            "rows_per_second": rows_out / took.where(took > 0),
        }
    )
    executions = pd.concat([pipelines, steps], ignore_index=True)
    for flag in ("finished", "failed"):
        executions[flag] = executions[flag].astype(float)
    executions["retried"] = executions["retry_attempts"].gt(0).astype(float)
    executions["retried"] = executions["retried"].where(
        executions["retry_attempts"].notna()
    )
    subject = ["pipeline", "step_address", "execution_date"]
    known = executions[subject].notna().all(axis=1)
    return executions.loc[known]


def _over_window(executions: pd.DataFrame, window_days: int) -> pd.DataFrame:
    """Each subject's statistics over the ``window_days`` ending on each date
    it ran, one row per subject per such date.

    Every measure is a grouped time-based rolling aggregate, so all subjects
    are computed in one pass rather than a Python call per subject per day.
    """
    days = pd.to_datetime(executions["execution_date"])
    ordered = executions.assign(_day=days).sort_values(
        [*SUBJECT_KEYS, "_day"], kind="stable"
    )
    grouped = ordered.set_index("_day").groupby(SUBJECT_KEYS, sort=False)
    span = f"{window_days}D"

    def rolling(column: str):
        return grouped[column].rolling(span)

    # The rolling results come back in the rows' own order (the frame is
    # sorted by subject, and each subject's rows keep their order).
    measures = {
        "ok_count": rolling("duration").count(),
        "duration_p50": rolling("duration").median(),
        "duration_p90": rolling("duration").quantile(0.90),
        "duration_p95": rolling("duration").quantile(0.95),
        "duration_max": rolling("duration").max(),
        "external_wait_p50": rolling("external_wait").median(),
        "external_wait_p95": rolling("external_wait").quantile(0.95),
        "rows_per_second_p50": rolling("rows_per_second").median(),
        "_finished": rolling("finished").sum(),
        "_failed": rolling("failed").sum(),
        "_retried": rolling("retried").sum(),
        "_retry_known": rolling("retried").count(),
    }
    for name, values in measures.items():
        ordered[name] = values.to_numpy()

    # A day's last row has seen every execution of that day.
    daily = ordered.drop_duplicates([*SUBJECT_KEYS, "_day"], keep="last").copy()
    n = daily["ok_count"]
    daily["duration_p90"] = daily["duration_p90"].where(n >= MIN_SAMPLES_P90)
    daily["duration_p95"] = daily["duration_p95"].where(n >= MIN_SAMPLES_P95)
    daily["execution_count"] = daily["_finished"]
    daily["failure_rate"] = daily["_failed"] / daily["_finished"].where(
        daily["_finished"] > 0
    )
    daily["retry_rate"] = daily["_retried"] / daily["_retry_known"].where(
        daily["_retry_known"] > 0
    )
    daily["window_days"] = window_days
    return _with_change(daily)


def _with_change(daily: pd.DataFrame) -> pd.DataFrame:
    """Add each row's p50 and p90 change against the same subject's row
    ``CHANGE_DAYS`` earlier, as a ratio (0.25 = a quarter slower)."""
    earlier = daily[[*SUBJECT_KEYS, "_day", "duration_p50", "duration_p90"]]
    earlier = earlier.rename(
        columns={"duration_p50": "_p50_then", "duration_p90": "_p90_then"}
    ).sort_values("_day", kind="stable")
    current = daily.assign(
        _then=daily["_day"] - pd.Timedelta(days=CHANGE_DAYS)
    ).sort_values("_then", kind="stable")
    matched = pd.merge_asof(
        current,
        earlier.rename(columns={"_day": "_then"}),
        on="_then",
        by=SUBJECT_KEYS,
        direction="backward",
        tolerance=pd.Timedelta(days=CHANGE_TOLERANCE_DAYS),
    )
    for measure, then in (("p50", "_p50_then"), ("p90", "_p90_then")):
        base = matched[then].where(matched[then] > 0)
        matched[f"{measure}_change_ratio_28d"] = (
            matched[f"duration_{measure}"] - base
        ) / base
    return matched


PERCENTILE_MEASURES = (
    "duration_p50",
    "duration_p90",
    "duration_p95",
    "duration_max",
    "failure_rate",
    "retry_rate",
    "external_wait_p50",
    "external_wait_p95",
    "rows_per_second_p50",
    "p50_change_ratio_28d",
    "p90_change_ratio_28d",
)


def duration_percentiles(
    records: Dataset, *, as_of: str, windows: tuple[int, ...] = WINDOWS
) -> Dataset:
    """Rolling percentiles per pipeline and per step. **Grain: level x
    pipeline x step_address x window_days x as_of_date.**

    One row for each date a subject ran, over the ``window_days`` calendar
    days ending on it, so the table is the history of each percentile. The
    dates are *execution* dates, the local date each run started, not the
    business ``run_date`` it recorded: ``as_of_date`` is the last execution
    date in the window, and a re-drive of an old date counts on the day it
    ran. A
    pipeline-level row measures the run's wall clock and has the pipeline as
    its ``step_address``. Durations count ``ok`` executions only (``ok_count``);
    ``failure_rate`` is over every finished one. p90 is NULL below
    ``MIN_SAMPLES_P90`` samples and p95 below ``MIN_SAMPLES_P95``.
    """
    executions = _executions(_prepared(records))
    if executions.empty:
        table = pd.DataFrame(columns=list(_columns(DurationPercentilesDaily)))
        return _typed(table, DurationPercentilesDaily, as_of=as_of)
    table = pd.concat(
        [_over_window(executions, days) for days in windows], ignore_index=True
    )
    table["as_of_date"] = table["_day"].dt.strftime("%Y-%m-%d")
    for column in PERCENTILE_MEASURES:
        table[column] = table[column].round(6)
    table = table.sort_values(
        ["level", "pipeline", "step_address", "window_days", "as_of_date"],
        kind="stable",
    )
    return _typed(table, DurationPercentilesDaily, as_of=as_of)


# --- the scheduled batch ----------------------------------------------------------

# The orchestration decision columns ``batch_finish`` reads.
DECISION_COLUMNS = (
    "timestamp",
    "orchestration_run_id",
    "item_key",
    "run_date",
    "status",
    "pass_started_at",
    "started_at",
)
# How many earlier run dates the finish-time percentiles look back over.
FINISH_WINDOW = 28


def batch_finish(decisions: Dataset, *, as_of: str) -> Dataset:
    """When each run date's scheduled work finished. **Grain: run_date.**

    Read from the orchestration decision store. A run date appears once an
    item ran for it. ``finished_after_midnight_seconds`` is measured from the
    start of the run date on the local calendar, so a batch that runs past
    midnight reads as more than a day; its p50 and p90 are over the run
    dates in the ``FINISH_WINDOW`` days ending on this one.

    The ``items_*`` columns count *items* (``item_key``), not decisions.
    ``orchestrate --loop`` decides every item again on each poll: an item
    blocked on a late upstream is recorded ``blocked`` on every poll until it
    runs, and one that has run is recorded ``skipped`` on every poll after.
    So ``items_run`` is the items handed to a pipeline at least once, and each
    outcome count is by the item's last decision that was not a skip.
    """
    frame = decisions.to_pandas().copy()
    if frame.empty:
        table = pd.DataFrame(columns=list(_columns(BatchFinishDaily)))
        return _typed(table, BatchFinishDaily, as_of=as_of)

    def instant(column: str) -> pd.Series:
        return pd.to_datetime(frame[column], utc=True, format="ISO8601")

    frame["_at"] = instant("timestamp")
    frame["_pass_start"] = instant("pass_started_at")
    frame["_start"] = instant("started_at")
    # Decisions written before the start columns existed: an item that
    # succeeded or failed was run.
    ran = frame["_start"].notna() | frame["status"].isin(["succeeded", "failed"])
    frame = frame.assign(
        _ran=ran,
        _finish=frame["_at"].where(ran),
        _queued=(frame["_start"] - frame["_pass_start"]).dt.total_seconds(),
        _succeeded=frame["status"].eq("succeeded"),
        _failed=frame["status"].eq("failed"),
        _blocked=frame["status"].eq("blocked"),
    )
    days = frame.groupby("run_date", sort=True).agg(
        pass_count=("orchestration_run_id", "nunique"),
        _first_pass=("_pass_start", "min"),
        _first_decision=("_at", "min"),
        _finished=("_finish", "max"),
        queue_wait_max_seconds=("_queued", "max"),
    )
    # One row per item: run if any of its decisions ran; its outcome is its
    # last decision that was not a skip (a skip settles nothing about it).
    items = frame.sort_values("_at", kind="stable")
    ran_items = items.groupby(["run_date", "item_key"])["_ran"].any()
    outcomes = (
        items.loc[items["status"].ne("skipped")]
        .drop_duplicates(["run_date", "item_key"], keep="last")
        .groupby("run_date")[["_succeeded", "_failed", "_blocked"]]
        .sum()
    )
    days = days.join(ran_items.groupby("run_date").sum().rename("items_run"))
    days = days.join(
        outcomes.rename(
            columns={
                "_succeeded": "items_succeeded",
                "_failed": "items_failed",
                "_blocked": "items_blocked",
            }
        )
    )
    days = days.loc[days["_finished"].notna()].reset_index()
    started = days["_first_pass"].fillna(days["_first_decision"])
    days["started_at"] = started.map(pd.Timestamp.isoformat)
    days["finished_at"] = days["_finished"].map(pd.Timestamp.isoformat)
    midnight = pd.to_datetime(
        days["run_date"].map(
            lambda day: timestamps.start_of_local_day(dt.date.fromisoformat(day))
        ),
        utc=True,
        format="ISO8601",
    )
    finish = (days["_finished"] - midnight).dt.total_seconds()
    days["finished_after_midnight_seconds"] = finish

    by_day = finish.set_axis(pd.to_datetime(days["run_date"])).rolling(
        f"{FINISH_WINDOW}D"
    )
    count = by_day.count().to_numpy()
    days["finish_p50_28d"] = by_day.median().to_numpy()
    days["finish_p90_28d"] = by_day.quantile(0.90).to_numpy()
    days["finish_p90_28d"] = days["finish_p90_28d"].where(count >= MIN_SAMPLES_P90)
    for column in (
        "finished_after_midnight_seconds",
        "finish_p50_28d",
        "finish_p90_28d",
        "queue_wait_max_seconds",
    ):
        days[column] = days[column].round(6)
    return _typed(days, BatchFinishDaily, as_of=as_of)
