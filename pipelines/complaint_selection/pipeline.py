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
import datetime as dt
import os
import sqlite3
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence

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
from readers.sharepoint_cases import CurrentCasesReader
from tools.environments import known_environments, resolve_base_dir
from tools.observability.timestamps import local_timezone, parse_timestamp
from tools.store import StoreRegistry

from .schema import VARIATIONS, PendingVoid, SelectedComplaint, SelectionGroupMember

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

# ADR-0021's void-replacement ladder: ordered match attempts, tried per void in
# order until one has an unconsumed candidate. Each field must be a top-level
# eligible-pool column -- this is the one place to change like-for-like
# matching. `attribute_a` is a placeholder until a feed carries the real
# cross-Case-Type attribute the ADR describes; today it is always None, so the
# live rung is `("case_type",)`.
MATCH_LADDER: tuple[tuple[str, ...], ...] = (
    ("attribute_a", "case_type"),
    ("attribute_a",),
    ("case_type",),
)

# The fallback/tie-break ordering field -- "oldest first" among a rung's
# candidates, and the whole rule once no rung matches. A top-level pool field,
# None until a feed provides it.
RELATED_DATE_COLUMN = "related_date"


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
    frame = pd.concat(frames, ignore_index=True, sort=False)

    # Every ladder field plus the tie-break must exist as a top-level column
    # even before a feed provides it. `case_type` is already stamped above; the
    # rest are None-filled today and need no change here once a member's
    # silver grows one -- pd.concat(sort=False) already carries a real value
    # through.
    for column in {field for rung in MATCH_LADDER for field in rung} | {
        RELATED_DATE_COLUMN
    }:
        if column not in frame.columns:
            frame[column] = None

    return Dataset.from_pandas(frame)


def voided_cases(
    base_dir: str | os.PathLike[str],
) -> tuple[tuple[str, dt.datetime], ...]:
    """Every currently-voided Case the sync feed shows, as ``(case_ref, voided_at)``.

    A soft dependency, deliberately: Complaint Selection declares no
    ``FreshnessRequirement`` on ``sharepoint_cases``, so a base dir where that
    feed's gold is missing or unreadable sees no voids rather than failing.
    """
    try:
        current = CurrentCasesReader(base_dir).read().to_pandas()
    except sqlite3.OperationalError:
        return ()

    void = current[current["status"] == "Void"]
    has_title = void["title"].notna() & (void["title"].astype(str).str.strip() != "")
    has_voided_at = void["voided_at"].notna()
    void = void[has_title & has_voided_at]

    return tuple(
        (str(row["title"]), _local_instant(row["voided_at"]))
        for row in void.to_dict("records")
    )


def _local_instant(value: str) -> dt.datetime:
    """Parse a ``voided_at`` stamp to an aware instant.

    Sync's ``voided_at`` round-trips through SQLite as text that may carry an
    offset or arrive naive; a naive stamp is local wall-clock time and is
    attached to the local zone the same way
    ``tools.observability.timestamps.start_of_local_day`` does, rather than
    string-compared against the timezone-aware run-history instant it is
    measured against -- a naive-vs-offset string compare silently drops a
    same-day void (the separator character alone sorts a naive stamp before an
    offset one, whatever the actual time).
    """
    parsed = dt.datetime.fromisoformat(str(value))
    if parsed.tzinfo is not None:
        return parsed
    zone = local_timezone()
    return parsed.replace(tzinfo=zone) if zone is not None else parsed.astimezone()


def previous_run_instant(context: RunContext) -> dt.datetime | None:
    """The instant this pipeline last succeeded, or ``None`` with no history.

    ``None`` both when there is truly no run registry (a plain ``RunContext``,
    how a bare ``run()`` call and most tests reach this) and when the registry
    has never recorded a success -- either way there is no "since" to measure
    voids against.
    """
    if context.run_registry is None:
        return None
    record = context.run_registry.latest_success(PIPELINE_NAME)
    if record is None:
        return None
    return parse_timestamp(record["timestamp"])


def pending_voids(
    voided: Sequence[tuple[str, dt.datetime]],
    since: dt.datetime | None,
    pool_reader: Reader,
) -> tuple[PendingVoid, ...]:
    """Voids since the previous run, joined to what the pool selected them as.

    A void with no candidate lapses rather than carrying forward: a ref absent
    from the pool was never selected in the first place, so there is nothing
    here to replace it with.
    """
    if since is None:
        return ()
    candidates = [(ref, voided_at) for ref, voided_at in voided if voided_at > since]
    if not candidates:
        return ()

    try:
        pool = pool_reader.read().to_pandas()
    except sqlite3.OperationalError:
        return ()  # the pool has not landed in this base dir yet

    ladder_fields = sorted({field for rung in MATCH_LADDER for field in rung})
    if pool.empty or any(field not in pool.columns for field in ladder_fields):
        return ()

    latest = LatestPerKey(key="case_ref", by="load_date")(Dataset.from_pandas(pool))
    by_ref = {row["case_ref"]: row for row in latest.to_pandas().to_dict("records")}

    pending: list[PendingVoid] = []
    for ref, voided_at in candidates:
        row = by_ref.get(ref)
        if row is None:
            continue
        attributes = {field: row[field] for field in ladder_fields}
        pending.append(
            PendingVoid(case_ref=ref, voided_at=voided_at, attributes=attributes)
        )
    return tuple(pending)


def is_not_voided(voided_refs: frozenset[str]):
    """Named predicate factory: gate out every currently-voided Case.

    Checked against *every* void the sync feed currently shows, not just the
    ones inside the replacement window -- a voided Case must never be
    re-selected regardless of whether it has a replacement.
    """

    def predicate(row: Mapping[str, Any]) -> bool:
        return row["case_ref"] not in voided_refs

    return predicate


def assign_replacements(pending: Sequence[PendingVoid]):
    """Pair each pending void with a selected row, oldest void first.

    A plain dataset->dataset transform -- a Processor is any such callable, so
    this needs no class. For each void, in turn, the first rung in
    ``MATCH_LADDER`` with an unconsumed candidate wins; within a rung the
    oldest ``related_date`` wins (nulls last, an all-null tie degrading to the
    frame's current -- i.e. priority-score -- order); no rung matching falls
    back to the oldest unconsumed row overall. Each row consumes at most one
    void, and a void with no unconsumed row left lapses.
    """
    import pandas as pd

    def oldest(frame: Any, indices: list[Any]) -> Any:
        return min(
            indices,
            key=lambda idx: (
                pd.isna(frame.at[idx, RELATED_DATE_COLUMN]),
                frame.at[idx, RELATED_DATE_COLUMN]
                if pd.notna(frame.at[idx, RELATED_DATE_COLUMN])
                else "",
                idx,
            ),
        )

    def transform(dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        frame["replaces_case_ref"] = None
        frame["void_match_rung"] = None
        consumed: set[Any] = set()

        for void in sorted(pending, key=lambda v: v.voided_at):
            chosen: Any = None
            rung_label: str | None = None
            for rung in MATCH_LADDER:
                matches = [
                    idx
                    for idx in frame.index
                    if idx not in consumed
                    and all(
                        pd.notna(void.attributes.get(field))
                        and pd.notna(frame.at[idx, field])
                        and void.attributes[field] == frame.at[idx, field]
                        for field in rung
                    )
                ]
                if matches:
                    chosen = oldest(frame, matches)
                    rung_label = ",".join(rung)
                    break
            if chosen is None:
                remaining = [idx for idx in frame.index if idx not in consumed]
                if not remaining:
                    continue  # no unconsumed row left -- the void lapses
                chosen = oldest(frame, remaining)
                rung_label = "oldest"
            frame.loc[chosen, "replaces_case_ref"] = void.case_ref
            frame.loc[chosen, "void_match_rung"] = rung_label
            consumed.add(chosen)
        return Dataset.from_pandas(frame)

    return transform


def selection_builder(
    candidates_reader: Reader,
    pool_writer: Writer,
    trace_writer: Writer,
    json_writer: Writer,
    pending_voids: Sequence[PendingVoid] = (),
    voided_refs: frozenset[str] = frozenset(),
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the Selection flow: score, gate, rank, replace voids, stamp, write.

    With no voids at all (``pending_voids`` and ``voided_refs`` both empty) this
    is behaviourally identical to the pipeline before ADR-0021's replacement.
    There is no second, rung-first sort: with a ladder, rung is a *per-void*
    relation rather than a single column every row can be ranked by, and
    nothing downstream consumes pool order today (no Hopper, no volume
    target), so that half of the ADR is deferred -- see docs/selection.md.
    """
    # ":pool" distinguishes this inner Pipeline's own run-log label from the
    # runner's outer "complaint_selection" label the same run also records under.
    p = Pipeline(f"{PIPELINE_NAME}:pool", run_log=run_log)
    variation = variation_by_id(VARIATIONS, "v1")

    node = p.read(candidates_reader, name="read")
    node = p.transform(Score("priority_score", complaint_priority), node, name="score")
    node = p.transform(
        Filter(is_not_voided(voided_refs), name="voided"), node, name="voided"
    )
    node = p.transform(
        Filter(meets_priority_threshold, name="priority-threshold"), node, name="filter"
    )
    node = p.transform(Sort("priority_score", ascending=False), node, name="sort")
    node = p.transform(assign_replacements(pending_voids), node, name="replace-voids")
    node = p.transform(
        SelectColumns(
            [
                "case_ref",
                "case_type",
                "priority_score",
                "attribute_a",
                "related_date",
                "replaces_case_ref",
                "void_match_rung",
            ]
        ),
        node,
        name="select",
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
    voided = voided_cases(context.base_dir)
    since = previous_run_instant(context)
    pending = pending_voids(voided, since, store.reader(POOL_TABLE))
    voided_refs = frozenset(ref for ref, _ in voided)

    p = selection_builder(
        candidates_reader=DatasetReader(candidates),
        pool_writer=store.writer(POOL_TABLE, strategy),
        trace_writer=store.writer(TRACE_TABLE, strategy),
        json_writer=JsonWriter(json_path, Refresh()),
        pending_voids=pending,
        voided_refs=voided_refs,
        run_log=context.run_log,
    )
    if describe:
        print(p.describe())
    # explain/write/write-json are three leaves on the same final node, and
    # each returns that same dataset unchanged, so the first of the three is
    # the SelectionPool regardless of how many leaves p.run() hands back.
    pool = p.run()[0]

    excluded = len(candidates) - len(pool)
    replaced = int(pool.to_pandas()["replaces_case_ref"].notna().sum())
    lapsed = len(pending) - replaced
    variation = variation_by_id(VARIATIONS, "v1")
    print(
        f"available complaints: {len(candidates)} -> "
        f"SelectionPool: {len(pool)} cases "
        f"(Question Bank {variation.question_bank_id}, "
        f"logical run {context.logical_run_id}); "
        f"trace: {len(candidates)} considered, {excluded} excluded with a reason; "
        f"voids: {len(pending)} pending, {replaced} replaced, {lapsed} lapsed"
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
