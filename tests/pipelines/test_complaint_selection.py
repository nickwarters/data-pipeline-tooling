"""Tests for ``complaint_selection``: the deployed Complaints A/B/C Selection group.

Complaints A/B/C stop at silver, so this pipeline is what turns three separate
Case Type ingests into one governed Selection group: combine, score, gate,
rank, stamp, and land both the SelectionPool and its explain trace.
"""

from __future__ import annotations

import datetime as dt
import json

import pytest

from framework.io import AccumulateByRun
from framework.run import FreshnessError, RunContext, run_pipeline
from pipelines.complaint_selection.pipeline import (
    OUTPUT_SUBJECT,
    PIPELINE_NAME,
    POOL_JSON,
    POOL_TABLE,
    TRACE_TABLE,
    UPSTREAMS,
    amount_priority,
    meets_priority_threshold,
    priority_band,
    run,
    selection_builder,
    slow_resolution_priority,
)
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
        "  [Transform] filter (depends on: score)",
        "  [Transform] sort (depends on: filter)",
        "  [Transform] select (depends on: sort)",
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


def _seed_group(tmp_path) -> None:
    """One row above and one below threshold, in each of the three Case Types."""
    _seed_silver(
        tmp_path,
        "complaints_a",
        [
            {"record_id": "R001", "label": "alpha", "amount": 90},
            {"record_id": "R002", "label": "beta", "amount": 10},
        ],
    )
    _seed_silver(
        tmp_path,
        "complaints_b",
        [
            {"record_id": "B1", "category": "sales", "priority": "high"},
            {"record_id": "B2", "category": "sales", "priority": "low"},
        ],
    )
    _seed_silver(
        tmp_path,
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
            row["question_bank_id"],
        )
        for row in pool
    ] == [
        ("B1", "complaints_b", 100, "qb-complaints"),
        ("R001", "complaints_a", 90, "qb-complaints"),
        ("C1", "complaints_c", 70, "qb-complaints"),
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
