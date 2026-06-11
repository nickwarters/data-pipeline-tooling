"""Walking-skeleton demo: read a CSV feed and land it in the raw layer.

The thinnest end-to-end path through the framework. ``base_dir`` is the
medallion root; the demo asks a ``StoreCatalog`` for the ``cases`` subject's
Store, which lands ``raw.db`` under that subject directory. Run it as a module
from the repo root (so the import-only ``framework`` package resolves on
``sys.path``), or import ``run`` from a test.

    python -m pipelines.demo_csv_to_raw [BASE_DIR]
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from framework.io import RAW, CsvReader, Dataset, Refresh, StoreCatalog
from framework.run import Pipeline, RunLog
from framework.transform import SchemaDriftValidator

FEED_NAME = "cases"
SAMPLE_CSV = Path(__file__).parent / "sample_data" / "cases.csv"
RUN_LOG_NAME = "runs.log"


def run(
    base_dir: str | os.PathLike[str],
    csv_path: str | os.PathLike[str] = SAMPLE_CSV,
) -> Dataset:
    """Land the CSV feed into the subject's ``raw.db`` under ``base_dir``.

    Composes a :class:`RunLog` so the run emits structured JSONL records to
    ``<base_dir>/runs.log`` and human-readable lines to the console.

    A warn-severity :class:`SchemaDriftValidator` is attached at the raw boundary
    because the source owner can add or drop columns outside this pipeline's
    control. It diffs incoming columns against the prior landed columns and warns
    without aborting. The first run has no prior landing, so it is a clean no-op.
    """
    store = StoreCatalog(base_dir).store(FEED_NAME)
    writer = store.writer(RAW, FEED_NAME, Refresh())
    run_log = RunLog(Path(base_dir) / RUN_LOG_NAME)
    return (
        Pipeline(FEED_NAME, CsvReader(csv_path), run_log=run_log)
        .with_validator(
            SchemaDriftValidator(store.columns_of(RAW, FEED_NAME)), severity="warn"
        )
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
        f"{Path(base_dir) / FEED_NAME / 'raw.db'} (table '{FEED_NAME}'); "
        f"run log at {Path(base_dir) / RUN_LOG_NAME}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
