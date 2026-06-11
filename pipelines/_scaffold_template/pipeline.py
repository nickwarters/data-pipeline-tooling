"""Ingest pipeline for the ``myfeed`` feed: a CSV source landed into raw.

The thinnest source -> raw path, composed entirely through the public facades
(``framework.io`` / ``framework.transform`` / ``framework.run``) -- no engine
types and no case-review assumptions. Swap ``CsvReader`` for another Reader
(``ExcelReader``, ``GlobCsvReader``, ``SqliteReader``, ...) to ingest the same
feed from a different source; the rest of the pipeline is unchanged.

Run it as a module from the repo root so the import-only ``framework`` package
resolves on ``sys.path``::

    python -m pipelines.myfeed.pipeline [BASE_DIR]
"""

from __future__ import annotations

import os
import sys
from dataclasses import fields
from pathlib import Path

from framework.io import RAW, CsvReader, Dataset, Refresh, StoreCatalog
from framework.run import Pipeline
from framework.transform import ColumnValidator

from .schema import MyfeedRow

FEED_NAME = "myfeed"
SAMPLE_CSV = Path(__file__).parent / "sample_data" / "myfeed.csv"


def run(
    base_dir: str | os.PathLike[str],
    csv_path: str | os.PathLike[str] = SAMPLE_CSV,
) -> Dataset:
    """Land the CSV feed into the subject's ``raw.db`` under ``base_dir``.

    A ``ColumnValidator`` gates the feed at the door: every column the schema
    declares must be present before any row is landed (an error-severity breach
    aborts the run fail-fast).
    """
    store = StoreCatalog(base_dir).store(FEED_NAME)
    return (
        Pipeline(FEED_NAME, CsvReader(csv_path))
        .with_validator(ColumnValidator([f.name for f in fields(MyfeedRow)]))
        .write_to(store.writer(RAW, FEED_NAME, Refresh()))
        .run()
    )


def main(argv: list[str]) -> int:
    base_dir = Path(argv[1]) if len(argv) > 1 else Path.cwd() / "data"
    dataset = run(base_dir)
    print(
        f"Landed {len(dataset)} rows into "
        f"{Path(base_dir) / FEED_NAME / 'raw.db'} (table '{FEED_NAME}')"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))
