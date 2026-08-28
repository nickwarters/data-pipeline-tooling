"""The reductions behind the ``pipeline_run_metric`` gold tables.

Each function takes the run registry's ``run_records`` as read -- one row per
step execution, the shape ``tools.observability.record_schema`` declares -- and
returns one table. Nothing here reads or writes; the pipeline module wires the
reader and writers around these so each can be exercised on a few records.

The registry stores JSON-encoded lists (``errors``, ``warn_hits``) and a 0/1
``committed`` flag as SQLite text and integers; these reductions read those
stored forms directly rather than going through ``RunRegistry``'s decode, so
a record lands here exactly as the ``SqliteReader`` handed it over.

``as_of_utc`` is the latest record timestamp in the registry: a re-run over
the same registry contents produces the same tables.
"""

from __future__ import annotations

import json

import pandas as pd

from framework.core import Dataset
from tools.observability.timestamps import local_date

AS_OF_COLUMN = "as_of_utc"

# The run-level summary record ``run_pipeline`` writes once per run, beside the
# step records. Its duration is the run's wall clock; it is not itself a step.
RUN_SUMMARY_STEP = "run"

# A step record's outcomes, as the run log writes them.
ERROR_STATUS = "error"
OK_STATUS = "ok"

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
)


# --- shared helpers ---------------------------------------------------------


def as_of_of(records: Dataset) -> str | None:
    """The latest record timestamp, or None for an empty registry."""
    frame = records.to_pandas()
    if frame.empty:
        return None
    return str(frame["timestamp"].astype(str).max())


def _prepared(records: Dataset) -> pd.DataFrame:
    """Records with parsed instants, a local ``run_date`` per run, and a step
    address for every row (derived from pipeline + step where the record
    predates the column, as the registry's own backfill does)."""
    frame = records.to_pandas().copy()
    frame["_at"] = pd.to_datetime(frame["timestamp"], utc=True, format="ISO8601")
    frame["_is_summary"] = frame["step"].eq(RUN_SUMMARY_STEP)
    address = frame["step_address"].astype("string")
    derived = frame["pipeline"].astype("string") + "." + frame["step"].astype("string")
    derived = derived.where(~frame["_is_summary"], frame["pipeline"].astype("string"))
    frame["step_address"] = address.where(address.notna() & address.ne(""), derived)
    run_start = frame.groupby("pipeline_run_id")["_at"].transform("min")
    frame["run_date"] = run_start.map(lambda at: local_date(at).isoformat())
    return frame


def _typed(frame: pd.DataFrame, *, as_of: str, ints=(), floats=(), bools=()) -> Dataset:
    """Stamp, type and return in the given column order (the frame's)."""
    frame = frame.copy()
    frame[AS_OF_COLUMN] = as_of
    for column in frame.columns:
        if column in ints:
            frame[column] = frame[column].astype("int64")
        elif column in floats:
            frame[column] = pd.to_numeric(frame[column]).astype("float64")
        elif column in bools:
            frame[column] = frame[column].astype("bool")
        else:
            frame[column] = frame[column].astype("string")
    return Dataset.from_pandas(frame.reset_index(drop=True))


def _warn_count(value: object) -> int:
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

# The run's identity lands as ``run_id``: ``pipeline_run_id`` is the reserved
# provenance column every Writer stamps with the *reporting* run's id.
RUN_ID_COLUMN = "run_id"

SUMMARY_COLUMNS = (
    RUN_ID_COLUMN,
    "pipeline",
    "logical_run_id",
    "run_date",
    "started_at",
    "finished_at",
    "wall_clock_seconds",
    "step_duration_seconds",
    "step_count",
    "failed_step_count",
    "committed_step_count",
    "warn_hit_count",
    "status",
    "error_category",
    "attempt_number",
    "is_latest_attempt",
    AS_OF_COLUMN,
)


def run_summary(records: Dataset, *, as_of: str) -> Dataset:
    """One row per pipeline run. **Grain: run_id.**

    Wall clock is the summary record's ``duration`` where one was written,
    else first-to-last record; ``status`` is the summary's, else ``error`` if
    any step errored. ``attempt_number`` ranks a run among those sharing its
    ``logical_run_id`` by start, so a re-drive is the second attempt and the
    run it replaced is no longer the latest.
    """
    frame = _prepared(records)
    rows = []
    for run_id, run in frame.sort_values(["_at"], kind="stable").groupby(
        "pipeline_run_id", sort=False
    ):
        steps = run.loc[~run["_is_summary"]]
        summaries = run.loc[run["_is_summary"]]
        summary = summaries.iloc[-1] if not summaries.empty else None
        started, finished = run["_at"].min(), run["_at"].max()
        wall = (
            float(summary["duration"])
            if summary is not None and pd.notna(summary["duration"])
            else (finished - started).total_seconds()
        )
        failed = int(steps["status"].eq(ERROR_STATUS).sum())
        status = (
            str(summary["status"])
            if summary is not None and pd.notna(summary["status"])
            else (ERROR_STATUS if failed else OK_STATUS)
        )
        categories = run["error_category"].dropna()
        rows.append(
            {
                RUN_ID_COLUMN: run_id,
                "pipeline": run["pipeline"].iloc[0],
                "logical_run_id": run["logical_run_id"].iloc[0],
                "run_date": run["run_date"].iloc[0],
                "started_at": started.isoformat(),
                "finished_at": finished.isoformat(),
                "wall_clock_seconds": round(max(wall, 0.0), 6),
                "step_duration_seconds": round(
                    float(pd.to_numeric(steps["duration"]).fillna(0).sum()), 6
                ),
                "step_count": int(len(steps)),
                "failed_step_count": failed,
                "committed_step_count": int(
                    pd.to_numeric(steps["committed"]).fillna(0).astype(bool).sum()
                ),
                "warn_hit_count": int(run["warn_hits"].map(_warn_count).sum()),
                "status": status,
                "error_category": categories.iloc[0] if not categories.empty else None,
            }
        )
    result = pd.DataFrame(
        rows,
        columns=[
            c
            for c in SUMMARY_COLUMNS
            if c not in ("attempt_number", "is_latest_attempt", AS_OF_COLUMN)
        ],
    )
    if result.empty:
        result["attempt_number"] = pd.Series([], dtype="int64")
        result["is_latest_attempt"] = pd.Series([], dtype="bool")
    else:
        result = result.sort_values(["started_at", RUN_ID_COLUMN], kind="stable")
        key = result["logical_run_id"].fillna(result[RUN_ID_COLUMN])
        result["attempt_number"] = key.groupby(key).cumcount() + 1
        result["is_latest_attempt"] = result["attempt_number"].eq(
            key.map(key.value_counts())
        )
    return _typed(
        result[[c for c in SUMMARY_COLUMNS if c != AS_OF_COLUMN]],
        as_of=as_of,
        ints=(
            "step_count",
            "failed_step_count",
            "committed_step_count",
            "warn_hit_count",
            "attempt_number",
        ),
        floats=("wall_clock_seconds", "step_duration_seconds"),
        bools=("is_latest_attempt",),
    )


TREND_COLUMNS = (
    "pipeline",
    "step_address",
    "run_date",
    "execution_count",
    "duration_p50",
    "duration_p95",
    "duration_max",
    "trailing_p50_median",
    "delta_seconds",
    "delta_ratio",
    AS_OF_COLUMN,
)


def step_duration_trend(
    records: Dataset, *, as_of: str, trailing_days: int = TRAILING_DAYS
) -> Dataset:
    """Step duration per day against its recent past. **Grain: pipeline x
    step_address x run_date.**

    ``trailing_p50_median`` is the median of the step's daily p50 over its
    previous ``trailing_days`` run dates *with data* (a step that ran three
    times last fortnight has a three-day baseline), NULL on its first day.
    ``delta_ratio`` is NULL where the baseline is NULL or zero.
    """
    frame = _prepared(records)
    steps = frame.loc[~frame["_is_summary"] & frame["duration"].notna()].copy()
    steps["duration"] = pd.to_numeric(steps["duration"])
    dims = ["pipeline", "step_address", "run_date"]
    daily = (
        steps.groupby(dims, sort=True)["duration"]
        .agg(
            execution_count="size",
            duration_p50=lambda s: float(s.quantile(0.5)),
            duration_p95=lambda s: float(s.quantile(0.95)),
            duration_max="max",
        )
        .reset_index()
    )
    baselines = []
    for _, group in daily.groupby(["pipeline", "step_address"], sort=False):
        p50 = group["duration_p50"]
        baselines.append(p50.shift(1).rolling(trailing_days, min_periods=1).median())
    daily["trailing_p50_median"] = (
        pd.concat(baselines) if baselines else pd.Series([], dtype="float64")
    )
    daily["delta_seconds"] = daily["duration_p50"] - daily["trailing_p50_median"]
    daily["delta_ratio"] = daily["delta_seconds"] / daily["trailing_p50_median"].where(
        daily["trailing_p50_median"] > 0
    )
    for column in (
        "duration_p50",
        "duration_p95",
        "duration_max",
        "trailing_p50_median",
        "delta_seconds",
        "delta_ratio",
    ):
        daily[column] = daily[column].round(6)
    return _typed(
        daily[[c for c in TREND_COLUMNS if c != AS_OF_COLUMN]],
        as_of=as_of,
        ints=("execution_count",),
        floats=(
            "duration_p50",
            "duration_p95",
            "duration_max",
            "trailing_p50_median",
            "delta_seconds",
            "delta_ratio",
        ),
    )


FLOW_COLUMNS = (
    RUN_ID_COLUMN,
    "pipeline",
    "step_address",
    "run_date",
    "execution_count",
    "rows_in",
    "rows_out",
    "rows_quarantined",
    "rows_excluded",
    "out_ratio",
    "quarantine_ratio",
    AS_OF_COLUMN,
)


def step_row_flow(records: Dataset, *, as_of: str) -> Dataset:
    """The row funnel through each step of each run. **Grain: run_id x
    step_address.** Only steps that reported a row count appear; a count no
    execution reported stays NULL rather than becoming zero."""
    frame = _prepared(records)
    counts = ["rows_in", "rows_out", "rows_quarantined", "rows_excluded"]
    for column in counts:
        frame[column] = pd.to_numeric(frame[column])
    steps = frame.loc[~frame["_is_summary"] & frame[counts].notna().any(axis=1)]
    dims = ["pipeline_run_id", "pipeline", "step_address", "run_date"]
    flow = (
        steps.groupby(dims, sort=True)
        .agg(
            execution_count=("step", "size"),
            **{c: (c, lambda s: s.sum(min_count=1)) for c in counts},
        )
        .reset_index()
        .rename(columns={"pipeline_run_id": RUN_ID_COLUMN})
    )
    rows_in = flow["rows_in"].where(flow["rows_in"] > 0)
    flow["out_ratio"] = (flow["rows_out"] / rows_in).round(6)
    flow["quarantine_ratio"] = (flow["rows_quarantined"] / rows_in).round(6)
    return _typed(
        flow[[c for c in FLOW_COLUMNS if c != AS_OF_COLUMN]],
        as_of=as_of,
        ints=("execution_count",),
        floats=(*counts, "out_ratio", "quarantine_ratio"),
    )
