```python
"""Case-selection example: two source feeds -> the gold ``selection_pool``.

Reads **all sales** and **all case reviews**, refines each through
``raw -> silver`` with its schema enforced, then assembles the gold
``selection_pool`` — at most one Case to check per adviser — plus a sibling
``selection_trace`` recording why each considered adviser was or wasn't chosen.

The selection policy is named, pure-Python rules
(:mod:`pipelines.case_selection.rules`) orchestrated by
:func:`~pipelines.case_selection.selection.select_cases`; this module only wires
the framework IO, the schema enforcement, and the gold write.

Address it by its location on disk -- the framework imports
``pipelines.case_selection.pipeline`` and runs its ``run(context)`` callable::

    python -m cli run pipelines/case_selection [BASE_DIR]

or run the module directly with a default run context::

    python -m pipelines.case_selection.pipeline [BASE_DIR]
"""

from __future__ import annotations

import sys
from dataclasses import fields
from datetime import date
from pathlib import Path

from framework.core import (
    GOLD,
    RAW,
    SILVER,
    ColumnValidator,
    Dataset,
    PipelineError,
    SchemaValidator,
    format_failure,
)
from framework.io import (
    AccumulateByRun,
    CsvReader,
    DatasetReader,
    Reader,
    Refresh,
    StoreCatalog,
    Writer,
)
from framework.run import Pipeline, RunContext, RunLog
from framework.transform import SchemaCoercion

from .schema import CaseReviewRow, SalesRow, SelectedCase
from .selection import SelectCasesToCheck

SUBJECT = "case_selection"
SAMPLE_DIR = Path(__file__).parent / "sample_data"
SALES_CSV = SAMPLE_DIR / "sales.csv"
REVIEWS_CSV = SAMPLE_DIR / "case_reviews.csv"

# Fixed so the recency window lines up with the bundled feed and the run is
# deterministic; doubles as the demo's run date when invoked directly.
AS_OF = date(2026, 6, 25)

# This pipeline is self-contained (it lands its own sources), so no upstreams.
UPSTREAMS = ()


def raw_builder(reader: Reader, writer: Writer, schema: type) -> Pipeline:
    """Build a raw hop: gate the source's columns, then land it faithfully."""
    p = Pipeline(f"{SUBJECT}:raw")
    r = p.read(reader, name="read")
    v = p.validate(ColumnValidator([f.name for f in fields(schema)]), r, name="columns")
    p.write(writer, v, name="write")
    return p


def silver_builder(reader: Reader, writer: Writer, schema: type) -> Pipeline:
    """Build a silver hop: coerce to the schema's dtypes, then validate them."""
    p = Pipeline(f"{SUBJECT}:silver")
    r = p.read(reader, name="read")
    coerced = p.transform(SchemaCoercion(schema), r, name="coerce")
    validated = p.validate(SchemaValidator(schema), coerced, name="post-validate")
    p.write(writer, validated, name="write")
    return p


def selection_builder(
    sales_reader: Reader,
    selector: SelectCasesToCheck,
    pool_writer: Writer,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the selection hop: sales -> SelectCasesToCheck -> validated pool.

    ``selector`` reads the case-review history itself; the pipeline streams the
    sales feed through it, enforces the deliverable's schema, and writes the
    SelectionPool. The per-adviser trace is exposed on ``selector.trace`` after
    the run, for the caller to land alongside.
    """
    p = Pipeline(f"{SUBJECT}:selection", run_log=run_log)
    r = p.read(sales_reader, name="read")
    selected = p.transform(selector, r, name="select")
    coerced = p.transform(SchemaCoercion(SelectedCase), selected, name="coerce")
    validated = p.validate(SchemaValidator(SelectedCase), coerced, name="post-validate")
    p.write(pool_writer, validated, name="write")
    return p


def run(context: RunContext) -> Dataset:
    """Refine both feeds to silver, then assemble the gold ``selection_pool``."""
    store = StoreCatalog(context.base_dir).store(SUBJECT)
    strategy = AccumulateByRun.from_context(context)
    as_of = context.run_date or AS_OF

    # Land each source feed -> raw (faithful) -> silver (schema enforced).
    for table, csv, schema in (
        ("sales", SALES_CSV, SalesRow),
        ("case_reviews", REVIEWS_CSV, CaseReviewRow),
    ):
        raw_builder(CsvReader(csv), store.writer(RAW, table, Refresh()), schema).run()
        silver_builder(
            store.reader(RAW, table), store.writer(SILVER, table, Refresh()), schema
        ).run()

    # Assemble the SelectionPool from silver sales + silver case-review history.
    selector = SelectCasesToCheck(store.reader(SILVER, "case_reviews"), as_of)
    pool = selection_builder(
        store.reader(SILVER, "sales"),
        selector,
        store.writer(GOLD, "selection_pool", strategy),
        run_log=context.run_log,
    ).run()

    # Land the sibling trace: why each considered adviser was/wasn't selected.
    trace_pipeline = Pipeline(f"{SUBJECT}:trace")
    tr = trace_pipeline.read(DatasetReader(selector.trace_dataset()), name="read")
    trace_pipeline.write(
        store.writer(GOLD, "selection_trace", strategy), tr, name="write"
    )
    trace = trace_pipeline.run()

    excluded = sum(1 for row in selector.trace if row["verdict"] == "excluded")
    print(
        f"considered {len(trace)} advisers (sale in last 15 days) -> "
        f"selection_pool: {len(pool)} cases, {excluded} excluded with a reason "
        f"(logical run {context.logical_run_id})"
    )
    return pool


def main(argv: list[str]) -> int:
    base_dir = Path(argv[1]) if len(argv) > 1 else Path.cwd() / "data"
    context = RunContext(base_dir=base_dir, pipeline=SUBJECT, run_date=AS_OF)
    try:
        run(context)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))

```
