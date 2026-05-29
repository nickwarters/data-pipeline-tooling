"""Walking-skeleton demo: read a CSV feed and land it in the raw layer.

The thinnest end-to-end path through the framework. Run it as a module from the
repo root (so the import-only ``framework`` package resolves on ``sys.path``) to
write ``raw.db`` under a data directory, or import ``run`` to drive it from a
test.

    python -m pipelines.demo_csv_to_raw [BASE_DIR]
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from framework.builder import Pipeline
from framework.data_handle import DataHandle
from framework.readers import CsvReader
from framework.writers import SqliteTruncateReloadWriter

FEED_NAME = "cases"
SAMPLE_CSV = Path(__file__).parent / "sample_data" / "cases.csv"


def run(
    base_dir: str | os.PathLike[str],
    csv_path: str | os.PathLike[str] = SAMPLE_CSV,
) -> DataHandle:
    """Land the CSV feed into ``raw.db`` under ``base_dir``; return the rows."""
    writer = SqliteTruncateReloadWriter(Path(base_dir) / "raw.db", FEED_NAME)
    return Pipeline(FEED_NAME, CsvReader(csv_path)).write_to(writer).run()


def main(argv: list[str]) -> int:
    base_dir = Path(argv[1]) if len(argv) > 1 else Path(__file__).parent.parent / "data"
    base_dir.mkdir(parents=True, exist_ok=True)

    handle = run(base_dir)
    print(
        f"Landed {len(handle)} rows into "
        f"{base_dir / 'raw.db'} (table '{FEED_NAME}')"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
