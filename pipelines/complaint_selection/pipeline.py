"""Complaint Selection: the SAS complaints export's Selection group.

Complaints A/B/C are one SAS complaints export split three ways, each with its
own Case Type ingest (source -> raw -> silver, no gold — see
``pipelines/complaints_a`` and its siblings). This pipeline is the one place
the three become a **Selection group**: it reads each Case Type's silver
through its Shared Reader, combines them into one candidate population, scores
and ranks it with named Python rules, and accumulates the chosen Cases into
their own ``selection_output`` store — outside every Case Type's medallion,
since a Selection group crosses three of them.

To add a Case Type to this selection group, add one member here: its Shared
Reader, its natural-key column, and its priority rule.

Address it by its location on disk::

    python -m cli run pipelines/complaint_selection --base-dir BASE_DIR
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any, Mapping

from case_review.variation import variation_by_id
from framework.core import Dataset, PipelineError, SchemaValidator, format_failure
from framework.io import (
    AccumulateByRun,
    DatasetReader,
    JsonWriter,
    Reader,
    Refresh,
    Writer,
)
from framework.run import FreshnessRequirement, Pipeline, RunContext, RunLog
from framework.transform import (
    Filter,
    LatestPerKey,
    Rename,
    Score,
    SelectColumns,
    Sort,
    Stamp,
)
from readers.complaints_a import ComplaintsACasesReader
from readers.complaints_b import ComplaintsBCasesReader
from readers.complaints_c import ComplaintsCCasesReader
from tools.environments import known_environments, resolve_base_dir
from tools.store import StoreRegistry

from .schema import VARIATIONS, SelectedComplaint, SelectionGroupMember

PIPELINE_NAME = "complaint_selection"

# The one declared output location: a plain namespace Store (not a medallion),
# since a Selection group's output belongs to none of the Case Types it reads.
OUTPUT_SUBJECT = "selection_output"
POOL_TABLE = "selection_pool"
TRACE_TABLE = "selection_trace"
POOL_JSON = "selection_pool.json"

PRIORITY_THRESHOLD = 50
# The complaints export is weekly (weekly_complaints_export.sas), so a daily
# schedule needs slack past one week to still find it fresh.
INGEST_MAX_AGE_DAYS = 10


def amount_priority(row: Mapping[str, Any]) -> int:
    """Complaints A: the larger the amount, the higher the priority."""
    return int(row["amount"])


def priority_band(row: Mapping[str, Any]) -> int:
    """Complaints B: its own declared band, mapped onto the shared score."""
    return {"high": 100, "medium": 50, "low": 10}[row["priority"]]


def slow_resolution_priority(row: Mapping[str, Any]) -> int:
    """Complaints C: the longer a complaint has been open, the higher the priority."""
    return int(row["resolution_days"])


SELECTION_GROUP: tuple[SelectionGroupMember, ...] = (
    SelectionGroupMember(
        "complaints_a", ComplaintsACasesReader, "record_id", amount_priority
    ),
    SelectionGroupMember(
        "complaints_b", ComplaintsBCasesReader, "record_id", priority_band
    ),
    SelectionGroupMember(
        "complaints_c", ComplaintsCCasesReader, "record_id", slow_resolution_priority
    ),
)

UPSTREAMS = tuple(
    FreshnessRequirement(member.case_type, max_age_days=INGEST_MAX_AGE_DAYS)
    for member in SELECTION_GROUP
)

_PRIORITY_BY_CASE_TYPE = {
    member.case_type: member.priority for member in SELECTION_GROUP
}


def complaint_priority(row: Mapping[str, Any]) -> int:
    """Dispatch to the row's own Case Type's declared priority rule."""
    return _PRIORITY_BY_CASE_TYPE[row["case_type"]](row)


def meets_priority_threshold(row: Mapping[str, Any]) -> bool:
    return row["priority_score"] >= PRIORITY_THRESHOLD


def available_complaints(base_dir: str | os.PathLike[str]) -> Dataset:
    """Every Case across the group's Case Types, one row per ``case_ref``."""
    import pandas as pd

    frames = []
    for member in SELECTION_GROUP:
        dataset = member.reader(base_dir).read()
        dataset = Rename({member.case_ref_column: "case_ref"})(dataset)
        dataset = LatestPerKey(key="case_ref", by="load_date")(dataset)
        dataset = Stamp("case_type", member.case_type)(dataset)
        frames.append(dataset.to_pandas())
    return Dataset.from_pandas(pd.concat(frames, ignore_index=True, sort=False))


def selection_builder(
    candidates_reader: Reader,
    pool_writer: Writer,
    trace_writer: Writer,
    json_writer: Writer,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the Selection flow: score, gate, rank, stamp, validate, explain, write."""
    # ":pool" distinguishes this inner Pipeline's own run-log label from the
    # runner's outer "complaint_selection" label the same run also records under.
    p = Pipeline(f"{PIPELINE_NAME}:pool", run_log=run_log)
    variation = variation_by_id(VARIATIONS, "v1")

    node = p.read(candidates_reader, name="read")
    node = p.transform(Score("priority_score", complaint_priority), node, name="score")
    node = p.transform(
        Filter(meets_priority_threshold, name="priority-threshold"), node, name="filter"
    )
    node = p.transform(Sort("priority_score", ascending=False), node, name="sort")
    node = p.transform(
        SelectColumns(["case_ref", "case_type", "priority_score"]), node, name="select"
    )
    node = p.transform(
        Stamp("question_bank_id", variation.question_bank_id), node, name="stamp"
    )
    node = p.validate(SchemaValidator(SelectedComplaint), node, name="post-validate")

    p.explain(
        trace_writer,
        node,
        id_column="case_ref",
        score_column="priority_score",
        name="explain",
    )
    p.write(pool_writer, node, name="write")
    p.write(json_writer, node, name="write-json")
    return p


def run(context: RunContext, *, describe: bool = False) -> Dataset:
    """Wire the real readers and writers for the environment and execute."""
    strategy = AccumulateByRun.from_context(context)
    store = StoreRegistry(context.base_dir).store(f"{OUTPUT_SUBJECT}/{PIPELINE_NAME}")
    json_path = Path(context.base_dir) / OUTPUT_SUBJECT / POOL_JSON

    candidates = available_complaints(context.base_dir)
    p = selection_builder(
        candidates_reader=DatasetReader(candidates),
        pool_writer=store.writer(POOL_TABLE, strategy),
        trace_writer=store.writer(TRACE_TABLE, strategy),
        json_writer=JsonWriter(json_path, Refresh()),
        run_log=context.run_log,
    )
    if describe:
        print(p.describe())
    # explain/write/write-json are three leaves on the same final node, and
    # each returns that same dataset unchanged, so the first of the three is
    # the SelectionPool regardless of how many leaves p.run() hands back.
    pool = p.run()[0]

    excluded = len(candidates) - len(pool)
    variation = variation_by_id(VARIATIONS, "v1")
    print(
        f"available complaints: {len(candidates)} -> "
        f"SelectionPool: {len(pool)} cases "
        f"(Question Bank {variation.question_bank_id}, "
        f"logical run {context.logical_run_id}); "
        f"trace: {len(candidates)} considered, {excluded} excluded with a reason"
    )
    return pool


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m pipelines.complaint_selection.pipeline",
        description="Narrow the complaints Selection group into the SelectionPool.",
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
    parser.add_argument(
        "--describe",
        action="store_true",
        help="print the pipeline's plan before running it",
    )
    args = parser.parse_args(argv[1:])
    try:
        base_dir = Path(args.base_dir) if args.base_dir else resolve_base_dir(args.env)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    from framework.run import PipelineRunner

    def handler(ctx: RunContext) -> Dataset:
        return run(ctx, describe=args.describe)

    runner = PipelineRunner()
    # subject=None: this pipeline is path-addressed, not medallion-scoped, so its
    # run-history label must be the bare pipeline name -- the same label the
    # declared UPSTREAMS resolve their upstreams under.
    runner.register(
        subject=None, pipeline=PIPELINE_NAME, handler=handler, freshness=UPSTREAMS
    )
    try:
        runner.run(None, PIPELINE_NAME, base_dir=base_dir)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))
