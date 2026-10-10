"""``python -m cli perf``: pipeline and step durations at a glance.

Reads the ``pipeline_run_metric`` gold tables through their Shared Readers, so
it shows what that pipeline last published: run it first (or schedule it). One
line per pipeline, or per step with ``--steps``, slowest p95 first, with the
change against 28 days earlier and a flag where p90 slowed past a threshold.
Plain ASCII, so it reads the same on a Windows console.
"""

from __future__ import annotations

import argparse
import datetime as dt
import sqlite3
import sys

import pandas as pd

from cli.operator import add_base_dir_args, base_dir_or_report, date
from tools.migrations import MigrationError, MigrationRunner, migrations_directory
from tools.store import StoreRegistry

# A p90 this much slower than 28 days earlier is flagged (0.2 = 20%).
DEFAULT_THRESHOLD = 0.2
# A subject whose figures are this many days older than the newest says when
# it last ran: its percentiles are from then, not now.
STALE_DAYS = 7

_SUBJECT = "pipeline_run_metric"
_GOLD = "gold"

_NOT_BUILT = (
    "no performance tables under {base}; run "
    "`python -m cli run pipelines/pipeline_run_metric --base-dir {base}` first"
)
_BEHIND = (
    "the performance tables in {db} are behind their migrations; run "
    "`python -m cli migrate --base-dir {base}`, then "
    "`python -m cli run pipelines/pipeline_run_metric --base-dir {base}`"
)


def _not_built_message(base_dir) -> str:
    """Why the tables could not be read, and what to run about it.

    A gold database that exists but has migrations pending (a table or column
    this command reads is not there yet) needs ``migrate``: running the metric
    pipeline against it would itself fail at the write.
    """
    db = StoreRegistry(base_dir).db_file(f"{_SUBJECT}/{_GOLD}")
    if db.exists():
        runner = MigrationRunner(db, migrations_directory(_SUBJECT, _GOLD))
        try:
            behind = bool(runner.pending())
        except MigrationError:
            behind = True
        if behind:
            return _BEHIND.format(db=db, base=base_dir)
    return _NOT_BUILT.format(base=base_dir)


def _at_least_one(value: str) -> int:
    """An argparse ``type``: a whole number of 1 or more."""
    try:
        number = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            f"expected a whole number, got {value!r}"
        ) from exc
    if number < 1:
        raise argparse.ArgumentTypeError(f"expected 1 or more, got {number}")
    return number


def _seconds(value: object) -> str:
    """A duration short enough for a column: ``850ms``, ``42.0s``, ``9m12s``."""
    if value is None or pd.isna(value):
        return "-"
    seconds = float(value)
    if seconds < 1:
        return f"{seconds * 1000:.0f}ms"
    if seconds < 60:
        return f"{seconds:.1f}s"
    minutes, rest = divmod(round(seconds), 60)
    if minutes < 60:
        return f"{minutes}m{rest:02d}s"
    hours, minutes = divmod(minutes, 60)
    return f"{hours}h{minutes:02d}m"


def _ratio(value: object) -> str:
    if value is None or pd.isna(value):
        return "-"
    return f"{float(value):+.0%}"


def _share(value: object) -> str:
    if value is None or pd.isna(value):
        return "-"
    return f"{float(value):.0%}"


def _clock(seconds_after_midnight: object) -> str:
    """Seconds after the run date's local midnight as ``HH:MM`` (``+1d`` past it)."""
    if seconds_after_midnight is None or pd.isna(seconds_after_midnight):
        return "-"
    days, rest = divmod(round(float(seconds_after_midnight)), 86400)
    hours, rest = divmod(rest, 3600)
    clock = f"{hours:02d}:{rest // 60:02d}"
    return clock if days == 0 else f"{clock} {days:+d}d"


def _read(reader) -> pd.DataFrame | None:
    """The table a Shared Reader serves, or None when it has not been built."""
    try:
        return reader.read().to_pandas()
    except (sqlite3.Error, pd.errors.DatabaseError):
        return None


def _latest(frame: pd.DataFrame, as_of: dt.date | None) -> pd.DataFrame:
    """Each subject's latest row on or before ``as_of`` (default: the newest)."""
    if as_of is not None:
        frame = frame.loc[frame["as_of_date"] <= as_of.isoformat()]
    frame = frame.sort_values("as_of_date", kind="stable")
    return frame.drop_duplicates(["pipeline", "step_address"], keep="last")


def batch_line(batches: pd.DataFrame, as_of: dt.date | None) -> str | None:
    """One line on the latest scheduled batch, or None if nothing was scheduled."""
    if as_of is not None:
        batches = batches.loc[batches["run_date"] <= as_of.isoformat()]
    if batches.empty:
        return None
    batch = batches.sort_values("run_date").iloc[-1]
    parts = [
        f"Batch {batch['run_date']} finished "
        f"{_clock(batch['finished_after_midnight_seconds'])} "
        f"(28-day p50 {_clock(batch['finish_p50_28d'])}, "
        f"p90 {_clock(batch['finish_p90_28d'])})",
        f"{int(batch['items_run'])} run, {int(batch['items_failed'])} failed, "
        f"{int(batch['items_blocked'])} blocked",
        f"longest queue {_seconds(batch['queue_wait_max_seconds'])}",
    ]
    return "; ".join(parts)


def perf_table(
    percentiles: pd.DataFrame,
    *,
    window: int,
    steps: bool,
    pipeline: str | None = None,
    as_of: dt.date | None = None,
    threshold: float = DEFAULT_THRESHOLD,
    limit: int | None = None,
) -> list[str]:
    """The lines ``perf`` prints for one window and level, slowest p95 first."""
    level = "step" if steps else "pipeline"
    frame = percentiles.loc[
        percentiles["level"].eq(level) & percentiles["window_days"].eq(window)
    ]
    if pipeline is not None:
        frame = frame.loc[frame["pipeline"].eq(pipeline)]
    frame = _latest(frame, as_of)
    if frame.empty:
        return []

    newest = frame["as_of_date"].max()
    stale_before = (
        dt.date.fromisoformat(newest) - dt.timedelta(days=STALE_DAYS)
    ).isoformat()
    # Sort by the highest percentile there are samples for.
    slowest = (
        frame["duration_p95"]
        .fillna(frame["duration_p90"])
        .fillna(frame["duration_p50"])
        .fillna(-1)
    )
    frame = frame.assign(_slowest=slowest).sort_values(
        ["_slowest", "pipeline", "step_address"],
        ascending=[False, True, True],
        kind="stable",
    )
    if limit is not None:
        frame = frame.head(limit)

    name = "step_address" if steps else "pipeline"
    header = (
        name.replace("_", " "),
        "n",
        "p50",
        "p90",
        "p95",
        "max",
        "p50 chg",
        "p90 chg",
        "fail",
        "retry",
        "",
    )
    rows = []
    for row in frame.to_dict(orient="records"):
        notes = []
        change = row["p90_change_ratio_28d"]
        if change is not None and not pd.isna(change) and change > threshold:
            notes.append("SLOWER")
        if row["as_of_date"] < stale_before:
            notes.append(f"last ran {row['as_of_date']}")
        rows.append(
            (
                str(row[name]),
                str(int(row["ok_count"])),
                _seconds(row["duration_p50"]),
                _seconds(row["duration_p90"]),
                _seconds(row["duration_p95"]),
                _seconds(row["duration_max"]),
                _ratio(row["p50_change_ratio_28d"]),
                _ratio(change),
                _share(row["failure_rate"]),
                _share(row["retry_rate"]),
                " ".join(notes),
            )
        )
    widths = [max(len(r[i]) for r in (header, *rows)) for i in range(len(header))]
    lines = [
        f"{level.capitalize()}s over the {window} days to {newest}, slowest p95 first"
        f" (SLOWER: p90 up more than {threshold:.0%} on 28 days earlier):",
    ]
    for cells in (header, *rows):
        aligned = [
            cell.ljust(widths[i]) if i == 0 else cell.rjust(widths[i])
            for i, cell in enumerate(cells[:-1])
        ]
        lines.append("  ".join(aligned + [cells[-1]]).rstrip())
    return lines


def _perf(args: argparse.Namespace) -> int:
    from readers.pipeline_run_metric import BatchFinishReader, DurationPercentilesReader

    base_dir = base_dir_or_report(args)
    if base_dir is None:
        return 1
    percentiles = _read(DurationPercentilesReader(base_dir))
    if percentiles is None:
        print(_not_built_message(base_dir), file=sys.stderr)
        return 1
    batches = _read(BatchFinishReader(base_dir))
    if batches is not None:
        line = batch_line(batches, args.as_of)
        if line is not None:
            print(line)
            print()
    lines = perf_table(
        percentiles,
        window=args.window,
        steps=args.steps,
        pipeline=args.pipeline,
        as_of=args.as_of,
        threshold=args.threshold,
        limit=args.limit,
    )
    print("\n".join(lines) if lines else "no matching pipelines")
    return 0


def register(sub) -> None:
    perf = sub.add_parser(
        "perf",
        help="pipeline and step duration percentiles at a glance",
        description="Show p50/p90/p95 durations per pipeline (or per step), "
        "slowest first, from the pipeline_run_metric tables.",
    )
    add_base_dir_args(perf)
    perf.add_argument(
        "--steps", action="store_true", help="one line per step, not per pipeline"
    )
    perf.add_argument("--pipeline", help="only this pipeline (and its steps)")
    perf.add_argument(
        "--window",
        type=int,
        choices=(28, 90),
        default=28,
        help="days the percentiles are taken over (default 28)",
    )
    perf.add_argument(
        "--as-of",
        dest="as_of",
        type=date,
        default=None,
        help="show the figures as they stood on this date (YYYY-MM-DD)",
    )
    perf.add_argument(
        "--threshold",
        type=float,
        default=DEFAULT_THRESHOLD,
        help="flag a p90 this much slower than 28 days earlier (default 0.2)",
    )
    perf.add_argument(
        "--limit", type=_at_least_one, default=None, help="show at most N lines"
    )
    perf.set_defaults(func=_perf)
