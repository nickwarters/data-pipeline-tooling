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

# A declared starting depth for the Hopper. ADR-0021 sizes it as 3D (three
# times the group's daily assignment rate); monitoring throughput and
# adjusting this from it is deferred.
HOPPER_DEPTH = 60

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

# The per-member ingest requirements are widened (a weekly export); the
# trailing sharepoint_cases requirement is not -- its default max_age_days=0
# means "succeeded today", because this run sizes the Hopper from today's
# unallocated count and a cap must not be sized against a stale one.
# sharepoint_cases is orchestrated daily in the case_management set ahead of
# this pipeline's own schedule slot, and reviewer_activity already depends on
# the same bare label, so this resolves in production; the default first-run
# policy (warn) still lets a fresh environment run, where "no history seen,
# fill to the declared depth" is genuinely correct.
UPSTREAMS = (
    *(
        FreshnessRequirement(member.case_type, max_age_days=INGEST_MAX_AGE_DAYS)
        for member in SELECTION_GROUP
    ),
    FreshnessRequirement("sharepoint_cases"),
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

    A soft dependency at the read level: the same-day ``FreshnessRequirement``
    on ``sharepoint_cases`` (see ``UPSTREAMS``) already blocks a run whose sync
    history is stale, so what this still has to catch is only the fresh
    environment its first-run policy (warn) lets through -- gold missing or
    unreadable, where "no history, no voids visible" is the correct fallback
    rather than a crash.
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


def unallocated_case_count(
    base_dir: str | os.PathLike[str], pool_reader: Reader
) -> int:
    """A direct count of the group's unallocated Cases -- the Hopper's depth signal.

    Never ``target - completed - voided`` (ADR-0021): a Case assigned but not
    yet finished has left the Hopper without reaching a terminal state, so that
    arithmetic overstates what is actually sitting there. Counted directly
    instead: In-progress, with no assigned reviewer, and one of *this* pool's
    own selections (a Case this run doesn't own is not its capacity to count).

    Gold persists a genuinely null reviewer for an unassigned Case -- the
    ``"(unassigned)"`` string is a *reporting* fill ``case_counts_current``
    applies, not what lands here -- but a Person column can round-trip as
    either null or an empty/whitespace string, so both are checked.

    Same soft-dependency shape as :func:`voided_cases`: an unreadable sync
    store, or a pool that has not landed yet, counts as 0 unallocated -- a
    fresh environment fills to the declared depth. The *stale*-sync direction
    (history exists but isn't today's) is guarded by the same-day
    ``FreshnessRequirement`` in ``UPSTREAMS``, not here: a cap must not be sized
    against a number that might be silently out of date.
    """
    try:
        current = CurrentCasesReader(base_dir).read().to_pandas()
    except sqlite3.OperationalError:
        return 0

    in_progress = current[current["status"] == "In-progress"]
    reviewer = in_progress["assigned_reviewer_name"]
    unassigned = in_progress[reviewer.isna() | (reviewer.astype(str).str.strip() == "")]
    has_title = unassigned["title"].notna() & (
        unassigned["title"].astype(str).str.strip() != ""
    )
    titles = set(unassigned.loc[has_title, "title"].astype(str))

    try:
        pool = pool_reader.read().to_pandas()
    except sqlite3.OperationalError:
        return 0

    pool_refs = (
        set(pool["case_ref"].astype(str)) if "case_ref" in pool.columns else set()
    )
    return len(titles & pool_refs)


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


def replacements_first(pending: Sequence[PendingVoid]):
    """Stable partition: this run's replacements lead, oldest void first.

    Queue order, not a second sort over the whole pool -- void-replacement
    rung is a relation between one void and one candidate, not a column every
    row can be ranked by. Only the rows a void actually claimed move: they lead
    in the order their void was raised, oldest first; every other row keeps
    whatever order the priority sort already gave it (a stable partition, so
    that relative order survives). A plain dataset->dataset transform with no
    trace_role -- it reorders and drops nothing, so it traces, if at all, as an
    ordinary pass-through stage.
    """
    import pandas as pd

    order = {
        void.case_ref: position
        for position, void in enumerate(sorted(pending, key=lambda v: v.voided_at))
    }

    def transform(dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()

        def key(idx: Any) -> tuple[int, int]:
            ref = frame.at[idx, "replaces_case_ref"]
            if pd.notna(ref) and ref in order:
                return (0, order[ref])
            return (1, 0)

        ordered = frame.loc[sorted(frame.index, key=key)].reset_index(drop=True)
        return Dataset.from_pandas(ordered)

    return transform


def hopper_gate(capacity: int):
    """Cut the queue at the Hopper's remaining capacity.

    A gate, never a limit on the read (ADR-0021): every Case still enters the
    pipeline and is scored, ranked and traced as *considered* -- this is the
    only place some of them stop short of *selected*, so the trace stays the
    availability-reporting source it needs to be. Traces as ``excluded by gate
    'hopper'`` via the ``trace_role``/``trace_name`` attributes the builder
    reads off any callable, plain function or not. ``capacity`` of 0 lands an
    empty pool and JSON without error -- a fully-loaded Hopper is not a
    failure.
    """

    def gate(dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        return Dataset.from_pandas(frame.head(capacity).reset_index(drop=True))

    gate.trace_role = "gate"
    gate.trace_name = "hopper"
    return gate


def selection_builder(
    candidates_reader: Reader,
    pool_writer: Writer,
    trace_writer: Writer,
    json_writer: Writer,
    pending_voids: Sequence[PendingVoid] = (),
    voided_refs: frozenset[str] = frozenset(),
    hopper_capacity: int | None = None,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the Selection flow: score, gate, replace voids, queue, cap, write.

    With no voids at all (``pending_voids`` and ``voided_refs`` both empty) and
    the Hopper under no pressure, this is behaviourally identical to the
    pipeline before ADR-0021. There is still no second, rung-first sort over
    the whole pool -- with a ladder, rung is a *per-void* relation, not a
    single column every row can be ranked by. What the ADR calls queue order is
    instead a lightweight reordering (``replacements_first``) just ahead of the
    ``hopper`` gate that now consumes it: this run's replacements lead, oldest
    void first, everything else keeping the priority sort's order.

    ``hopper_capacity`` is resolved from ``HOPPER_DEPTH`` *inside* this body
    when ``None``, rather than as the default argument value: a default is
    bound once at import time, which would freeze the constant and defeat a
    test's monkeypatch of it.
    """
    if hopper_capacity is None:
        hopper_capacity = HOPPER_DEPTH

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
    node = p.transform(replacements_first(pending_voids), node, name="queue")
    node = p.transform(hopper_gate(hopper_capacity), node, name="hopper")
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
    unallocated = unallocated_case_count(context.base_dir, store.reader(POOL_TABLE))
    capacity = max(0, HOPPER_DEPTH - unallocated)

    p = selection_builder(
        candidates_reader=DatasetReader(candidates),
        pool_writer=store.writer(POOL_TABLE, strategy),
        trace_writer=store.writer(TRACE_TABLE, strategy),
        json_writer=JsonWriter(json_path, Refresh()),
        pending_voids=pending,
        voided_refs=voided_refs,
        hopper_capacity=capacity,
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
        f"voids: {len(pending)} pending, {replaced} replaced, {lapsed} lapsed; "
        f"hopper: {unallocated} unallocated of {HOPPER_DEPTH} -> "
        f"selecting up to {capacity}"
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
