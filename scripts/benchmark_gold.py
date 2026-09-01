#!/usr/bin/env python3
"""Benchmark one ``sharepoint_cases`` gold publication.

Measures the silver read, current-state reduction, and current aggregates on
synthetic data; Detail Table aggregates are excluded. See
``docs/benchmarking-gold.md``.
"""

from __future__ import annotations

import argparse
import datetime as dt
import shutil
import sys
import time
from dataclasses import dataclass
from functools import partial
from pathlib import Path

import pandas as pd

from framework.core import Dataset
from framework.io import DatasetReader, Refresh
from framework.run import read, transform, write
from framework.transform import Stamp
from pipelines.sharepoint_cases.gold import (
    AS_OF_COLUMN,
    CURRENT_TABLE,
    SILVER_TABLE,
    age_buckets,
    case_counts,
    throughput,
    to_gold_case_current,
)
from pipelines.sharepoint_cases.schema import CASE_STATUSES, FEED_NAME
from tools.medallion import medallion
from tools.store import StoreRegistry

# Fixed so a re-run measures the machine rather than a different clock.
AS_OF = dt.datetime(2026, 1, 1, 9, 0, tzinfo=dt.timezone.utc)

REVIEWERS = tuple(f"i:0#.f|membership|reviewer{n}@example.com" for n in range(40))
MANAGERS = tuple(f"i:0#.f|membership|manager{n}@example.com" for n in range(8))

# lists x cases-per-list x versions-per-case, in growing order.
SWEEP = (
    (1, 5_000, 4),
    (8, 5_000, 4),
    (8, 5_000, 10),
    (8, 5_000, 20),
    (8, 10_000, 20),
)


@dataclass(frozen=True)
class Timing:
    """One measured publication."""

    silver_rows: int
    cases: int
    seed_seconds: float
    read_seconds: float
    current_seconds: float
    aggregate_seconds: float

    @property
    def total_seconds(self) -> float:
        return self.current_seconds + self.aggregate_seconds


def synthetic_silver(*, lists: int, cases: int, versions: int) -> pd.DataFrame:
    """A silver history shaped like the real one: one row per observation.

    Statuses, reviewers and ages are spread across the rows so the aggregates
    have something to group; the exact distribution is arbitrary.
    """
    rows = []
    for list_index in range(lists):
        case_type = f"case-type-{list_index}"
        list_name = f"Cases-Type{list_index}"
        for case_index in range(cases):
            status = CASE_STATUSES[(list_index + case_index) % len(CASE_STATUSES)]
            created = AS_OF - dt.timedelta(days=(case_index % 400) + 1)
            ended = AS_OF - dt.timedelta(days=case_index % 30)
            for version in range(versions):
                rows.append(
                    {
                        "source_observation_id": f"{list_index}:{case_index}:{version}",
                        "source_list_name": list_name,
                        "source_item_id": str(case_index + 1),
                        "source_version": f"{version + 1}.0",
                        "source_modified_at": created + dt.timedelta(hours=version),
                        "id": case_index + 1,
                        "title": f"CASE-{list_index}-{case_index}",
                        "case_type": case_type,
                        "status": status,
                        "assigned_reviewer_name": REVIEWERS[
                            case_index % len(REVIEWERS)
                        ],
                        "assigned_at": created,
                        "responsible_party_name": "rp@example.com",
                        "responsible_party_title": "Responsible Party",
                        "assigned_reviewer_manager_name": MANAGERS[
                            case_index % len(MANAGERS)
                        ],
                        "responsible_party_manager_name": MANAGERS[
                            case_index % len(MANAGERS)
                        ],
                        "due_date": created + dt.timedelta(days=30),
                        "completed_at": ended if status == "Completed" else pd.NaT,
                        "reportable_at": pd.NaT,
                        "remediation_due_date": pd.NaT,
                        "related_date": pd.NaT,
                        "created": created,
                        "has_open_appeal": False,
                        "appeal_raised_at": pd.NaT,
                        "awaiting_responsible_party": False,
                        "awaiting_since": pd.NaT,
                        "review_required": False,
                        "on_hold": False,
                        "placed_on_hold_at": pd.NaT,
                        "voided_at": ended if status == "Void" else pd.NaT,
                        "void_reason": "",
                        "void_reason_note": "",
                        "voided_by_name": "",
                        "outcome": "Fair",
                        "outcome_at_completion": "Fair",
                        "had_remediation": False,
                        "effective_outcome": "Fair",
                        "effective_had_remediation": False,
                        "outcome_overridden": False,
                        "question_bank_version": "1.0.0",
                        "case_justification": "",
                        "notes": "",
                        "answers": "{}",
                        "conversation": "[]",
                        "appeals": "[]",
                        "amended_outcome": "",
                        "details": "{}",
                    }
                )
    return pd.DataFrame(rows)


def publish_aggregates(med, current: Dataset, *, as_of: dt.datetime) -> None:
    """Mirror the four ``case_current``-sourced aggregates from ``gold.publish_gold``;
    the Detail-Table-sourced aggregates are out of scope since this script never
    builds the Detail Tables.
    """
    for table, step, reduce in (
        ("case_counts_current", "count-by-base-grain-and-status", case_counts),
        (
            "case_age_buckets_current",
            "bucket-by-age",
            partial(age_buckets, as_of=as_of),
        ),
        (
            "case_age_from_assigned_buckets_current",
            "bucket-by-age-from-assigned",
            partial(age_buckets, as_of=as_of, age_from="assigned_at"),
        ),
        ("case_throughput_daily", "count-by-terminal-date", throughput),
    ):
        at = f"gold:{table}"
        data = read(DatasetReader(current), name=f"{at}:read")
        data = transform(reduce, data, name=f"{at}:{step}")
        data = transform(
            Stamp(AS_OF_COLUMN, as_of.isoformat()), data, name=f"{at}:stamp-as-of"
        )
        write(med.gold.writer(table, Refresh()), data, name=f"{at}:write")


def measure(base_dir: Path, *, lists: int, cases: int, versions: int) -> Timing:
    """Seed a silver history under ``base_dir`` and time one gold publication."""
    frame = synthetic_silver(lists=lists, cases=cases, versions=versions)
    med = medallion(StoreRegistry(base_dir), FEED_NAME)

    started = time.perf_counter()
    med.silver.writer(SILVER_TABLE, Refresh()).write(Dataset.from_pandas(frame))
    seed_seconds = time.perf_counter() - started

    # A warm pass first, so the timed one measures steady state rather than the
    # first touch of a freshly written database.
    current = to_gold_case_current(
        med.silver.reader(SILVER_TABLE),
        med.gold.writer(CURRENT_TABLE, Refresh()),
        as_of=AS_OF,
    )
    publish_aggregates(med, current, as_of=AS_OF)

    # Reading silver off disk, on its own. Measured separately from the step it
    # belongs to, so a slow share shows up as a number rather than as a slower
    # total with no explanation.
    started = time.perf_counter()
    med.silver.reader(SILVER_TABLE).read()
    read_seconds = time.perf_counter() - started

    started = time.perf_counter()
    current = to_gold_case_current(
        med.silver.reader(SILVER_TABLE),
        med.gold.writer(CURRENT_TABLE, Refresh()),
        as_of=AS_OF,
    )
    current_seconds = time.perf_counter() - started

    started = time.perf_counter()
    publish_aggregates(med, current, as_of=AS_OF)
    aggregate_seconds = time.perf_counter() - started

    return Timing(
        silver_rows=len(frame),
        cases=len(current),
        seed_seconds=seed_seconds,
        read_seconds=read_seconds,
        current_seconds=current_seconds,
        aggregate_seconds=aggregate_seconds,
    )


HEADER = (
    f"{'lists x cases x versions':<26} {'silver rows':>12} {'cases':>8} "
    f"{'seed':>8} {'read':>8} {'case_current':>13} {'aggregates':>11} "
    f"{'total':>8} {'agg %':>7}"
)


def format_row(label: str, timing: Timing) -> str:
    share = 100 * timing.aggregate_seconds / timing.total_seconds
    return (
        f"{label:<26} {timing.silver_rows:>12,} {timing.cases:>8,} "
        f"{timing.seed_seconds:>7.2f}s {timing.read_seconds:>7.2f}s "
        f"{timing.current_seconds:>12.2f}s {timing.aggregate_seconds:>10.2f}s "
        f"{timing.total_seconds:>7.2f}s {share:>6.1f}%"
    )


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m scripts.benchmark_gold",
        description="Time one gold publication of the sharepoint_cases feed.",
    )
    parser.add_argument(
        "--base-dir",
        required=True,
        help="where to write the medallion databases; point this at a network "
        "share to measure that share",
    )
    parser.add_argument("--lists", type=int, default=8, help="Case lists (default 8)")
    parser.add_argument(
        "--cases", type=int, default=5_000, help="Cases per list (default 5000)"
    )
    parser.add_argument(
        "--versions", type=int, default=10, help="versions per Case (default 10)"
    )
    parser.add_argument(
        "--sweep",
        action="store_true",
        help="run a ladder of growing scenarios instead of a single point",
    )
    parser.add_argument(
        "--keep",
        action="store_true",
        help="leave the generated databases behind instead of deleting them",
    )
    args = parser.parse_args(argv[1:])

    scenarios = SWEEP if args.sweep else ((args.lists, args.cases, args.versions),)

    # Everything is written inside one subdirectory we create, so the cleanup
    # below can never remove anything that was already in --base-dir.
    root = Path(args.base_dir).expanduser() / "benchmark_gold"
    if root.exists():
        print(f"{root} already exists; remove it or choose another --base-dir.")
        return 1
    root.mkdir(parents=True)

    print(f"Writing to {root}")
    print(HEADER)
    print("-" * len(HEADER))
    try:
        for lists, cases, versions in scenarios:
            scenario_dir = root / f"s{lists}x{cases}x{versions}"
            try:
                timing = measure(
                    scenario_dir, lists=lists, cases=cases, versions=versions
                )
                print(format_row(f"{lists} x {cases:,} x {versions}", timing))
            finally:
                # Freed as we go rather than at the end: a sweep's largest
                # scenario is most of a gigabyte, and a share is a poor place to
                # park every earlier one while the next runs.
                if not args.keep:
                    shutil.rmtree(scenario_dir, ignore_errors=True)
    finally:
        if args.keep:
            print(f"\nLeft in place: {root}")
        else:
            shutil.rmtree(root, ignore_errors=True)

    print(
        "\n'read' is silver off disk, and is part of 'case_current' rather than "
        "additional to it.\nOn a share it is usually most of the cost. "
        "'seed' is this script writing the test data,\nnot something a real run "
        "does."
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))
