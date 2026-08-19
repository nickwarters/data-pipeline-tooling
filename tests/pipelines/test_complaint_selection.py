"""Tests for ``complaint_selection``: the deployed Complaints A/B/C Selection group.

Complaints A/B/C stop at silver, so this pipeline is what turns three separate
Case Type ingests into one governed Selection group: combine, score, gate,
replace voids like-for-like (ADR-0021, reduced), rank, stamp, and land both
the SelectionPool and its explain trace.
"""

from __future__ import annotations

import datetime as dt
import json

import pytest

from framework.io import AccumulateByRun, Refresh
from framework.run import FreshnessError, RunContext, run_pipeline
from pipelines.complaint_selection.pipeline import (
    OUTPUT_SUBJECT,
    PIPELINE_NAME,
    POOL_JSON,
    POOL_TABLE,
    TRACE_TABLE,
    UPSTREAMS,
    amount_priority,
    assign_replacements,
    meets_priority_threshold,
    pending_voids,
    previous_run_instant,
    priority_band,
    run,
    selection_builder,
    slow_resolution_priority,
    voided_cases,
)
from pipelines.complaint_selection.schema import PendingVoid
from tests.framework_testing import (
    RecordingWriter,
    build_databases,
    given_rows,
    read_rows,
    read_run_log,
)
from tools.medallion import medallion
from tools.observability.run_log import RunLog
from tools.store import StoreRegistry

_VOIDED_AT = dt.datetime(2026, 8, 18, 9, 0, tzinfo=dt.timezone.utc)


def test_the_plan_is_exactly_the_steps_it_always_has():
    """Pin the plan, node for node, so a change to it is a deliberate one."""
    reader = given_rows([])
    writer, rejects, json_writer = (
        RecordingWriter(),
        RecordingWriter(),
        RecordingWriter(),
    )

    plan = selection_builder(reader, writer, rejects, json_writer).describe()
    assert plan.splitlines() == [
        "Pipeline: complaint_selection:pool",
        "  [Read] read",
        "  [Transform] score (depends on: read)",
        "  [Transform] voided (depends on: score)",
        "  [Transform] filter (depends on: voided)",
        "  [Transform] sort (depends on: filter)",
        "  [Transform] replace-voids (depends on: sort)",
        "  [Transform] select (depends on: replace-voids)",
        "  [Transform] stamp (depends on: select)",
        "  [Validate] post-validate (depends on: stamp)",
        "  [Explain] explain (depends on: post-validate)",
        "  [Write] write (depends on: post-validate)",
        "  [Write] write-json (depends on: post-validate)",
    ]


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
    """One row above and one below threshold, in each of the three Case Types."""
    _seed_silver(
        base_dir,
        "complaints_a",
        [
            {"record_id": "R001", "label": "alpha", "amount": 90},
            {"record_id": "R002", "label": "beta", "amount": 10},
        ],
    )
    _seed_silver(
        base_dir,
        "complaints_b",
        [
            {"record_id": "B1", "category": "sales", "priority": "high"},
            {"record_id": "B2", "category": "sales", "priority": "low"},
        ],
    )
    _seed_silver(
        base_dir,
        "complaints_c",
        [
            {"record_id": "C1", "department": "hr", "resolution_days": 70},
            {"record_id": "C2", "department": "hr", "resolution_days": 5},
        ],
    )


def test_narrows_ranks_and_lands_the_group_pool_and_json(tmp_path):
    base_dir = build_databases(tmp_path, "selection_output")
    _seed_group(base_dir)

    run(RunContext(base_dir=base_dir, pipeline=PIPELINE_NAME))

    store = StoreRegistry(base_dir).store(f"{OUTPUT_SUBJECT}/{PIPELINE_NAME}")
    pool = read_rows(store, POOL_TABLE)
    assert [
        (
            row["case_ref"],
            row["case_type"],
            row["priority_score"],
            row["attribute_a"],
            row["related_date"],
            row["replaces_case_ref"],
            row["void_match_rung"],
            row["question_bank_id"],
        )
        for row in pool
    ] == [
        ("B1", "complaints_b", 100, None, None, None, None, "qb-complaints"),
        ("R001", "complaints_a", 90, None, None, None, None, "qb-complaints"),
        ("C1", "complaints_c", 70, None, None, None, None, "qb-complaints"),
    ]

    landed = json.loads((base_dir / OUTPUT_SUBJECT / POOL_JSON).read_text())
    assert [row["case_ref"] for row in landed] == ["B1", "R001", "C1"]


def test_an_excluded_case_lands_in_the_trace_with_its_score_and_reason(tmp_path):
    base_dir = build_databases(tmp_path, "selection_output")
    _seed_group(base_dir)

    run(RunContext(base_dir=base_dir, pipeline=PIPELINE_NAME))

    store = StoreRegistry(base_dir).store(f"{OUTPUT_SUBJECT}/{PIPELINE_NAME}")
    trace = {row["case_ref"]: row for row in read_rows(store, TRACE_TABLE)}

    excluded = trace["R002"]
    assert excluded["verdict"] == "excluded"
    assert "priority-threshold" in excluded["reason"]
    assert excluded["score"] == 10

    selected = trace["R001"]
    assert selected["verdict"] == "selected"
    assert selected["score"] == 90


def test_latest_per_key_keeps_only_the_most_recent_observation(tmp_path):
    base_dir = build_databases(tmp_path, "selection_output")
    _seed_silver(
        base_dir,
        "complaints_a",
        [{"record_id": "R001", "label": "alpha", "amount": 10}],
        load_date="2026-08-10",
    )
    _seed_silver(
        base_dir,
        "complaints_a",
        [{"record_id": "R001", "label": "alpha", "amount": 90}],
        load_date="2026-08-17",
    )
    _seed_silver(
        base_dir,
        "complaints_b",
        [{"record_id": "B9", "category": "sales", "priority": "low"}],
    )
    _seed_silver(
        base_dir,
        "complaints_c",
        [{"record_id": "C9", "department": "hr", "resolution_days": 1}],
    )

    run(RunContext(base_dir=base_dir, pipeline=PIPELINE_NAME))

    store = StoreRegistry(base_dir).store(f"{OUTPUT_SUBJECT}/{PIPELINE_NAME}")
    pool = read_rows(store, POOL_TABLE)
    # B9 and C9 are both below threshold, so only the later R001 observation
    # (amount=90, not the superseded amount=10) can appear at all.
    assert [(row["case_ref"], row["priority_score"]) for row in pool] == [("R001", 90)]


def test_freshness_requirement_resolves_against_path_addressed_ingest_history(
    tmp_path, monkeypatch
):
    """The bare, path-addressed label -- ``python -m cli run pipelines/complaints_a``
    and its siblings -- is what the declared ``UPSTREAMS`` actually resolve
    against, so a recent run under that label satisfies it as real history, not
    the silent "no history, allow" first-run fallback.
    """
    base_dir = build_databases(tmp_path, "selection_output")
    _seed_group(base_dir)
    monkeypatch.setattr(
        "tools.observability.run_log.utc_now_iso",
        lambda: "2026-08-18T00:00:00+00:00",
    )
    for member in ("complaints_a", "complaints_b", "complaints_c"):
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
    assert len(freshness) == 3
    assert [record["status"] for record in freshness] == ["ok", "ok", "ok"]
    # A first-run warn would mean the guard found no history at all -- exactly
    # the failure mode this test guards against.
    assert [record["warn_hits"] for record in freshness] == [[], [], []]


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


def test_pure_scorers_and_threshold_are_named_testable_functions():
    assert amount_priority({"amount": 42}) == 42
    assert priority_band({"priority": "high"}) == 100
    assert priority_band({"priority": "medium"}) == 50
    assert priority_band({"priority": "low"}) == 10
    assert slow_resolution_priority({"resolution_days": 7}) == 7

    assert meets_priority_threshold({"priority_score": 50}) is True
    assert meets_priority_threshold({"priority_score": 49}) is False


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
            {"record_id": "R001", "label": "alpha", "amount": 90},
            {"record_id": "R003", "label": "gamma", "amount": 60},
        ],
    )
    _seed_silver(
        base_dir,
        "complaints_b",
        [{"record_id": "B1", "category": "x", "priority": "high"}],
    )
    _seed_silver(
        base_dir,
        "complaints_c",
        [{"record_id": "C1", "department": "hr", "resolution_days": 70}],
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
    assert {"R001", "R003"} <= after_run_1  # both cleared threshold in run 1

    _seed_case_current(
        base_dir,
        [
            {
                "title": "R001",
                "status": "Void",
                "voided_at": "2026-08-18 09:30:00",
                "case_type": "complaints_a",
            }
        ],
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
    """How a bare ``run()`` call and most tests reach ``pending_voids`` -- with
    no registry there is no "since", so voids never carry forward silently.
    """
    context = RunContext(base_dir=tmp_path, pipeline=PIPELINE_NAME)
    assert previous_run_instant(context) is None


def test_voided_cases_sees_nothing_when_the_sync_feed_is_absent(tmp_path):
    """The soft dependency: no sharepoint_cases gold, no voids, no failure."""
    assert voided_cases(tmp_path) == ()


def test_voided_cases_drops_blank_titles_and_missing_voided_at(tmp_path):
    base_dir = build_databases(tmp_path, "sharepoint_cases/gold")
    _seed_case_current(
        base_dir,
        [
            {
                "title": "R001",
                "status": "Void",
                "voided_at": "2026-08-18 09:30:00",
                "case_type": "complaints_a",
            },
            {
                "title": None,
                "status": "Void",
                "voided_at": "2026-08-18 09:30:00",
                "case_type": "complaints_a",
            },
            {
                "title": "",
                "status": "Void",
                "voided_at": "2026-08-18 09:30:00",
                "case_type": "complaints_a",
            },
            {
                "title": "R002",
                "status": "Void",
                "voided_at": None,
                "case_type": "complaints_a",
            },
            {
                "title": "R003",
                "status": "In-progress",
                "voided_at": None,
                "case_type": "complaints_a",
            },
        ],
    )

    assert [ref for ref, _ in voided_cases(base_dir)] == ["R001"]


def test_pending_voids_is_empty_with_no_previous_run():
    pool_reader = given_rows(
        [
            {
                "case_ref": "R1",
                "case_type": "a",
                "attribute_a": None,
                "load_date": "2026-08-18",
            }
        ]
    )

    assert (
        pending_voids(voided=(("R1", _VOIDED_AT),), since=None, pool_reader=pool_reader)
        == ()
    )


def test_pending_voids_ignores_a_void_on_or_before_since():
    since = _VOIDED_AT
    pool_reader = given_rows(
        [
            {
                "case_ref": "R1",
                "case_type": "a",
                "attribute_a": None,
                "load_date": "2026-08-18",
            }
        ]
    )

    result = pending_voids(
        voided=(("R1", since),), since=since, pool_reader=pool_reader
    )
    assert result == ()


def test_pending_voids_drops_a_void_absent_from_the_pool():
    since = _VOIDED_AT - dt.timedelta(days=1)
    pool_reader = given_rows(
        [
            {
                "case_ref": "R1",
                "case_type": "a",
                "attribute_a": None,
                "load_date": "2026-08-18",
            }
        ]
    )

    result = pending_voids(
        voided=(("NOT-IN-POOL", _VOIDED_AT),), since=since, pool_reader=pool_reader
    )
    assert result == ()


def test_full_ladder_precedence_from_best_match_to_fallback():
    pending = (PendingVoid("V", _VOIDED_AT, {"attribute_a": "x", "case_type": "a"}),)

    def replacement_for(rows: list[dict]) -> tuple[str, str]:
        out = assign_replacements(pending)(given_rows(rows).read()).to_pandas()
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

    out = assign_replacements(pending)(given_rows(rows).read()).to_pandas()

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

    out = assign_replacements(pending)(given_rows(rows).read()).to_pandas()

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

    out = assign_replacements(pending)(given_rows(rows).read()).to_pandas()

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

    out = assign_replacements(pending)(given_rows(rows).read()).to_pandas()

    assert out.loc[out["case_ref"] == "r1", "replaces_case_ref"].iloc[0] == "V1"
    assert out.loc[out["case_ref"] == "r2", "replaces_case_ref"].iloc[0] == "V2"
