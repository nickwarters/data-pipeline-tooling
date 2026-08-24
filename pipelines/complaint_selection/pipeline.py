"""Complaint Selection: the SAS complaints export's Selection group.

Complaints A/B/C are one SAS complaints export split three ways, each with its
own Case Type ingest (source -> raw -> silver, no gold -- see
``pipelines/complaints_a`` and its siblings). This pipeline is the one place
the three become a **Selection group**: it reads each Case Type's silver and
the sync feed's current Cases, then narrows the combined candidates to the
SelectionPool in one governed transform, ``select_complaints``.

To add a Case Type to this selection group, add one member to
``SELECTION_GROUP`` -- its Shared Reader, its natural key, its received-date
column, and its Case Details columns. The group shares one priority rule:
oldest complaint first, within ``MAX_AGE_DAYS``.

Address it by its location on disk::

    python -m cli run pipelines/complaint_selection --base-dir BASE_DIR
"""

from __future__ import annotations

import argparse
import datetime as dt
import functools
import json
import os
import sqlite3
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence

import pandas as pd

from framework.core import Dataset, PipelineError, SchemaValidator, format_failure
from framework.io import AccumulateByRun, JsonWriter, Reader, Refresh, Writer
from framework.run import (
    FreshnessRequirement,
    RunContext,
    read,
    run_pipeline,
    transform,
    validate,
    write,
)
from framework.transform import LatestPerKey, Rename
from readers.complaints_a import ComplaintsACasesReader
from readers.complaints_b import ComplaintsBCasesReader
from readers.complaints_c import ComplaintsCCasesReader
from readers.sharepoint_cases import CurrentCasesReader
from tools.environments import known_environments, resolve_base_dir
from tools.observability import timestamps
from tools.store import StoreRegistry

from .schema import PendingVoid, SelectedComplaint, SelectionGroupMember

PIPELINE_NAME = "complaint_selection"

# The one declared output location: a plain namespace Store (not a medallion),
# since a Selection group's output belongs to none of the Case Types it reads.
OUTPUT_SUBJECT = "selection_output"
POOL_TABLE = "selection_pool"
TRACE_TABLE = "selection_trace"
POOL_JSON = "selection_pool.json"

# The group's one gate on age: only a complaint *younger* than this many days
# is selectable. A declared starting value, expected to be tuned.
MAX_AGE_DAYS = 50

# A declared starting depth for the Hopper. ADR-0021 sizes it as 3D (three
# times the group's daily assignment rate); monitoring throughput and
# adjusting this from it is deferred.
HOPPER_DEPTH = 60

# The complaints export is weekly (weekly_complaints_export.sas), so a daily
# schedule needs slack past one week to still find it fresh.
INGEST_MAX_AGE_DAYS = 10

# The two sync statuses this pipeline reads by. "To-allocate" is the status
# the platform creates a Case in and the one its allocation claim replaces
# (#768) -- the Hopper is a predicate on it, never a scan for a blank
# reviewer. See CONTEXT.md's Hopper entry.
TO_ALLOCATE = "To-allocate"
VOID_STATUS = "Void"

# ADR-0021's void-replacement ladder: ordered match attempts, tried per void in
# order until one has an unconsumed candidate. Each field must be a top-level
# candidate column -- this is the one place to change like-for-like matching.
# `attribute_a` is a placeholder until a feed carries the real cross-Case-Type
# attribute the ADR describes; today it is always None, so the live rung is
# `("case_type",)`.
MATCH_LADDER: tuple[tuple[str, ...], ...] = (
    ("attribute_a", "case_type"),
    ("attribute_a",),
    ("case_type",),
)

# The fallback/tie-break ordering field -- "oldest first" among a rung's
# candidates, and the whole rule once no rung matches. Carries each member's
# received date, so the ladder's tie-break and the queue's priority order
# read the same date.
RELATED_DATE_COLUMN = "related_date"

# The landed SelectionPool's columns, in declaration order -- also what a
# JSON deliverable row carries. Pinned beside TRACE_COLUMNS because an extra
# or missing one fails against the migrated table.
POOL_COLUMNS: tuple[str, ...] = (
    "case_ref",
    "case_type",
    "priority_score",
    "attribute_a",
    RELATED_DATE_COLUMN,
    "replaces_case_ref",
    "void_match_rung",
    "details",
)

# The selection trace's declared columns (ADR-0008) -- exactly these five.
TRACE_COLUMNS: tuple[str, ...] = ("case_ref", "verdict", "reason", "rank", "score")

# Every field select_complaints carries per considered Case, pool and trace
# columns together, before either write projects it down. Passed explicitly
# to every intermediate pd.DataFrame(...) so an empty source or an empty
# candidate population still yields these columns rather than none.
_ROW_COLUMNS: tuple[str, ...] = tuple(dict.fromkeys((*POOL_COLUMNS, *TRACE_COLUMNS)))


def age_in_days(received_date: Any, run_date: dt.date) -> int | None:
    """The group's one priority rule: days since the complaint arrived.

    Older is a higher score, so the pool's priority-desc sort is oldest first.
    ``run_date`` (not the wall clock) is the measuring point, so a re-drive of
    a past run date recomputes the same ages. ``None`` for a missing or
    unparseable date -- the caller excludes that row explicitly rather than
    inventing an age for it.
    """
    if received_date is None or pd.isna(received_date):
        return None
    try:
        received = dt.date.fromisoformat(str(received_date)[:10])
    except ValueError:
        return None
    return (run_date - received).days


def within_max_age(row: Mapping[str, Any]) -> bool:
    return row["priority_score"] < MAX_AGE_DAYS


SELECTION_GROUP: tuple[SelectionGroupMember, ...] = (
    SelectionGroupMember(
        "complaints_a",
        ComplaintsACasesReader,
        "record_id",
        "received_date",
        ("amount", "label"),
    ),
    SelectionGroupMember(
        "complaints_b",
        ComplaintsBCasesReader,
        "record_id",
        "received_date",
        ("category", "priority"),
    ),
    SelectionGroupMember(
        "complaints_c",
        ComplaintsCCasesReader,
        "record_id",
        "received_date",
        ("department", "resolution_days"),
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


class CurrentCasesOrEmpty:
    """The sync feed's current Cases, tolerating one that hasn't landed yet.

    A fresh environment with no sync store must still run -- the freshness
    guard's first-run policy (warn) lets it through -- and "no voids, 0
    unallocated" is correct there. The *stale* direction is blocked outright
    by the same-day ``FreshnessRequirement`` above; only absence degrades,
    here. The Shared Reader itself stays strict on purpose (tolerating a
    missing store is this pipeline's call, not every consumer's).
    """

    def __init__(self, base_dir: str | os.PathLike[str]) -> None:
        self._reader = CurrentCasesReader(base_dir)

    def read(self) -> Dataset:
        try:
            return self._reader.read()
        except sqlite3.OperationalError:
            return Dataset.from_pandas(
                pd.DataFrame(columns=["title", "status", "voided_at"])
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
    zone = timestamps.local_timezone()
    return parsed.replace(tzinfo=zone) if zone is not None else parsed.astimezone()


def voided_refs(current: pd.DataFrame) -> frozenset[str]:
    """Every currently-voided Case's ref -- gates all of them, not just the
    ones inside the void-replacement window.
    """
    void = current[current["status"] == VOID_STATUS]
    has_title = void["title"].notna() & (void["title"].astype(str).str.strip() != "")
    return frozenset(void.loc[has_title, "title"].astype(str))


def voids_since(
    current: pd.DataFrame, since: dt.datetime | None
) -> tuple[tuple[str, dt.datetime], ...]:
    """Voids since the previous run, as ``(case_ref, voided_at)`` pairs.

    Empty with no previous run (``since is None``) -- there is no "since" to
    measure against, so nothing carries forward silently.
    """
    if since is None:
        return ()
    void = current[current["status"] == VOID_STATUS]
    has_title = void["title"].notna() & (void["title"].astype(str).str.strip() != "")
    has_voided_at = void["voided_at"].notna()
    void = void[has_title & has_voided_at]
    pending = [
        (str(record["title"]), _local_instant(record["voided_at"]))
        for record in void.to_dict("records")
    ]
    return tuple((ref, voided_at) for ref, voided_at in pending if voided_at > since)


def unallocated_count(current: pd.DataFrame, candidate_refs: set[str]) -> int:
    """Cases in ``To-allocate``, joined by title to this run's own candidates.

    One status equality (CONTEXT.md's Hopper entry, post-#768) -- never a scan
    for a blank reviewer, which would reintroduce the by-elimination read #768
    removed. Scoped to *this run's* candidate population rather than a
    historical pool: a Case this run could select is this run's capacity to
    count, whether or not a past run happened to select it too.
    """
    unallocated = current[current["status"] == TO_ALLOCATE]
    has_title = unallocated["title"].notna() & (
        unallocated["title"].astype(str).str.strip() != ""
    )
    titles = set(unallocated.loc[has_title, "title"].astype(str))
    return len(titles & candidate_refs)


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
    return timestamps.parse_timestamp(record["timestamp"])


def assign_replacements(
    frame: pd.DataFrame, pending: Sequence[PendingVoid]
) -> pd.DataFrame:
    """Pair each pending void with an eligible row, oldest void first.

    For each void, in turn, the first rung in ``MATCH_LADDER`` with an
    unconsumed candidate wins; within a rung the oldest ``related_date`` wins
    (nulls last, an all-null tie degrading to ``frame``'s current -- i.e.
    priority-score -- order); no rung matching falls back to the oldest
    unconsumed row overall. Each row consumes at most one void, and a void
    with no unconsumed row left lapses. ``frame`` must already have a clean
    0..n-1 index (its row order *is* the tie-break), and is not mutated.
    """
    frame = frame.copy()
    frame["replaces_case_ref"] = None
    frame["void_match_rung"] = None
    consumed: set[Any] = set()

    def oldest(indices: list[Any]) -> Any:
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
                chosen = oldest(matches)
                rung_label = ",".join(rung)
                break
        if chosen is None:
            remaining = [idx for idx in frame.index if idx not in consumed]
            if not remaining:
                continue  # no unconsumed row left -- the void lapses
            chosen = oldest(remaining)
            rung_label = "oldest"
        frame.loc[chosen, "replaces_case_ref"] = void.case_ref
        frame.loc[chosen, "void_match_rung"] = rung_label
        consumed.add(chosen)
    return frame


def queue_order(frame: pd.DataFrame, pending: Sequence[PendingVoid]) -> pd.DataFrame:
    """Stable partition: this run's replacements lead, oldest void first.

    Queue order, not a second sort over the whole pool -- void-replacement
    rung is a relation between one void and one candidate, not a column every
    row can be ranked by. Only the rows a void actually claimed move: they
    lead in the order their void was raised, oldest first; every other row
    keeps whatever order the priority sort already gave it (a stable
    partition, so that relative order survives).
    """
    order = {
        void.case_ref: position
        for position, void in enumerate(sorted(pending, key=lambda v: v.voided_at))
    }

    def key(idx: Any) -> tuple[int, int]:
        ref = frame.at[idx, "replaces_case_ref"]
        if pd.notna(ref) and ref in order:
            return (0, order[ref])
        return (1, 0)

    return frame.loc[sorted(frame.index, key=key)].reset_index(drop=True)


def select_complaints(
    *datasets: Dataset,
    group: tuple[SelectionGroupMember, ...] = SELECTION_GROUP,
    since: dt.datetime | None = None,
    hopper_depth: int | None = None,
    run_date: dt.date | None = None,
) -> Dataset:
    """Combine, score, gate, replace voids, queue, cap -- the whole Selection.

    ``datasets`` arrive positionally in wiring order: one per ``group`` member,
    Sync's current Cases last. Returns **one row per considered Case**,
    carrying both the SelectionPool columns and the trace columns
    (``POOL_COLUMNS`` and ``TRACE_COLUMNS``) together -- every write downstream
    is a projection of this one dataset. The trace is built here rather than
    via ``.explain()`` because ``RowTrace.consider()`` seeds the considered
    population from the first ``ReadNode`` executed alone; with four reads
    feeding one transform, the framework's trace primitive has no way to see
    all four as one population (see docs/selection.md and ADR-0008).

    Order matters and two steps are load-bearing:

    - Each source's ``details`` dict is built *before* the concat below. After
      concat a numeric column upcasts across sources with differing dtypes
      (``amount`` becomes ``90.0``) and every row gains the other sources'
      keys as NaN -- ``json.dumps`` would then emit a bare, invalid ``NaN``
      into a field the frontend's ``JSON.parse`` rejects. Building it
      per-source keeps native types and only that source's own keys.
    - A pending void's ladder attributes are resolved from the candidate
      population *before* the voided gate runs -- the voided Case is itself a
      candidate row, and the gate removes it; resolving after would strip
      every void's attributes and silently degrade every match to the
      fallback rung.
    """
    if hopper_depth is None:
        hopper_depth = HOPPER_DEPTH
    if run_date is None:
        run_date = dt.date.today()

    *member_datasets, current_dataset = datasets
    current = current_dataset.to_pandas()
    ladder_fields = sorted({field for rung in MATCH_LADDER for field in rung})

    frames = []
    for member, dataset in zip(group, member_datasets, strict=True):
        renamed = Rename({member.case_ref_column: "case_ref"})(dataset)
        latest = LatestPerKey(key="case_ref", by="load_date")(renamed)
        rows = [
            {
                "case_ref": record["case_ref"],
                "case_type": member.case_type,
                "priority_score": age_in_days(
                    record[member.received_date_column], run_date
                ),
                "attribute_a": None,
                RELATED_DATE_COLUMN: (
                    None
                    if pd.isna(record[member.received_date_column])
                    else str(record[member.received_date_column])
                ),
                "details": {column: record[column] for column in member.detail_columns},
            }
            for record in latest.to_pandas().to_dict("records")
        ]
        frames.append(pd.DataFrame(rows, columns=_ROW_COLUMNS))
    candidates = pd.concat(frames, ignore_index=True, sort=False)

    candidate_by_ref = {row["case_ref"]: row for row in candidates.to_dict("records")}
    v_refs = voided_refs(current)
    pending = tuple(
        PendingVoid(
            ref,
            voided_at,
            {field: candidate_by_ref[ref][field] for field in ladder_fields},
        )
        for ref, voided_at in voids_since(current, since)
        if ref in candidate_by_ref  # never a candidate this run -- not ours to replace
    )

    considered = []
    for row in candidates.to_dict("records"):
        # A missing age travelled through the candidate frame as NaN (the
        # column upcasts to float); normalise it back to None so one check
        # below reads it, and the trace lands NULL rather than NaN.
        score = None if pd.isna(row["priority_score"]) else int(row["priority_score"])
        row = {
            **row,
            "priority_score": score,
            "score": score,
            "replaces_case_ref": None,
            "void_match_rung": None,
            "rank": None,
        }
        if row["case_ref"] in v_refs:
            row["verdict"] = "excluded"
            row["reason"] = "excluded by filter 'voided'"
        elif row["priority_score"] is None:
            row["verdict"] = "excluded"
            row["reason"] = "excluded by filter 'missing-received-date'"
        elif not within_max_age(row):
            row["verdict"] = "excluded"
            row["reason"] = "excluded by filter 'max-age'"
        else:
            row["verdict"] = None  # still eligible; resolved after the hopper cut
            row["reason"] = None
        considered.append(row)

    settled = [row for row in considered if row["verdict"] is not None]
    eligible_rows = [row for row in considered if row["verdict"] is None]
    eligible = pd.DataFrame(eligible_rows, columns=_ROW_COLUMNS)
    # Descending age: the oldest complaint leads the queue.
    eligible = eligible.sort_values(
        "priority_score", ascending=False, kind="stable"
    ).reset_index(drop=True)
    eligible = assign_replacements(eligible, pending)
    eligible = queue_order(eligible, pending)

    candidate_refs = set(candidates["case_ref"].astype(str))
    unallocated = unallocated_count(current, candidate_refs)
    capacity = max(0, hopper_depth - unallocated)

    queued = eligible.to_dict("records")
    for position, row in enumerate(queued):
        if position < capacity:
            row["verdict"] = "selected"
            row["reason"] = "passed voided, max-age"
            row["rank"] = position + 1
        else:
            row["verdict"] = "excluded"
            row["reason"] = f"excluded by gate 'hopper' (capacity {capacity})"
            row["rank"] = None

    return Dataset.from_pandas(pd.DataFrame(settled + queued, columns=_ROW_COLUMNS))


def project(dataset: Dataset, columns: Sequence[str]) -> Dataset:
    """Select ``dataset``'s named columns, in that order -- a plain projection."""
    frame = dataset.to_pandas()
    return Dataset.from_pandas(frame.loc[:, list(columns)].reset_index(drop=True))


def pool_rows(dataset: Dataset) -> Dataset:
    """Narrow ``select_complaints``'s considered population to the landed pool.

    Only survivors reach the pool; ``details`` is serialised to JSON text here
    (the pool table's declared type, and the migration's), with
    ``allow_nan=False`` so a residual float NaN fails the run rather than
    shipping invalid JSON. The JSON deliverable keeps the dict -- see
    ``select_complaints``.
    """
    projected = project(dataset, POOL_COLUMNS).to_pandas()
    projected["details"] = projected["details"].map(
        lambda value: json.dumps(value, allow_nan=False)
    )
    return Dataset.from_pandas(projected)


def selected_only(dataset: Dataset) -> Dataset:
    """Narrow ``select_complaints``'s considered population to the survivors.

    The shared parent of both deliverable projections: the pool row and the
    JSON row are the same selected Cases, projected to the same columns, and
    differ only in whether ``details`` is serialised.
    """
    frame = dataset.to_pandas()
    frame = frame[frame["verdict"] == "selected"].reset_index(drop=True)
    # The combined considered frame upcasts scores to float when any row has
    # no age (a missing received date is a None score); every survivor has
    # one, so land the declared integer rather than ``39.0``.
    frame["priority_score"] = frame["priority_score"].astype(int)
    return Dataset.from_pandas(frame)


def select_pool(
    *,
    member_readers: Sequence[Reader],
    current_cases: Reader,
    pool_writer: Writer,
    trace_writer: Writer,
    json_writer: Writer,
    since: dt.datetime | None = None,
    hopper_depth: int | None = None,
    run_date: dt.date | None = None,
    group: tuple[SelectionGroupMember, ...] = SELECTION_GROUP,
) -> tuple[Dataset, Dataset]:
    """The Selection flow: one read per member plus Sync, one decision, three
    projections.

    Written with the **eager steps**, so every line does its work when it is
    reached and the variable on the left holds the real rows -- put a breakpoint
    on ``select`` and step over it to watch the population narrow
    ([ADR-0027](../../docs/adr/0027-eager-steps-are-the-default-authoring-model.md)).

    ``member_readers`` aligns positionally with ``group`` -- the same order
    ``select_complaints`` receives the datasets in. Nothing here names a
    member: adding a Case Type to the group is one ``SELECTION_GROUP`` entry,
    and this function follows. ``select`` takes every read as a dataset
    argument, exactly as the graph node it replaces took input nodes: a fan-in
    is more arguments, not a graph.

    Line order is the ordering guarantee. The graph form needed a comment
    warning that leaf declaration order was load-bearing, because ``p.run()``
    returned its leaves in the order they were wired; here the pool is written
    before the trace because that line comes first, which is the same rule
    without having to know it.

    ``hopper_depth`` is resolved from ``HOPPER_DEPTH`` *inside*
    ``select_complaints`` when ``None``, rather than as this function's own
    default argument value: a default is bound once at import time, which
    would freeze the constant and defeat a test's monkeypatch of it. A ``None``
    ``run_date`` resolves the same way (to today), matching what a bare
    ``RunContext`` would have supplied.

    Returns the pool rows and the trace -- what the caller reports on.
    """
    reads = [
        read(reader, name=f"read-{member.case_type}")
        for member, reader in zip(group, member_readers, strict=True)
    ]
    current = read(current_cases, name="read-current-cases")

    selecting = functools.partial(
        select_complaints,
        group=group,
        since=since,
        hopper_depth=hopper_depth,
        run_date=run_date,
    )
    select = transform(selecting, *reads, current, name="select")
    selected = transform(selected_only, select, name="selected")

    rows_for_pool = transform(pool_rows, selected, name="pool-rows")
    validate(SchemaValidator(SelectedComplaint), rows_for_pool, name="validate")
    write(pool_writer, rows_for_pool, name="write-pool")

    trace = transform(
        functools.partial(project, columns=TRACE_COLUMNS), select, name="trace"
    )
    write(trace_writer, trace, name="write-trace")

    # The deliverable carries the same columns as the pool table -- but with
    # ``details`` left as a native nested object rather than JSON text, which is
    # why it is projected off ``selected`` rather than reusing ``pool-rows``.
    rows_for_json = transform(
        functools.partial(project, columns=POOL_COLUMNS), selected, name="json-rows"
    )
    write(json_writer, rows_for_json, name="write-json")
    return rows_for_pool, trace


def run(context: RunContext) -> Dataset:
    """Wire the real readers and writers for the environment and execute."""
    strategy = AccumulateByRun.from_context(context)
    store = StoreRegistry(context.base_dir).store(f"{OUTPUT_SUBJECT}/{PIPELINE_NAME}")
    json_path = Path(context.base_dir) / OUTPUT_SUBJECT / POOL_JSON
    since = previous_run_instant(context)

    pool, trace = select_pool(
        member_readers=[member.reader(context.base_dir) for member in SELECTION_GROUP],
        current_cases=CurrentCasesOrEmpty(context.base_dir),
        pool_writer=store.writer(POOL_TABLE, strategy),
        trace_writer=store.writer(TRACE_TABLE, strategy),
        json_writer=JsonWriter(json_path, Refresh()),
        since=since,
        run_date=context.run_date,
    )

    trace_frame = trace.to_pandas()
    considered = len(trace_frame)
    excluded = int((trace_frame["verdict"] == "excluded").sum())
    replaced = int(pool.to_pandas()["replaces_case_ref"].notna().sum())
    print(
        f"considered: {considered} -> "
        f"SelectionPool: {len(pool)} cases "
        f"(logical run {context.logical_run_id}); "
        f"excluded: {excluded}; replaced: {replaced}"
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
    args = parser.parse_args(argv[1:])
    try:
        base_dir = Path(args.base_dir) if args.base_dir else resolve_base_dir(args.env)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    # The *same* run_pipeline the operator CLI uses, so a run started here and
    # one started with `cli run` record under one identity -- one pipeline label,
    # one logical_run_id, one run history. That label is the bare pipeline name,
    # which is what the declared UPSTREAMS resolve their upstreams under.
    try:
        run_pipeline(run, PIPELINE_NAME, base_dir, upstreams=UPSTREAMS)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))
