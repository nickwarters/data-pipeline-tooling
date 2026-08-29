"""Complaint Selection: the SAS complaints export's Selection group.

Complaints A/B/C are one SAS complaints export split three ways, each with its
own Case Type ingest (source -> raw -> silver, no gold -- see
``pipelines/complaints_a`` and its siblings). This pipeline is the one place
the three become a **Selection group**: it reads each Case Type's silver and
the sync feed's current Cases, then narrows the combined candidates to the
SelectionPool through a chain of domain-named steps -- score, gate, replace
voids, cap -- each its own transform in the run log. The gates run first and
are vectorised: the excluded population grows with the feeds' history, so
the per-row work (the void ladder, Case Details) only ever touches the
eligible slice.

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
from typing import Any, Sequence

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

# The initial Hopper depth is three times the group's daily assignment rate;
# tune it from observed throughput.
HOPPER_DEPTH = 60

# The complaints export is weekly (weekly_complaints_export.sas), so a daily
# schedule needs slack past one week to still find it fresh.
INGEST_MAX_AGE_DAYS = 10

# Hopper eligibility uses explicit sync statuses, not reviewer presence.
TO_ALLOCATE = "To-allocate"
VOID_STATUS = "Void"

# Ordered match attempts, tried per void until one has an unconsumed candidate.
# Each field must be a top-level candidate column. ``attribute_a`` is reserved
# for a future cross-Case-Type attribute, so the live rung is ``("case_type",)``.
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

# The selection trace's five declared columns.
TRACE_COLUMNS: tuple[str, ...] = ("case_ref", "verdict", "reason", "rank", "score")

# Every column a considered Case carries through the gates -- pool and trace
# columns together, ``details`` excepted: Case Details are attached to
# survivors only (``attach_details``), so the wide candidate path never
# builds them. Declared explicitly so an empty source or an empty candidate
# population still yields these columns rather than none.
_CANDIDATE_COLUMNS: tuple[str, ...] = tuple(
    column
    for column in dict.fromkeys((*POOL_COLUMNS, *TRACE_COLUMNS))
    if column != "details"
)


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

    Uses one status equality, never a scan for a blank reviewer. Scoped to
    *this run's* candidate population rather than a
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


def _latest_member_rows(member: SelectionGroupMember, dataset: Dataset) -> pd.DataFrame:
    """One row per Case for one member: renamed key, latest observation."""
    renamed = Rename({member.case_ref_column: "case_ref"})(dataset)
    return LatestPerKey(key="case_ref", by="load_date")(renamed).to_pandas()


def score_candidates(
    *member_datasets: Dataset,
    group: tuple[SelectionGroupMember, ...] = SELECTION_GROUP,
    run_date: dt.date | None = None,
) -> Dataset:
    """Every Case the group can see, scored -- one vectorised frame.

    One row per member Case (its latest observation), carrying the shared
    ``_CANDIDATE_COLUMNS`` only. The score is the group's one priority rule:
    the complaint's age in days, ``received_date`` measured against
    ``run_date`` (not the wall clock, so a re-drive of a past run date
    recomputes the same scores; ``None`` resolves to today, matching a bare
    ``RunContext``). A missing or unparseable date scores NaN -- the max-age
    gate excludes those rows explicitly rather than inventing an age.
    ``related_date`` carries the same received date, so the void ladder's
    tie-break reads the date the queue is ordered by. Case Details are
    deliberately absent: they are attached to survivors only, in
    ``attach_details``.
    """
    if run_date is None:
        run_date = dt.date.today()
    frames = []
    for member, dataset in zip(group, member_datasets, strict=True):
        latest = _latest_member_rows(member, dataset)
        if latest.empty:
            continue
        received_text = latest[member.received_date_column]
        # ISO8601 accepts a bare date and Sync-style datetime text alike (a
        # single inferred format would coerce whichever shape came second to
        # NaT); anything non-ISO coerces to NaT and the max-age gate excludes
        # it. normalize() drops the time part: ages are whole calendar days.
        received = pd.to_datetime(
            received_text, errors="coerce", format="ISO8601"
        ).dt.normalize()
        age = (pd.Timestamp(run_date) - received).dt.days
        frame = pd.DataFrame(
            {
                "case_ref": latest["case_ref"].astype(str),
                "case_type": member.case_type,
                "priority_score": age,
                "attribute_a": None,
                RELATED_DATE_COLUMN: received_text.where(received_text.notna(), None),
                "replaces_case_ref": None,
                "void_match_rung": None,
                "verdict": None,
                "reason": None,
                "rank": None,
                "score": age,
            }
        )
        frames.append(frame[list(_CANDIDATE_COLUMNS)])
    if not frames:
        return Dataset.from_pandas(pd.DataFrame(columns=list(_CANDIDATE_COLUMNS)))
    return Dataset.from_pandas(pd.concat(frames, ignore_index=True))


def gate_voided(candidates: Dataset, current_cases: Dataset) -> Dataset:
    """Exclude every currently-voided Case -- one vectorised mask.

    First gate on purpose: a voided Case's verdict wins over any other
    reason the row might also have been excluded for.
    """
    frame = candidates.to_pandas().copy()
    voided = frame["case_ref"].isin(voided_refs(current_cases.to_pandas()))
    frame.loc[voided, "verdict"] = "excluded"
    frame.loc[voided, "reason"] = "excluded by filter 'voided'"
    return Dataset.from_pandas(frame)


def gate_max_age(candidates: Dataset) -> Dataset:
    """The age window, vectorised: only a complaint *younger* than
    ``MAX_AGE_DAYS`` stays eligible, and a missing or unparseable received
    date is excluded explicitly rather than given an invented age.

    Early and vectorised deliberately: the excluded population only grows as
    the feeds accumulate history (every complaint ever landed is considered
    each run, and most age out), so the per-row work downstream -- the void
    ladder, Case Details -- must never loop over it.
    """
    frame = candidates.to_pandas().copy()
    open_rows = frame["verdict"].isna()
    missing = open_rows & frame["priority_score"].isna()
    frame.loc[missing, "verdict"] = "excluded"
    frame.loc[missing, "reason"] = "excluded by filter 'missing-received-date'"
    too_old = open_rows & ~missing & (frame["priority_score"] >= MAX_AGE_DAYS)
    frame.loc[too_old, "verdict"] = "excluded"
    frame.loc[too_old, "reason"] = "excluded by filter 'max-age'"
    return Dataset.from_pandas(frame)


def replace_voids(
    candidates: Dataset,
    current_cases: Dataset,
    *,
    since: dt.datetime | None = None,
) -> Dataset:
    """Order the eligible queue and pair pending voids with replacements.

    The eligible slice is sorted oldest first (descending age, a stable
    sort), each void since the previous run is paired like-for-like by
    ``assign_replacements``, and the claimed rows jump the queue via
    ``queue_order``. Only that slice is processed row-wise -- its size is
    bounded by the age window, while the settled rows pass through untouched
    (they still land in the trace).

    A pending void's ladder attributes are resolved from the *whole*
    candidate frame, not the eligible slice: the voided Case is itself a
    candidate row the voided gate has already settled, and its attributes
    are what the ladder matches a replacement against.
    """
    frame = candidates.to_pandas()
    current = current_cases.to_pandas()

    ladder_fields = sorted({field for rung in MATCH_LADDER for field in rung})
    by_ref = frame.drop_duplicates("case_ref", keep="last").set_index("case_ref")
    pending = tuple(
        PendingVoid(
            ref,
            voided_at,
            {field: by_ref.at[ref, field] for field in ladder_fields},
        )
        for ref, voided_at in voids_since(current, since)
        if ref in by_ref.index  # never a candidate this run -- not ours to replace
    )

    settled = frame[frame["verdict"].notna()]
    eligible = (
        frame[frame["verdict"].isna()]
        # Descending age: the oldest complaint leads the queue.
        .sort_values("priority_score", ascending=False, kind="stable")
        .reset_index(drop=True)
    )
    eligible = assign_replacements(eligible, pending)
    eligible = queue_order(eligible, pending)
    return Dataset.from_pandas(pd.concat([settled, eligible], ignore_index=True))


def apply_hopper(
    candidates: Dataset,
    current_cases: Dataset,
    *,
    hopper_depth: int | None = None,
) -> Dataset:
    """Cap the queue at the Hopper's remaining capacity; settle every verdict.

    Capacity is the declared depth minus a direct count of the group's own
    Cases sitting in ``To-allocate`` (``unallocated_count``). The first
    ``capacity`` rows of the queue are selected and ranked by queue position,
    vectorised; the rest are cut with the capacity recorded in the trace
    reason. ``hopper_depth`` resolves from ``HOPPER_DEPTH`` *here* when
    ``None``, rather than as a caller's default argument value: a default is
    bound once at import time, which would freeze the constant and defeat a
    test's monkeypatch of it.
    """
    if hopper_depth is None:
        hopper_depth = HOPPER_DEPTH
    frame = candidates.to_pandas().copy()
    current = current_cases.to_pandas()

    candidate_refs = set(frame["case_ref"].astype(str))
    capacity = max(0, hopper_depth - unallocated_count(current, candidate_refs))

    eligible = frame["verdict"].isna()
    position = eligible.cumsum() - 1  # queue position, as replace_voids ordered it
    selected = eligible & (position < capacity)
    cut = eligible & ~selected
    frame.loc[selected, "verdict"] = "selected"
    frame.loc[selected, "reason"] = "passed voided, max-age"
    frame.loc[selected, "rank"] = position[selected] + 1
    frame.loc[cut, "verdict"] = "excluded"
    frame.loc[cut, "reason"] = f"excluded by gate 'hopper' (capacity {capacity})"
    return Dataset.from_pandas(frame)


def attach_details(
    selected: Dataset,
    *member_datasets: Dataset,
    group: tuple[SelectionGroupMember, ...] = SELECTION_GROUP,
) -> Dataset:
    """Attach each survivor's Case Details, per source, as a native dict.

    Built here -- after every gate and the Hopper cut -- and never for the
    considered majority: the survivor count is bounded by the Hopper depth,
    while the candidate population grows with the feeds' history. Built
    per source, from that member's own latest rows, so each dict carries
    only that source's declared ``detail_columns`` with their native types
    (one concat'd frame would upcast numeric columns across sources and gain
    the other sources' keys as NaN -- invalid JSON ``json.dumps`` cannot
    emit).
    """
    frame = selected.to_pandas().copy()
    details: dict[str, dict[str, Any]] = {}
    for member, dataset in zip(group, member_datasets, strict=True):
        refs = set(frame.loc[frame["case_type"] == member.case_type, "case_ref"])
        if not refs:
            continue
        latest = _latest_member_rows(member, dataset)
        rows = latest[latest["case_ref"].astype(str).isin(refs)]
        for record in rows.to_dict("records"):  # bounded by the Hopper depth
            details[str(record["case_ref"])] = {
                column: record[column] for column in member.detail_columns
            }
    frame["details"] = frame["case_ref"].map(details)
    return Dataset.from_pandas(frame)


def project(dataset: Dataset, columns: Sequence[str]) -> Dataset:
    """Select ``dataset``'s named columns, in that order -- a plain projection."""
    frame = dataset.to_pandas()
    return Dataset.from_pandas(frame.loc[:, list(columns)].reset_index(drop=True))


def pool_rows(dataset: Dataset) -> Dataset:
    """Project the detailed survivors down to the landed pool row.

    ``details`` is serialised to JSON text here (the pool table's declared
    type, and the migration's), with ``allow_nan=False`` so a residual float
    NaN fails the run rather than shipping invalid JSON. The JSON deliverable
    keeps the dict -- see ``attach_details``.
    """
    projected = project(dataset, POOL_COLUMNS).to_pandas()
    projected["details"] = projected["details"].map(
        lambda value: json.dumps(value, allow_nan=False)
    )
    return Dataset.from_pandas(projected)


def selected_only(dataset: Dataset) -> Dataset:
    """Narrow the considered population to the survivors.

    The shared parent of both deliverable projections: the pool row and the
    JSON row are the same selected Cases, projected to the same columns, and
    differ only in whether ``details`` is serialised.
    """
    frame = dataset.to_pandas()
    frame = frame[frame["verdict"] == "selected"].reset_index(drop=True)
    # The considered frame's score column is float when any row has no age
    # (a missing received date scores NaN); every survivor has one, so land
    # the declared integer rather than ``39.0``.
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
    """The Selection flow: reads, five named decisions, three projections.

    Each step is named for the domain decision it makes -- ``candidates``,
    ``gate-voided``, ``gate-max-age``, ``replace-voids``, ``hopper`` -- not
    for a framework primitive. The gates are vectorised and run first; the
    row-wise work (the void ladder, Case Details) only ever touches what
    survives them. A gate settles verdict/reason columns rather than dropping
    rows, so one considered frame flows through every step and the trace is a
    projection of the ``hopper`` step's output.

    ``member_readers`` aligns positionally with ``group``. Nothing here names
    a member: adding a Case Type to the group is one ``SELECTION_GROUP``
    entry, and this function follows.

    Line order is the ordering guarantee: the pool is written before the trace.

    ``hopper_depth`` is resolved from ``HOPPER_DEPTH`` inside ``apply_hopper``
    when ``None``, rather than as this function's own default argument value:
    a default is bound once at import time, which would freeze the constant
    and defeat a test's monkeypatch of it. A ``None`` ``run_date`` resolves
    the same way (to today, in ``score_candidates``), matching what a bare
    ``RunContext`` would have supplied.

    Returns the pool rows and the trace -- what the caller reports on.
    """
    reads = [
        read(reader, name=f"read-{member.case_type}")
        for member, reader in zip(group, member_readers, strict=True)
    ]
    current = read(current_cases, name="read-current-cases")

    candidates = transform(
        functools.partial(score_candidates, group=group, run_date=run_date),
        *reads,
        name="candidates",
    )
    candidates = transform(gate_voided, candidates, current, name="gate-voided")
    candidates = transform(gate_max_age, candidates, name="gate-max-age")
    candidates = transform(
        functools.partial(replace_voids, since=since),
        candidates,
        current,
        name="replace-voids",
    )
    considered = transform(
        functools.partial(apply_hopper, hopper_depth=hopper_depth),
        candidates,
        current,
        name="hopper",
    )

    selected = transform(selected_only, considered, name="selected")
    selected = transform(
        functools.partial(attach_details, group=group), selected, *reads, name="details"
    )

    rows_for_pool = transform(pool_rows, selected, name="pool-rows")
    validate(SchemaValidator(SelectedComplaint), rows_for_pool, name="validate")
    write(pool_writer, rows_for_pool, name="write-pool")

    trace = transform(
        functools.partial(project, columns=TRACE_COLUMNS), considered, name="trace"
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
