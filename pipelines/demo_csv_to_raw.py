"""Walking-skeleton demo: read a CSV feed and land it in the raw layer.

The thinnest end-to-end path through the framework. ``base_dir`` is the
``cases`` subject's medallion directory; the demo mints its raw Writer from a
per-subject ``Store`` (ADR-0001 amendment), which lands ``raw.db`` under that
directory. Run it as a module from the repo root (so the import-only
``framework`` package resolves on ``sys.path``), or import ``run`` from a test.

    python -m pipelines.demo_csv_to_raw [BASE_DIR]
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from framework.builder import Pipeline
from framework.dataset import Dataset
from framework.readers import CsvReader
from framework.run_log import RunLog
from framework.store import Store

FEED_NAME = "cases"
SAMPLE_CSV = Path(__file__).parent / "sample_data" / "cases.csv"
RUN_LOG_NAME = "runs.log"


def run(
    base_dir: str | os.PathLike[str],
    csv_path: str | os.PathLike[str] = SAMPLE_CSV,
) -> Dataset:
    """Land the CSV feed into ``raw.db`` under ``base_dir``; return the rows.

    Composes a :class:`RunLog` so the run emits structured JSONL records to
    ``<base_dir>/runs.log`` (and human-readable lines to the console) — the
    observability seam described in ADR-0007.
    """
    writer = Store(base_dir).writer("raw", FEED_NAME)
    run_log = RunLog(Path(base_dir) / RUN_LOG_NAME)
    return (
        Pipeline(FEED_NAME, CsvReader(csv_path), run_log=run_log)
        .write_to(writer)
        .run()
    )


def main(argv: list[str]) -> int:
    # Configure logging at the entry point (never in library code) so the
    # RunLog's human-readable per-step lines surface on the console.
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    base_dir = Path(argv[1]) if len(argv) > 1 else Path(__file__).parent.parent / "data"

    dataset = run(base_dir)
    print(
        f"Landed {len(dataset)} rows into "
        f"{Path(base_dir) / 'raw.db'} (table '{FEED_NAME}'); "
        f"run log at {Path(base_dir) / RUN_LOG_NAME}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
