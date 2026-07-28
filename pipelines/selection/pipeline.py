"""Selection pipeline: the available CasePool narrowed into a SelectionPool.

The second half of the capstone path. A :class:`~case_review.case_pool.CasePool`
fetches the **available cases** from the upstream ``ingest`` pipeline's gold
(activity within the working-day window), and a Selection
:class:`~framework.run.builder.Pipeline` narrows them with named, testable Python
rules (score priority, filter the low-value cases out, rank highest-priority
first), stamps the chosen Variation's ``question_bank_id``, and accumulates the
**SelectionPool** into ``gold``. ``.explain(...)`` lands a sibling trace — a
per-Case verdict of why each available Case was or wasn't selected.

It declares ``ingest`` as a freshness upstream, so::

    python -m cli run pipelines/selection --base-dir /tmp/demo --run-date 2026-05-29

checks for recent successful ``ingest`` history before Selection runs.
"""

from __future__ import annotations

import argparse
import sys
from typing import Any, Mapping

from case_review.case_pool import CasePool
from framework.core import PipelineError, format_failure
from framework.io import AccumulateByRun, DatasetReader
from framework.run import FreshnessRequirement, Pipeline, RunContext
from framework.transform import Filter, Score, Sort, Stamp
from pipelines.ingest.pipeline import AS_OF, CASES, ActivityCase
from tools.calendar import WorkingDayCalendar
from tools.environments import base_dir_for, known_environments
from tools.medallion import medallion
from tools.schema import (
    ACCUMULATE_BY_RUN_CONTEXT_COLUMNS,
    Column,
    Table,
    columns_of,
    retype,
    text_columns,
)
from tools.store import StoreRegistry

# Selection only runs once the CasePool is current.
UPSTREAMS = (FreshnessRequirement(upstream_pipeline="ingest"),)

# This feed has no schema.py -- its two gold tables have no row dataclass of
# their own (they narrow/derive from ingest's CASES.schema), so TABLES lives
# beside the wiring here rather than in a schema.py that would hold nothing
# else (see docs/schema-declaration.md). Both land in the same "cases/gold"
# namespace ingest's own gold table lives in (they share the CASES subject),
# via AccumulateByRun.from_context(context), so both carry the stamped run
# columns.
#
# CasePool.fetch_available_cases re-coerces activity_date to a real ``date``
# right before this pipeline reads it, so (unlike ingest's own gold, which
# reads the same silver table with no such re-parse) it lands TIMESTAMP here.
TABLES = (
    Table(
        "cases/gold",
        "selection_pool",
        columns=retype(columns_of(ActivityCase), activity_date="TIMESTAMP")
        + (
            Column("case_id", "TEXT", nullable=False),
            Column("priority_score", "INTEGER", nullable=False),
            Column("question_bank_id", "TEXT", nullable=False),
        )
        + ACCUMULATE_BY_RUN_CONTEXT_COLUMNS,
        primary_key=("case_id",),
    ),
    Table(
        "cases/gold",
        "selection_trace",
        # The explain trace's own shape (framework.run.trace.RowTrace): the id
        # column named at p.explain(..., id_column="case_ref"), verdict/reason,
        # rank (float -- None for excluded rows), and score (int -- Score runs
        # before Filter, so every considered row has one).
        columns=retype(
            text_columns(["case_ref", "verdict", "reason", "rank", "score"]),
            rank="REAL",
            score="INTEGER",
        )
        + ACCUMULATE_BY_RUN_CONTEXT_COLUMNS,
        primary_key=("case_ref",),
    ),
)


def high_value_case(row: Mapping[str, Any]) -> bool:
    """Return whether a Case clears the demo's explainable value gate.

    Kept as a named pure function so the rule can be reused, traced by a named
    ``Filter``, and tested without running a Pipeline.
    """
    return row["amount"] >= 100


def priority_score(row: Mapping[str, Any]) -> int:
    """Return the demo priority score used to rank selected Cases.

    The scorer is deterministic and depends only on the row, so the
    SelectionPool ordering and selection trace score are reproducible.
    """
    return row["amount"] * 2


def run(context: RunContext):
    med = medallion(StoreRegistry(context.base_dir), CASES.name)
    strategy = AccumulateByRun.from_context(context)

    # Named, pure rule functions stay independently testable while Filter/Score
    # provide the framework wiring and trace metadata.
    pool = CasePool(CASES, med.gold, WorkingDayCalendar())
    available = pool.fetch_available_cases(
        as_of=context.run_date, activity_column="activity_date", within_working_days=5
    )
    variation = CASES.variation("v1")
    p = Pipeline("selection")
    r = p.read(DatasetReader(available), name="read")
    sc = p.transform(Score("priority_score", priority_score), r, name="score")
    f = p.transform(Filter(high_value_case, name="high-value"), sc, name="filter")
    so = p.transform(Sort("priority_score", ascending=False), f, name="sort")
    st = p.transform(
        Stamp("question_bank_id", variation.question_bank_id), so, name="stamp"
    )
    p.explain(
        med.gold.writer("selection_trace", strategy),
        st,
        id_column="case_ref",
        score_column="priority_score",
        name="explain",
    )
    p.write(med.gold.writer("selection_pool", strategy), st, name="write")
    selection_pool = p.run()

    trace = med.gold.reader("selection_trace").read()
    excluded = sum(1 for v in trace.to_pandas()["verdict"] if v == "excluded")
    print(
        f"available cases: {len(available)} -> "
        f"SelectionPool: {len(selection_pool)} cases "
        f"(Question Bank {variation.question_bank_id}, "
        f"logical run {context.logical_run_id}); "
        f"trace: {len(trace)} considered, {excluded} excluded with a reason"
    )
    return selection_pool


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m pipelines.selection.pipeline",
        description="Narrow the available CasePool into a SelectionPool.",
    )
    parser.add_argument(
        "--base-dir",
        dest="base_dir",
        default=None,
        help="medallion root directory; omit to resolve it from --env",
    )
    parser.add_argument(
        "--env",
        help="named environment to resolve base_dir from when no --base-dir is "
        f"given ({', '.join(known_environments())}); defaults to $PIPELINE_ENV or dev",
    )
    args = parser.parse_args(argv[1:])
    # An explicit --base-dir wins over the environment's own root, but the
    # environment is still activated either way -- a path says where a run
    # lands, never how strictly it may create a table no migration declared.
    try:
        base_dir = base_dir_for(args.env, override=args.base_dir)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    context = RunContext(base_dir=base_dir, pipeline="selection", run_date=AS_OF)
    try:
        run(context)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))
