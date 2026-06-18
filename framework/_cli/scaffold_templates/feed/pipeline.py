"""Ingest pipeline for the ``myfeed`` feed: a CSV source landed into raw.

The thinnest source -> raw path, composed entirely through the public facades
(``framework.io`` / ``framework.transform`` / ``framework.run``) -- no engine
types and no case-review assumptions. Swap ``CsvReader`` for another Reader
(``ExcelReader``, ``GlobCsvReader``, ``SqliteReader``, ...) to ingest the same
feed from a different source; the rest of the pipeline is unchanged.

Address it by its location on disk -- the framework imports
``pipelines.myfeed.pipeline`` and runs its ``run(context)`` callable::

    python -m framework run pipelines/myfeed [BASE_DIR]

or run the module directly with a default run context::

    python -m pipelines.myfeed.pipeline [BASE_DIR]

Both run from the repo root so the import-only ``framework`` package resolves on
``sys.path``.
"""

from __future__ import annotations

import sys
from dataclasses import fields
from pathlib import Path

from framework.core import RAW, Dataset, PipelineError, format_failure
from framework.io import AccumulateByRun, CsvReader, Reader, StoreCatalog, Writer
from framework.run import Pipeline, RunContext, RunLog
from framework.validate import ColumnValidator

from .schema import MyfeedRow

FEED_NAME = "myfeed"
SAMPLE_CSV = Path(__file__).parent / "sample_data" / "myfeed.csv"

# Pipelines this feed depends on being fresh before it runs (a tuple of
# ``framework.run.FreshnessRequirement``). A source feed has none.
UPSTREAMS = ()


def builder(
    reader: Reader,
    writer: Writer,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Compose the feed pipeline over the given Reader/Writer (not yet run).

    This is the *one* definition of what the feed does: read the source, gate it
    with a ``ColumnValidator`` (every column the schema declares must be present
    before any row is landed — an error-severity breach aborts fail-fast), and
    write the result. ``run()`` wires the real source/destination; tests call
    this same builder with sample rows and a recording writer, so the first test
    drives the actual pipeline rather than a rebuild of it.
    """
    return (
        Pipeline(FEED_NAME, reader, run_log)
        .with_validator(ColumnValidator([f.name for f in fields(MyfeedRow)]))
        .write_to(writer)
    )


def run(context: RunContext) -> Dataset:
    """Land the CSV feed into the subject's ``raw.db`` under the run context.

    Wires the real Reader/Writer for the bundled CSV source and runs the pipeline
    composed by ``builder``. The accumulation strategy is derived from the
    ``RunContext``, so a re-run under the same logical run id (``--logical-run-id``)
    replaces that business run's rows rather than duplicating them.
    """
    store = StoreCatalog(context.base_dir).store(FEED_NAME)
    return builder(
        CsvReader(SAMPLE_CSV),
        store.writer(RAW, FEED_NAME, AccumulateByRun.from_context(context)),
        context.run_log,
    ).run()


def main(argv: list[str]) -> int:
    base_dir = Path(argv[1]) if len(argv) > 1 else Path.cwd() / "data"
    # Direct invocation builds a default run context and runs the same handler the
    # framework would. The pipeline is fail-fast: a Validator breach aborts before
    # anything lands and raises a PipelineError. Catch the family and present it
    # cleanly so an expected data failure reads as a clear message, not an
    # unhandled traceback; a genuine bug is *not* a PipelineError and keeps its
    # stack trace.
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)
    try:
        dataset = run(context)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1
    print(
        f"Landed {len(dataset)} rows into "
        f"{Path(base_dir) / FEED_NAME / 'raw.db'} (table '{FEED_NAME}')"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))
