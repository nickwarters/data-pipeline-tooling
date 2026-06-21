```python
"""Case Type ingest for the ``myfeed`` feed: source -> raw -> silver.

Unlike the generic feed scaffold, this feed's rows are Cases: it declares the
identity contract in ``case_type.py`` and refines the feed through source -> raw
(a faithful, accumulated copy) -> silver (schema coerced + validated).

It deliberately **stops at silver**. How accumulated silver is reduced/assembled
into gold — a single-feed current reduce, a multi-feed join enriching one Case
Type, Detail Tables — is unique per Case Type, so the gold step is left to you.
Its shape is sketched at the foot of ``run``.

Address it by its location on disk -- the framework imports
``pipelines.myfeed.pipeline`` and runs its ``run(context)`` callable::

    python -m cli run pipelines/myfeed [BASE_DIR]

or run the module directly with a default run context::

    python -m pipelines.myfeed.pipeline [BASE_DIR]

Both run from the repo root so the import-only ``framework`` package resolves on
``sys.path``.
"""

from __future__ import annotations

import sys
from pathlib import Path

from framework.core import (
    RAW,
    SILVER,
    Dataset,
    PipelineError,
    SchemaValidator,
    format_failure,
)
from framework.io import AccumulateByRun, CsvReader, StoreCatalog
from framework.run import Pipeline, RunContext
from framework.transform import Filter, SchemaCoercion

from .case_type import CASE_TYPE

FEED_NAME = "myfeed"
SAMPLE_CSV = Path(__file__).parent / "sample_data" / "myfeed.csv"

# Pipelines this feed depends on being fresh before it runs (a tuple of
# ``framework.run.FreshnessRequirement``). A source ingest has none.
UPSTREAMS = ()


def run(context: RunContext) -> Dataset:
    """Refine the feed source -> raw -> silver under the run context; return silver.

    raw accumulates a faithful copy of the source (the system of record); silver
    accumulates the schema-coerced, schema-validated record. Identity is declared
    on the Case Type (``case_type.py``), ready for the gold step you add. The
    accumulation strategy is derived from the ``RunContext``, so a re-run under the
    same logical run id (``--logical-run-id``) replaces that business run's rows.
    """
    store = StoreCatalog(context.base_dir).store(FEED_NAME)
    # Raw + silver accumulate the change-over-time record under one logical run
    # id so re-drives replace the intended business run.
    strategy = AccumulateByRun.from_context(context)

    p = Pipeline(FEED_NAME)
    r = p.read(CsvReader(SAMPLE_CSV), name="read")
    p.write(store.writer(RAW, FEED_NAME, strategy), r, name="write")
    p.run()

    p_silver = Pipeline(FEED_NAME)
    r_silver = p_silver.read(store.reader(RAW, FEED_NAME), name="read")
    current = r_silver
    if isinstance(strategy, AccumulateByRun):
        run_id = strategy.run_id
        current = p_silver.transform(
            Filter(lambda row, _rid=run_id: row["run_id"] == _rid),
            current,
            name="filter-by-run-id",
        )
    coerced = p_silver.transform(
        SchemaCoercion(CASE_TYPE.schema), current, name="coerce"
    )
    validated = p_silver.validate(
        SchemaValidator(CASE_TYPE.schema), coerced, name="post-validate"
    )
    p_silver.write(store.writer(SILVER, FEED_NAME, strategy), validated, name="write")
    silver = p_silver.run()

    # --- gold is yours to assemble ------------------------------------------
    # How accumulated silver becomes gold is unique per Case Type, so the
    # scaffold stops at silver. When you're ready, add a gold step reading
    # the same Case Type so its case_id derives consistently with any Detail
    # Tables:
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

    from framework.run import PipelineRunner

    # The Case Type's name is the medallion subject, so the run records to
    # <base_dir>/_runs/<CASE_TYPE.name>.log. Pass run_log=RunLog(path) to register
    # to redirect it; omit it for that default.
    runner = PipelineRunner()
    runner.register(
        subject=CASE_TYPE.name,
        pipeline=FEED_NAME,
        handler=run,
        freshness=UPSTREAMS,
    )

    try:
        silver = runner.run(CASE_TYPE.name, FEED_NAME, base_dir=base_dir)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1

    print(
        f"Refined {len(silver)} rows source -> raw -> silver for Case Type "
        f"'{CASE_TYPE.name}' under {Path(base_dir) / FEED_NAME} "
        f"(layers {RAW}, {SILVER}); add your gold step next (see pipeline.py)."
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))

```
