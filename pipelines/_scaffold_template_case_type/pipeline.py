"""Case Type ingest for the ``myfeed`` feed: source -> raw -> silver.

The Case-Type-flavoured ingest slice (issue #155). Unlike the generic feed
scaffold (source -> raw, case-review-agnostic), this feed's rows *are* a Case
Type: it declares the identity contract in ``case_type.py`` (``natural_key`` ->
derived ``namespace`` + deterministic ``case_id``, ADR-0009) and refines the feed
through the settled ingest spine — source -> raw (a faithful, accumulated copy,
the system of record) -> silver (schema coerced + validated, accumulated).

It deliberately **stops at silver**. How accumulated silver is reduced/assembled
into gold — a single-feed current reduce, a multi-feed join enriching one Case
Type, Detail Tables — is unique per Case Type and is an open design decision
(snapshot-vs-join, single- vs multi-feed — issue #163), so the gold step is left
to you. Its shape is sketched (commented) at the foot of ``run`` with pointers.

Run it as a module from the repo root so the import-only ``framework`` package
resolves on ``sys.path``::

    python -m pipelines.myfeed.pipeline [BASE_DIR]
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from framework.io import RAW, SILVER, AccumulateByRun, CsvReader, Dataset, StoreCatalog
from framework.run import Pipeline, raw_to_silver

from .case_type import CASE_TYPE

FEED_NAME = "myfeed"
SAMPLE_CSV = Path(__file__).parent / "sample_data" / "myfeed.csv"

# A fixed logical run id so the bundled sample is deterministic and idempotent
# (re-running replaces the same run — ADR-0006). A real feed derives this per run,
# e.g. ``AccumulateByRun.from_context(context)`` under a ``PipelineRunner`` (see
# ``pipelines/demo_source_to_selection.py``).
RUN_ID = "2026-01-01"


def run(
    base_dir: str | os.PathLike[str],
    csv_path: str | os.PathLike[str] = SAMPLE_CSV,
) -> Dataset:
    """Refine the feed source -> raw -> silver under ``base_dir``; return silver.

    raw accumulates a faithful copy of the source (the system of record); silver
    accumulates the schema-coerced, schema-validated record. Identity is declared
    on the Case Type (``case_type.py``), ready for the gold step you add.
    """
    store = StoreCatalog(base_dir).store(FEED_NAME)
    # History-upstream Ingest profile: raw + silver accumulate the change-over-
    # time record under one logical run id (ADR-0006 amendment).
    strategy = AccumulateByRun(RUN_ID, RUN_ID)

    # source -> raw: land a faithful copy of the feed (accumulated).
    Pipeline(FEED_NAME, CsvReader(csv_path)).write_to(
        store.writer(RAW, FEED_NAME, strategy)
    ).run()

    # raw -> silver: coerce + validate against the Case Type's schema (accumulated).
    silver = raw_to_silver(
        store, FEED_NAME, CASE_TYPE.schema, strategy=strategy
    ).run()

    # --- gold is yours to assemble ------------------------------------------
    # How accumulated silver becomes gold is unique per Case Type and is an open
    # design decision (snapshot-vs-join / single- vs multi-feed enrichment —
    # issue #163), so the scaffold stops at silver. When you're ready, add a gold
    # step reading the SAME Case Type, so its identity (case_id) derives
    # consistently with any Detail Tables (ADR-0009):
    #
    #     from case_review.gold import ingest_silver_to_gold
    #     ingest_silver_to_gold(store, CASE_TYPE).run()   # single-feed current gold
    #
    # For a Detail Table (repeated sections / child rows at a finer grain), see
    # ``case_review.gold.detail_ingest_silver_to_gold`` and
    # ``pipelines/demo_fan_out.py``.
    # ------------------------------------------------------------------------
    return silver


def main(argv: list[str]) -> int:
    base_dir = Path(argv[1]) if len(argv) > 1 else Path.cwd() / "data"
    silver = run(base_dir)
    print(
        f"Refined {len(silver)} rows source -> raw -> silver for Case Type "
        f"'{CASE_TYPE.name}' under {Path(base_dir) / FEED_NAME} "
        f"(layers {RAW}, {SILVER}); add your gold step next (see pipeline.py)."
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))
