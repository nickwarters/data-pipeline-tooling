"""Domain Pipeline runner CLI.

Run from the repository root so the import-only ``framework`` package resolves:

    python -m pipelines.run cases ingest /tmp/demo
    python -m pipelines.run cases selection /tmp/demo --run-date 2026-05-29
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys
from pathlib import Path

from framework.run import FreshnessError, UnknownPipelineError
from pipelines.demo_source_to_selection import build_runner


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m pipelines.run")
    parser.add_argument("case_type")
    parser.add_argument("pipeline")
    parser.add_argument("base_dir")
    parser.add_argument("--run-date", type=_date, default=dt.date.today())
    parser.add_argument("--freshness-days", type=int, default=0)
    args = parser.parse_args(argv)

    runner = build_runner()
    try:
        runner.run(
            args.case_type,
            args.pipeline,
            Path(args.base_dir),
            run_date=args.run_date,
            freshness_days=args.freshness_days,
        )
    except (FreshnessError, UnknownPipelineError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


def _date(value: str) -> dt.date:
    try:
        return dt.date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            f"expected YYYY-MM-DD date, got {value!r}"
        ) from exc


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main())
