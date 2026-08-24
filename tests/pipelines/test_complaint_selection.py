"""Tests for ``complaint_selection``: the deployed Complaints A/B/C Selection group.

Complaints A/B/C stop at silver, so this pipeline reads their current silver
plus Sync's current Cases and narrows them to the SelectionPool in one
governed transform, ``select_complaints`` -- score, gate, replace voids
like-for-like (ADR-0021, reduced), queue replacements ahead of the rest, cap
the queue at the Hopper's remaining capacity, and land both the SelectionPool
(with each source's own Case Details) and its trace.
"""

from __future__ import annotations

import datetime as dt
import json

import pandas as pd
import pytest

from framework.core import Dataset
from framework.io import AccumulateByRun, Refresh
from framework.run import FreshnessError, RunContext, active_context, run_pipeline
from pipelines.complaint_selection.pipeline import (
    OUTPUT_SUBJECT,
    PIPELINE_NAME,
    POOL_COLUMNS,
    POOL_JSON,
    POOL_TABLE,
    TRACE_TABLE,
    UPSTREAMS,
    age_in_days,
    assign_replacements,
    previous_run_instant,
    run,
    select_complaints,
    select_pool,
    unallocated_count,
    voided_refs,
    voids_since,
    within_max_age,
)
from pipelines.complaint_selection.schema import PendingVoid
from tests.framework_testing import (
    RecordingRunLog,
    RecordingWriter,
    build_databases,
    given_rows,
    make_dataset,
    read_rows,
    read_run_log,
)
from tools.medallion import medallion
from tools.observability.run_log import RunLog
from tools.store import StoreRegistry

_VOIDED_AT = dt.datetime(2026, 8, 18, 9, 0, tzinfo=dt.timezone.utc)
# The fixed run date every scoring test measures ages against.
_RUN_DATE = dt.date(2026, 8, 18)
_EMPTY_CURRENT = Dataset.from_pandas(
    pd.DataFrame(columns=["title", "status", "voided_at"])
)


def _current(rows: list[dict]) -> Dataset:
    return make_dataset(rows) if rows else _EMPTY_CURRENT


def test_the_steps_are_exactly_the_ones_it_always_took():
    """Pin what it does, step by step, so a change to it is a deliberate one.

    The steps are eager, so what the pipeline *did* is what it recorded -- a
    stronger pin than reading a plan, because it proves the steps ran rather
    than merely being wired.
    """
    # Real rows, not an empty frame: the steps execute, so each source has to
    # carry what the shared age rule reads -- ``received_date`` -- and
    # ``load_date``, which the old
    # plan test could leave out because describing a graph never touched data.
    reader_a = given_rows(
        [
            {
                "record_id": "R001",
                "label": "a",
                "amount": 90,
                "received_date": "2026-07-15",
                "load_date": "2026-08-18",
            }
        ]
    )
    reader_b = given_rows(
        [
            {
                "record_id": "B1",
                "category": "sales",
                "priority": "high",
                "received_date": "2026-07-15",
                "load_date": "2026-08-18",
            }
        ]
    )
    reader_c = given_rows(
        [
            {
                "record_id": "C1",
                "department": "hr",
                "resolution_days": 70,
                "received_date": "2026-07-15",
                "load_date": "2026-08-18",
            }
        ]
    )
    pool_w, trace_w, json_w = RecordingWriter(), RecordingWriter(), RecordingWriter()
    run_log = RecordingRunLog()

    class _Empty:
        def read(self) -> Dataset:
            return _EMPTY_CURRENT

    with active_context(RunContext(pipeline=PIPELINE_NAME, run_log=run_log)):
        select_pool(
            member_readers=[reader_a, reader_b, reader_c],
            current_cases=_Empty(),
            pool_writer=pool_w,
            trace_writer=trace_w,
            json_writer=json_w,
        )

    assert [record["step"] for record in run_log.records] == [
        "read-complaints_a",
        "read-complaints_b",
        "read-complaints_c",
        "read-current-cases",
        "select",
        "selected",
        "pool-rows",
        "validate",
        "write-pool",
        "trace",
        "write-trace",
        "json-rows",
        "write-json",
    ]
    # One label for the whole run: the grouping is in the step name, not in a
    # second identity the run also records under.
    assert {record["pipeline"] for record in run_log.records} == {PIPELINE_NAME}
    # Line order is the ordering guarantee now the graph is gone: the pool is
    # written before the trace because that line comes first.
    committed = [r["step"] for r in run_log.records if r.get("committed")]
    assert committed == ["write-pool", "write-trace", "write-json"]


def _seed_silver(
    base_dir, feed: str, rows: list[dict], *, load_date: str = "2026-08-18"
) -> None:
    silver = medallion(StoreRegistry(base_dir), feed).silver
    strategy = AccumulateByRun(f"seed-{feed}:{load_date}", load_date)
    silver.writer(feed, strategy).write(given_rows(rows).read())


def _seed_case_current(base_dir, rows: list[dict]) -> None:
    gold = medallion(StoreRegistry(base_dir), "sharepoint_cases").gold
    gold.writer("case_current", Refresh()).write(given_rows(rows).read())


def _seed_group(base_dir) -> None:
    """One row inside and one outside the age window, in each Case Type.

    Ages at the ``_RUN_DATE`` run date: B1 48d, R001 34d, C1 17d -- selected,
    oldest first; R002/B2/C2 are past ``MAX_AGE_DAYS`` and excluded.
    """
    _seed_silver(
        base_dir,
        "complaints_a",
        [
            {
                "record_id": "R001",
                "label": "alpha",
                "amount": 90,
                "received_date": "2026-07-15",
            },
            {
                "record_id": "R002",
                "label": "beta",
                "amount": 10,
                "received_date": "2026-06-01",
            },
        ],
    )
    _seed_silver(
        base_dir,
        "complaints_b",
        [
            {
                "record_id": "B1",
                "category": "sales",
                "priority": "high",
                "received_date": "2026-07-01",
            },
            {
                "record_id": "B2",
                "category": "sales",
                "priority": "low",
                "received_date": "2026-05-01",
            },
        ],
    )
    _seed_silver(
        base_dir,
        "complaints_c",
        [
            {
                "record_id": "C1",
                "department": "hr",
                "resolution_days": 70,
                "received_date": "2026-08-01",
            },
            {
                "record_id": "C2",
                "department": "hr",
                "resolution_days": 5,
                "received_date": "2026-06-20",
            },
        ],
    )


def test_narrows_ranks_and_lands_the_group_pool_and_json(tmp_path):
    base_dir = build_databases(tmp_path, "selection_output")
    _seed_group(base_dir)

    run(RunContext(base_dir=base_dir, pipeline=PIPELINE_NAME, run_date=_RUN_DATE))

    store = StoreRegistry(base_dir).store(f"{OUTPUT_SUBJECT}/{PIPELINE_NAME}")
    pool = read_rows(store, POOL_TABLE)
    assert [
        (row["case_ref"], row["case_type"], row["priority_score"]) for row in pool
    ] == [
        ("B1", "complaints_b", 48),
        ("R001", "complaints_a", 34),
        ("C1", "complaints_c", 17),
    ]
    # No Question Bank reference on the pool row: the platform derives the
    # bank from its own Case Type config, and migration 0003 drops the column.
    assert all("question_bank_id" not in row for row in pool)
    assert [row["attribute_a"] for row in pool] == [None, None, None]
    # ``related_date`` is live: each pool row carries its complaint's received
    # date -- the same date the age score above was computed from.
    assert [row["related_date"] for row in pool] == [
        "2026-07-01",
        "2026-07-15",
        "2026-08-01",
    ]

    landed = json.loads((base_dir / OUTPUT_SUBJECT / POOL_JSON).read_text())
    assert [row["case_ref"] for row in landed] == ["B1", "R001", "C1"]
    # The deliverable another system reads carries the pool columns and nothing
    # else -- in particular none of the trace's verdict/reason/rank/score.
    assert [tuple(row) for row in landed] == [POOL_COLUMNS] * 3


def test_an_excluded_case_lands_in_the_trace_with_its_score_and_reason(tmp_path):
    base_dir = build_databases(tmp_path, "selection_output")
    _seed_group(base_dir)

    run(RunContext(base_dir=base_dir, pipeline=PIPELINE_NAME, run_date=_RUN_DATE))

    store = StoreRegistry(base_dir).store(f"{OUTPUT_SUBJECT}/{PIPELINE_NAME}")
    trace = {row["case_ref"]: row for row in read_rows(store, TRACE_TABLE)}

    excluded = trace["R002"]
    assert excluded["verdict"] == "excluded"
    assert "max-age" in excluded["reason"]
    assert excluded["score"] == 78

    selected = trace["R001"]
    assert selected["verdict"] == "selected"
    assert selected["score"] == 34


def test_latest_per_key_keeps_only_the_most_recent_observation(tmp_path):
    base_dir = build_databases(tmp_path, "selection_output")
    _seed_silver(
        base_dir,
        "complaints_a",
        [
            {
                "record_id": "R001",
                "label": "alpha",
                "amount": 10,
                "received_date": "2026-06-01",
            }
        ],
        load_date="2026-08-10",
    )
    _seed_silver(
        base_dir,
        "complaints_a",
        [
            {
                "record_id": "R001",
                "label": "alpha",
                "amount": 90,
                "received_date": "2026-07-15",
            }
        ],
        load_date="2026-08-17",
    )
    _seed_silver(
        base_dir,
        "complaints_b",
        [
            {
                "record_id": "B9",
                "category": "sales",
                "priority": "low",
                "received_date": "2026-05-01",
            }
        ],
    )
    _seed_silver(
        base_dir,
        "complaints_c",
        [
            {
                "record_id": "C9",
                "department": "hr",
                "resolution_days": 1,
                "received_date": "2026-05-01",
            }
        ],
    )

    run(RunContext(base_dir=base_dir, pipeline=PIPELINE_NAME, run_date=_RUN_DATE))

    store = StoreRegistry(base_dir).store(f"{OUTPUT_SUBJECT}/{PIPELINE_NAME}")
    pool = read_rows(store, POOL_TABLE)
    # B9 and C9 are both outside the age window, so only the later R001
    # observation (received 2026-07-15, not the superseded 2026-06-01 -- which
    # would itself be outside the window) can appear at all.
    assert [(row["case_ref"], row["priority_score"]) for row in pool] == [("R001", 34)]


def test_freshness_requirement_resolves_against_path_addressed_ingest_history(
    tmp_path, monkeypatch
):
    """The bare, path-addressed label -- ``python -m cli run pipelines/complaints_a``
    and its siblings -- is what the declared ``UPSTREAMS`` actually resolve
    against, so a recent run under that label satisfies it as real history, not
    the silent "no history, allow" first-run fallback. ``sharepoint_cases`` is
    checked the same way, alongside the three ingests.
    """
    base_dir = build_databases(tmp_path, "selection_output")
    _seed_group(base_dir)
    monkeypatch.setattr(
        "tools.observability.run_log.utc_now_iso",
        lambda: "2026-08-18T00:00:00+00:00",
    )
    for member in ("complaints_a", "complaints_b", "complaints_c", "sharepoint_cases"):
        RunLog(base_dir / "_runs" / f"{member}.log").record("seed", member, "run", "ok")

    run_pipeline(
        run,
        PIPELINE_NAME,
        base_dir,
        upstreams=UPSTREAMS,
        run_date=dt.date(2026, 8, 18),
    )

    records = read_run_log(base_dir / "_runs" / f"{PIPELINE_NAME}.log")
    freshness = [record for record in records if record["step"] == "freshness"]
    assert len(freshness) == 4
    assert [record["status"] for record in freshness] == ["ok", "ok", "ok", "ok"]
    # A first-run warn would mean the guard found no history at all -- exactly
    # the failure mode this test guards against.
    assert [record["warn_hits"] for record in freshness] == [[], [], [], []]

    # The four reads this pipeline now issues each record their own step.
    read_steps = {record["step"] for record in records}
    assert {
        "read-complaints_a",
        "read-complaints_b",
        "read-complaints_c",
        "read-current-cases",
    } <= read_steps


def test_a_stale_ingest_beyond_the_widened_window_blocks_the_run(tmp_path, monkeypatch):
    base_dir = build_databases(tmp_path, "selection_output")
    _seed_group(base_dir)
    monkeypatch.setattr(
        "tools.observability.run_log.utc_now_iso",
        lambda: "2026-08-01T00:00:00+00:00",
    )
    for member in ("complaints_a", "complaints_b", "complaints_c"):
        RunLog(base_dir / "_runs" / f"{member}.log").record("seed", member, "run", "ok")

    with pytest.raises(FreshnessError, match="upstream complaints_a is stale"):
        run_pipeline(
            run,
            PIPELINE_NAME,
            base_dir,
            upstreams=UPSTREAMS,
            run_date=dt.date(2026, 8, 18),
        )


def test_a_stale_sharepoint_cases_record_blocks_the_run_same_day(tmp_path, monkeypatch):
    """The Hopper's own requirement: same-day, unlike the widened ingests.

    The three ingests are seeded fresh enough for their own (10-day) window, so
    this isolates the new, stricter ``sharepoint_cases`` requirement -- a
    cap must not be sized from a number that might already be stale.
    """
    base_dir = build_databases(tmp_path, "selection_output")
    _seed_group(base_dir)
    monkeypatch.setattr(
        "tools.observability.run_log.utc_now_iso",
        lambda: "2026-08-17T00:00:00+00:00",
    )
    for member in ("complaints_a", "complaints_b", "complaints_c", "sharepoint_cases"):
        RunLog(base_dir / "_runs" / f"{member}.log").record("seed", member, "run", "ok")

    with pytest.raises(FreshnessError, match="upstream sharepoint_cases is stale"):
        run_pipeline(
            run,
            PIPELINE_NAME,
            base_dir,
            upstreams=UPSTREAMS,
            run_date=dt.date(2026, 8, 18),
        )


def test_age_rule_and_max_age_gate_are_named_testable_functions():
    assert age_in_days("2026-07-29", dt.date(2026, 8, 18)) == 20
    # Sync-style datetime text is tolerated; only the date part is read.
    assert age_in_days("2026-08-18 09:30:00", dt.date(2026, 8, 18)) == 0
    assert age_in_days(None, dt.date(2026, 8, 18)) is None
    assert age_in_days("not-a-date", dt.date(2026, 8, 18)) is None

    # "Only include younger than": the boundary age itself is excluded.
    assert within_max_age({"priority_score": 49}) is True
    assert within_max_age({"priority_score": 50}) is False


def test_a_missing_received_date_is_excluded_not_guessed():
    a = given_rows(
        [
            {
                "record_id": "R001",
                "label": "x",
                "amount": 10,
                "received_date": None,
                "load_date": "2026-08-18",
            },
            {
                "record_id": "R002",
                "label": "y",
                "amount": 10,
                "received_date": "2026-08-01",
                "load_date": "2026-08-18",
            },
        ]
    ).read()
    empty = Dataset.from_pandas(pd.DataFrame(columns=["record_id", "load_date"]))

    out = select_complaints(
        a, empty, empty, _EMPTY_CURRENT, run_date=_RUN_DATE
    ).to_pandas()

    by_ref = {row["case_ref"]: row for _, row in out.iterrows()}
    assert by_ref["R001"]["verdict"] == "excluded"
    assert by_ref["R001"]["reason"] == "excluded by filter 'missing-received-date'"
    assert by_ref["R002"]["verdict"] == "selected"


# ── Void replacement (ADR-0021, reduced) ──────────────────────────────────


def test_a_void_since_the_previous_run_is_replaced_at_the_case_type_rung(
    tmp_path, monkeypatch
):
    """The regression test for the timestamp-grain bug.

    ``voided_at`` is voided on the *same calendar day* as run 1, strictly after
    its instant -- a naive-vs-offset string compare would have sorted the void
    before run 1's instant (the separator character alone decides it) and
    silently dropped it as "not since the previous run".
    """
    base_dir = build_databases(tmp_path, "sharepoint_cases/gold", "selection_output")
    _seed_silver(
        base_dir,
        "complaints_a",
        [
            {
                "record_id": "R001",
                "label": "alpha",
                "amount": 90,
                "received_date": "2026-07-15",
            },
            {
                "record_id": "R003",
                "label": "gamma",
                "amount": 60,
                "received_date": "2026-07-10",
            },
        ],
    )
    _seed_silver(
        base_dir,
        "complaints_b",
        [
            {
                "record_id": "B1",
                "category": "x",
                "priority": "high",
                "received_date": "2026-07-01",
            }
        ],
    )
    _seed_silver(
        base_dir,
        "complaints_c",
        [
            {
                "record_id": "C1",
                "department": "hr",
                "resolution_days": 70,
                "received_date": "2026-08-01",
            }
        ],
    )

    monkeypatch.setattr(
        "tools.observability.run_log.utc_now_iso",
        lambda: "2026-08-18T08:00:00+00:00",
    )
    run_pipeline(
        run, PIPELINE_NAME, base_dir, upstreams=(), run_date=dt.date(2026, 8, 18)
    )

    store = StoreRegistry(base_dir).store(f"{OUTPUT_SUBJECT}/{PIPELINE_NAME}")
    after_run_1 = {row["case_ref"] for row in read_rows(store, POOL_TABLE)}
    assert {"R001", "R003"} <= after_run_1  # both inside the age window in run 1

    _seed_case_current(
        base_dir,
        [{"title": "R001", "status": "Void", "voided_at": "2026-08-18 08:30:00"}],
    )

    run_pipeline(
        run, PIPELINE_NAME, base_dir, upstreams=(), run_date=dt.date(2026, 8, 18)
    )

    trace = {row["case_ref"]: row for row in read_rows(store, TRACE_TABLE)}
    assert trace["R001"]["verdict"] == "excluded"
    assert "voided" in trace["R001"]["reason"]

    pool = {row["case_ref"]: row for row in read_rows(store, POOL_TABLE)}
    assert "R001" not in pool
    # attribute_a is None on both sides (no feed carries it yet), so the ladder
    # falls through to its last rung -- the live rung today, and that is
    # expected and real, not a workaround.
    assert pool["R003"]["replaces_case_ref"] == "R001"
    assert pool["R003"]["void_match_rung"] == "case_type"


def test_previous_run_instant_is_none_for_a_plain_run_context(tmp_path):
    """How a bare ``run()`` call and most tests reach ``select_complaints`` --
    with no registry there is no "since", so voids never carry forward
    silently.
    """
    context = RunContext(base_dir=tmp_path, pipeline=PIPELINE_NAME)
    assert previous_run_instant(context) is None


def test_voided_refs_and_voids_since_ignore_blank_titles_and_missing_voided_at():
    current = pd.DataFrame(
        [
            {"title": "R001", "status": "Void", "voided_at": "2026-08-18 09:30:00"},
            {"title": None, "status": "Void", "voided_at": "2026-08-18 09:30:00"},
            {"title": "", "status": "Void", "voided_at": "2026-08-18 09:30:00"},
            {"title": "R002", "status": "Void", "voided_at": None},
            {"title": "R003", "status": "In-progress", "voided_at": None},
        ]
    )

    assert voided_refs(current) == frozenset({"R001", "R002"})

    since = dt.datetime(2026, 8, 18, 0, 0, tzinfo=dt.timezone.utc)
    assert [ref for ref, _ in voids_since(current, since)] == ["R001"]


def test_voids_since_is_empty_with_no_previous_run():
    current = pd.DataFrame(
        [{"title": "R001", "status": "Void", "voided_at": "2026-08-18 08:30:00"}]
    )
    assert voids_since(current, since=None) == ()


def test_full_ladder_precedence_from_best_match_to_fallback():
    pending = (PendingVoid("V", _VOIDED_AT, {"attribute_a": "x", "case_type": "a"}),)

    def replacement_for(rows: list[dict]) -> tuple[str, str]:
        out = assign_replacements(pd.DataFrame(rows), pending)
        matched = out.loc[out["replaces_case_ref"] == "V"]
        return matched["case_ref"].iloc[0], matched["void_match_rung"].iloc[0]

    # (attribute_a, case_type) beats both single-field rungs.
    assert replacement_for(
        [
            {
                "case_ref": "full",
                "case_type": "a",
                "attribute_a": "x",
                "related_date": None,
            },
            {
                "case_ref": "attr",
                "case_type": "b",
                "attribute_a": "x",
                "related_date": None,
            },
            {
                "case_ref": "type",
                "case_type": "a",
                "attribute_a": "y",
                "related_date": None,
            },
        ]
    ) == ("full", "attribute_a,case_type")

    # (attribute_a,) beats (case_type,) once the full rung has no candidate.
    assert replacement_for(
        [
            {
                "case_ref": "attr",
                "case_type": "b",
                "attribute_a": "x",
                "related_date": None,
            },
            {
                "case_ref": "type",
                "case_type": "a",
                "attribute_a": "y",
                "related_date": None,
            },
        ]
    ) == ("attr", "attribute_a")

    # (case_type,) wins once nothing shares attribute_a.
    assert replacement_for(
        [
            {
                "case_ref": "type",
                "case_type": "a",
                "attribute_a": "y",
                "related_date": None,
            }
        ]
    ) == ("type", "case_type")

    # No rung matches at all -> the "oldest" fallback.
    assert replacement_for(
        [
            {
                "case_ref": "none",
                "case_type": "z",
                "attribute_a": "q",
                "related_date": None,
            }
        ]
    ) == ("none", "oldest")


def test_within_a_rung_the_oldest_related_date_wins():
    pending = (PendingVoid("V", _VOIDED_AT, {"attribute_a": "x", "case_type": "a"}),)
    rows = [
        {
            "case_ref": "newer",
            "case_type": "a",
            "attribute_a": "x",
            "related_date": "2026-08-10",
        },
        {
            "case_ref": "older",
            "case_type": "a",
            "attribute_a": "x",
            "related_date": "2026-08-01",
        },
    ]

    out = assign_replacements(pd.DataFrame(rows), pending)

    assert out.loc[out["case_ref"] == "older", "replaces_case_ref"].iloc[0] == "V"
    assert out.loc[out["case_ref"] == "newer", "replaces_case_ref"].isna().all()


def test_fallback_degrades_to_the_frames_current_order_when_related_date_is_all_null():
    pending = (PendingVoid("V", _VOIDED_AT, {"attribute_a": None, "case_type": "zzz"}),)
    rows = [
        {
            "case_ref": "first",
            "case_type": "a",
            "attribute_a": None,
            "related_date": None,
        },
        {
            "case_ref": "second",
            "case_type": "b",
            "attribute_a": None,
            "related_date": None,
        },
    ]

    out = assign_replacements(pd.DataFrame(rows), pending)

    assert out.loc[out["case_ref"] == "first", "replaces_case_ref"].iloc[0] == "V"
    assert out.loc[out["case_ref"] == "second", "replaces_case_ref"].isna().all()


def test_a_void_with_no_unconsumed_row_left_lapses():
    pending = (
        PendingVoid("V1", _VOIDED_AT, {"attribute_a": None, "case_type": "a"}),
        PendingVoid(
            "V2",
            _VOIDED_AT + dt.timedelta(seconds=1),
            {"attribute_a": None, "case_type": "a"},
        ),
    )
    rows = [
        {
            "case_ref": "only",
            "case_type": "a",
            "attribute_a": None,
            "related_date": None,
        }
    ]

    out = assign_replacements(pd.DataFrame(rows), pending)

    # V1 (the older void) takes the one row; V2 lapses -- nothing records it.
    assert out.loc[out["case_ref"] == "only", "replaces_case_ref"].iloc[0] == "V1"
    assert "V2" not in out["replaces_case_ref"].tolist()


def test_each_row_consumes_at_most_one_void():
    pending = (
        PendingVoid("V1", _VOIDED_AT, {"attribute_a": None, "case_type": "a"}),
        PendingVoid(
            "V2",
            _VOIDED_AT + dt.timedelta(seconds=1),
            {"attribute_a": None, "case_type": "a"},
        ),
    )
    rows = [
        {
            "case_ref": "r1",
            "case_type": "a",
            "attribute_a": None,
            "related_date": "2026-08-01",
        },
        {
            "case_ref": "r2",
            "case_type": "a",
            "attribute_a": None,
            "related_date": "2026-08-02",
        },
    ]

    out = assign_replacements(pd.DataFrame(rows), pending)

    assert out.loc[out["case_ref"] == "r1", "replaces_case_ref"].iloc[0] == "V1"
    assert out.loc[out["case_ref"] == "r2", "replaces_case_ref"].iloc[0] == "V2"


# ── Hopper cap (ADR-0021) ──────────────────────────────────────────────────


_EMPTY_C = Dataset.from_pandas(pd.DataFrame(columns=["record_id", "load_date"]))


def test_hopper_gate_caps_the_queue_and_traces_the_cut_with_its_score():
    # r0 is the oldest (received 2026-07-01, 48 days) and leads the queue.
    rows = [
        {
            "record_id": f"r{i}",
            "label": "x",
            "amount": 10,
            "received_date": f"2026-07-0{i + 1}",
            "load_date": "2026-08-18",
        }
        for i in range(5)
    ]
    a = given_rows(rows).read()
    b = _EMPTY_C

    out = select_complaints(
        a, b, _EMPTY_C, _EMPTY_CURRENT, hopper_depth=3, run_date=_RUN_DATE
    ).to_pandas()

    selected = out[out["verdict"] == "selected"].sort_values("rank")
    assert selected["case_ref"].tolist() == ["r0", "r1", "r2"]

    cut = {
        row["case_ref"]: row for _, row in out[out["verdict"] == "excluded"].iterrows()
    }
    for ref in ("r3", "r4"):
        assert cut[ref]["reason"] == "excluded by gate 'hopper' (capacity 3)"
        assert cut[ref]["score"] is not None
        assert pd.isna(cut[ref]["rank"])


def _replacement_scenario(*, hopper_depth: int) -> pd.DataFrame:
    """``voided-a`` (complaints_a) is voided; ``repl`` (complaints_a, younger
    and so lower-scoring) is its sole ladder match; ``high`` (complaints_b) is
    an unrelated, older (higher-scoring) non-replacement candidate competing
    for the same slot.

    A void is only resolvable against a candidate this run can still see --
    its silver row is unaffected by its sync status -- so the voided title
    must be a real candidate ref, not an arbitrary string.
    """
    a = given_rows(
        [
            {
                "record_id": "voided-a",
                "label": "x",
                "amount": 70,
                "received_date": "2026-07-20",
                "load_date": "2026-08-18",
            },
            {
                "record_id": "repl",
                "label": "x",
                "amount": 55,
                "received_date": "2026-08-01",
                "load_date": "2026-08-18",
            },
        ]
    ).read()
    b = given_rows(
        [
            {
                "record_id": "high",
                "category": "x",
                "priority": "high",
                "received_date": "2026-07-01",
                "load_date": "2026-08-18",
            }
        ]
    ).read()
    current = _current(
        [{"title": "voided-a", "status": "Void", "voided_at": "2026-08-18 09:00:00"}]
    )
    since = dt.datetime(2026, 8, 18, 8, 0, tzinfo=dt.timezone.utc)
    return select_complaints(
        a,
        b,
        _EMPTY_C,
        current,
        since=since,
        hopper_depth=hopper_depth,
        run_date=_RUN_DATE,
    ).to_pandas()


def test_a_replacement_jumps_the_queue_ahead_of_a_higher_scorer():
    out = _replacement_scenario(hopper_depth=1)

    pool = out[out["verdict"] == "selected"]
    assert pool["case_ref"].tolist() == ["repl"]
    assert pool["replaces_case_ref"].iloc[0] == "voided-a"

    cut = out[(out["verdict"] == "excluded") & (out["case_ref"] == "high")].iloc[0]
    assert cut["reason"] == "excluded by gate 'hopper' (capacity 1)"
    assert cut["score"] == 48


def test_rank_reflects_queue_position_not_score():
    """``rank`` now records queue position: a replacement can outrank a higher
    scorer, and a survivor's reason never mentions the hopper.
    """
    # Capacity 2: both repl and high survive, isolating rank from the cut.
    out = _replacement_scenario(hopper_depth=2)

    by_ref = {row["case_ref"]: row for _, row in out.iterrows()}
    assert by_ref["repl"]["verdict"] == "selected"
    assert by_ref["repl"]["rank"] == 1
    assert by_ref["high"]["verdict"] == "selected"
    assert by_ref["high"]["rank"] == 2
    assert "hopper" not in by_ref["repl"]["reason"]
    assert "hopper" not in by_ref["high"]["reason"]


def test_unallocated_count_counts_to_allocate_cases_among_the_candidates():
    """Post-#768: one status equality, never a scan for a blank reviewer."""
    current = pd.DataFrame(
        [
            {"title": "R1", "status": "To-allocate"},
            {"title": "R2", "status": "To-allocate"},
            {"title": "R3", "status": "In-progress"},  # claimed -- not counted
            {"title": "R4", "status": "Void"},  # a void frees room, not counted
            {"title": "R5", "status": "To-allocate"},  # not a candidate this run
            {"title": None, "status": "To-allocate"},
            {"title": "", "status": "To-allocate"},
        ]
    )
    candidate_refs = {"R1", "R2", "R3", "R4"}

    assert unallocated_count(current, candidate_refs) == 2


def test_a_full_hopper_run_lands_zero_and_traces_the_denial(tmp_path, monkeypatch):
    base_dir = build_databases(tmp_path, "sharepoint_cases/gold", "selection_output")
    _seed_group(base_dir)  # selects B1, R001, C1

    run(RunContext(base_dir=base_dir, pipeline=PIPELINE_NAME, run_date=_RUN_DATE))

    store = StoreRegistry(base_dir).store(f"{OUTPUT_SUBJECT}/{PIPELINE_NAME}")
    selected = [row["case_ref"] for row in read_rows(store, POOL_TABLE)]
    assert len(selected) == 3

    _seed_case_current(
        base_dir, [{"title": ref, "status": "To-allocate"} for ref in selected]
    )
    # A fresh, in-window candidate for run 2 to consider and be denied.
    _seed_silver(
        base_dir,
        "complaints_a",
        [
            {
                "record_id": "R900",
                "label": "delta",
                "amount": 95,
                "received_date": "2026-08-10",
            }
        ],
        load_date="2026-08-19",
    )
    monkeypatch.setattr(
        "pipelines.complaint_selection.pipeline.HOPPER_DEPTH", len(selected)
    )

    run(RunContext(base_dir=base_dir, pipeline=PIPELINE_NAME, run_date=_RUN_DATE))

    assert read_rows(store, POOL_TABLE) == []
    trace = {row["case_ref"]: row for row in read_rows(store, TRACE_TABLE)}
    assert trace["R900"]["verdict"] == "excluded"
    assert "hopper" in trace["R900"]["reason"]


# ── Per-source Case Details ─────────────────────────────────────────────────


def test_details_reach_the_json_as_a_nested_object_with_native_types(tmp_path):
    base_dir = build_databases(tmp_path, "selection_output")
    _seed_silver(
        base_dir,
        "complaints_a",
        [
            {
                "record_id": "R001",
                "label": "alpha",
                "amount": 90,
                "received_date": "2026-07-15",
            }
        ],
    )
    _seed_silver(
        base_dir,
        "complaints_b",
        [
            {
                "record_id": "B1",
                "category": "sales",
                "priority": "high",
                "received_date": "2026-07-01",
            }
        ],
    )
    _seed_silver(
        base_dir,
        "complaints_c",
        [
            {
                "record_id": "C9",
                "department": "hr",
                "resolution_days": 1,
                "received_date": "2026-06-01",
            }
        ],  # outside the age window
    )

    run(RunContext(base_dir=base_dir, pipeline=PIPELINE_NAME, run_date=_RUN_DATE))

    landed = {
        row["case_ref"]: row
        for row in json.loads((base_dir / OUTPUT_SUBJECT / POOL_JSON).read_text())
    }
    assert landed["R001"]["details"] == {"amount": 90, "label": "alpha"}
    assert isinstance(landed["R001"]["details"]["amount"], int)
    assert landed["B1"]["details"] == {"category": "sales", "priority": "high"}


def test_details_land_as_json_text_in_the_pool_table(tmp_path):
    base_dir = build_databases(tmp_path, "selection_output")
    _seed_silver(
        base_dir,
        "complaints_a",
        [
            {
                "record_id": "R001",
                "label": "alpha",
                "amount": 90,
                "received_date": "2026-07-15",
            }
        ],
    )
    _seed_silver(
        base_dir,
        "complaints_b",
        [
            {
                "record_id": "B9",
                "category": "sales",
                "priority": "low",
                "received_date": "2026-05-01",
            }
        ],  # outside the age window
    )
    _seed_silver(
        base_dir,
        "complaints_c",
        [
            {
                "record_id": "C9",
                "department": "hr",
                "resolution_days": 1,
                "received_date": "2026-06-01",
            }
        ],  # outside the age window
    )

    run(RunContext(base_dir=base_dir, pipeline=PIPELINE_NAME, run_date=_RUN_DATE))

    store = StoreRegistry(base_dir).store(f"{OUTPUT_SUBJECT}/{PIPELINE_NAME}")
    [row] = read_rows(store, POOL_TABLE)
    assert isinstance(row["details"], str)
    assert json.loads(row["details"]) == {"amount": 90, "label": "alpha"}


def test_an_undeclared_silver_column_stays_out_of_details():
    # The age rule reads ``received_date``; a member's own detail_columns are
    # the only keys `select_complaints` ever copies into `details`, so neither
    # it nor an undeclared silver column leaks in.
    a = given_rows(
        [
            {
                "record_id": "R001",
                "label": "alpha",
                "amount": 90,
                "received_date": "2026-08-01",
                "run_id": "not-a-detail-field",
                "load_date": "2026-08-18",
            }
        ]
    ).read()
    b = Dataset.from_pandas(pd.DataFrame(columns=["record_id", "load_date"]))
    c = Dataset.from_pandas(pd.DataFrame(columns=["record_id", "load_date"]))

    out = select_complaints(a, b, c, _EMPTY_CURRENT, run_date=_RUN_DATE).to_pandas()

    assert out.iloc[0]["details"] == {"amount": 90, "label": "alpha"}


def test_an_empty_case_type_still_yields_declared_columns():
    a = given_rows(
        [
            {
                "record_id": "R001",
                "label": "alpha",
                "amount": 90,
                "received_date": "2026-08-01",
                "load_date": "2026-08-18",
            }
        ]
    ).read()
    b = Dataset.from_pandas(pd.DataFrame(columns=["record_id", "load_date"]))
    c = Dataset.from_pandas(pd.DataFrame(columns=["record_id", "load_date"]))

    out = select_complaints(a, b, c, _EMPTY_CURRENT, run_date=_RUN_DATE).to_pandas()

    assert out.iloc[0]["case_ref"] == "R001"
    assert "details" in out.columns


def test_zero_candidates_overall_runs_clean():
    """The framework #762 regression: no ``.apply(axis=1)`` anywhere here, so a
    genuinely empty run never hits pandas' empty-frame probe-call crash.
    """
    empty = Dataset.from_pandas(pd.DataFrame(columns=["record_id", "load_date"]))

    out = select_complaints(empty, empty, empty, _EMPTY_CURRENT)

    assert len(out) == 0
    assert "details" in out.to_pandas().columns
