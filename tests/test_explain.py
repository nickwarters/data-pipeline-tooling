"""Selection explainability — the per-Case trace of why a Case was/wasn't
selected (issue #53).

Selection's ``Filter``/``Score``/``JoinWith`` processors silently drop Cases
(ADR-0002 plain-Python callables), leaving no trace of *why* an adviser's Case
was or wasn't picked up — a governance gap management raised as a requirement.
``.explain(writer, id_column=...)`` is the quarantine-style terminus (#50) that
routes a per-Case verdict to a sibling trace table: who was considered, what
each scored, which gate excluded the rest, and how the survivors ranked.
"""

from __future__ import annotations

import json

import pandas as pd

from framework.builder import Pipeline
from framework.dataset import Dataset
from framework.processors import Filter, JoinWith, Score, Sort
from framework.readers import DatasetReader
from framework.store import Store
from framework.run_log import RunLog
from framework.strategy import AccumulateByRun


def _available() -> Dataset:
    """Three available Cases entering Selection — one below the value gate."""
    return Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_ref": ["c1", "c2", "c3"],
                "amount": [900, 150, 40],
            }
        )
    )


def _trace(store: Store) -> pd.DataFrame:
    return (
        store.reader("gold", "selection_trace")
        .read()
        .to_pandas()
        .set_index("case_ref")
    )


def test_case_dropped_by_filter_is_excluded_with_a_located_reason(tmp_path):
    store = Store(tmp_path)
    strategy = AccumulateByRun("run-1", "2026-05-29")
    (
        Pipeline("selection", DatasetReader(_available()))
        .with_processor(Filter(lambda r: r["amount"] >= 100, name="high-value"))
        .explain(
            store.writer("gold", "selection_trace", strategy),
            id_column="case_ref",
        )
        .write_to(store.writer("gold", "selection_pool", strategy))
        .run()
    )

    trace = _trace(store)
    # c3 (amount 40) fell below the value gate: excluded, reason names the gate.
    assert trace.loc["c3", "verdict"] == "excluded"
    assert "high-value" in trace.loc["c3", "reason"]
    assert "filter" in trace.loc["c3", "reason"]


def test_retained_case_is_selected_with_gates_passed_and_rank(tmp_path):
    store = Store(tmp_path)
    strategy = AccumulateByRun("run-1", "2026-05-29")
    (
        Pipeline("selection", DatasetReader(_available()))
        .with_processor(Filter(lambda r: r["amount"] >= 100, name="high-value"))
        .with_processor(Filter(lambda r: r["case_ref"] != "x", name="not-x"))
        .with_processor(Sort("amount", ascending=False))  # rank highest-amount first
        .explain(
            store.writer("gold", "selection_trace", strategy),
            id_column="case_ref",
        )
        .write_to(store.writer("gold", "selection_pool", strategy))
        .run()
    )

    trace = _trace(store)
    # c1 (900) and c2 (150) clear both gates; c1 ranks first after the sort.
    assert trace.loc["c1", "verdict"] == "selected"
    assert trace.loc["c1", "rank"] == 1
    assert trace.loc["c2", "rank"] == 2
    # The survivor's reason names every gate it passed, in order.
    assert "high-value" in trace.loc["c1", "reason"]
    assert "not-x" in trace.loc["c1", "reason"]
    # An excluded Case carries no rank.
    assert pd.isna(trace.loc["c3", "rank"])


def test_score_is_retained_for_every_considered_case_including_excluded(tmp_path):
    store = Store(tmp_path)
    strategy = AccumulateByRun("run-1", "2026-05-29")
    (
        Pipeline("selection", DatasetReader(_available()))
        # Score the whole population first, *then* drop the low scorers — so the
        # excluded Case's score must survive its exclusion (#53 AC2).
        .with_processor(Score("priority", lambda r: r["amount"] * 2))
        .with_processor(Filter(lambda r: r["amount"] >= 100, name="high-value"))
        .explain(
            store.writer("gold", "selection_trace", strategy),
            id_column="case_ref",
            score_column="priority",
        )
        .write_to(store.writer("gold", "selection_pool", strategy))
        .run()
    )

    trace = _trace(store)
    assert trace.loc["c1", "score"] == 1800  # selected, scored
    assert trace.loc["c3", "verdict"] == "excluded"
    assert trace.loc["c3", "score"] == 80  # excluded, yet its score is retained


def test_trace_lands_in_a_sibling_table_stamped_with_run_id(tmp_path):
    store = Store(tmp_path)
    strategy = AccumulateByRun("run-1", "2026-05-29")
    (
        Pipeline("selection", DatasetReader(_available()))
        .with_processor(Filter(lambda r: r["amount"] >= 100, name="high-value"))
        .explain(
            store.writer("gold", "selection_trace", strategy),
            id_column="case_ref",
        )
        .write_to(store.writer("gold", "selection_pool", strategy))
        .run()
    )

    # The trace is its own table, a sibling of the SelectionPool, not mixed in.
    pool_refs = set(
        store.reader("gold", "selection_pool").read().to_pandas()["case_ref"]
    )
    trace_frame = store.reader("gold", "selection_trace").read().to_pandas()
    assert pool_refs == {"c1", "c2"}  # only survivors in the pool
    # Every considered Case is in the trace (selected + excluded), each stamped
    # with the run that produced it (AC3 — per Case Type / run).
    assert set(trace_frame["case_ref"]) == {"c1", "c2", "c3"}
    assert set(trace_frame["run_id"]) == {"run-1"}
    assert set(trace_frame["load_date"]) == {"2026-05-29"}


class _StaticFeed:
    """A minimal ``Runnable`` returning a fixed Dataset — a stand-in reference feed."""

    def __init__(self, dataset: Dataset) -> None:
        self._dataset = dataset

    def run(self) -> Dataset:
        return self._dataset


def test_case_dropped_by_an_inner_join_is_explained_not_silently_absent(tmp_path):
    store = Store(tmp_path)
    strategy = AccumulateByRun("run-1", "2026-05-29")
    # The adviser hierarchy reference covers only c1 and c2 — an inner join drops
    # c3, which AC5 says must be *explained*, not silently absent.
    advisers = _StaticFeed(
        Dataset.from_pandas(
            pd.DataFrame({"case_ref": ["c1", "c2"], "adviser": ["a1", "a2"]})
        )
    )
    (
        Pipeline("selection", DatasetReader(_available()))
        .with_processor(JoinWith(advisers, on="case_ref", how="inner", name="adviser-hierarchy"))
        .explain(
            store.writer("gold", "selection_trace", strategy),
            id_column="case_ref",
        )
        .write_to(store.writer("gold", "selection_pool", strategy))
        .run()
    )

    trace = _trace(store)
    assert trace.loc["c3", "verdict"] == "excluded"
    assert "adviser-hierarchy" in trace.loc["c3", "reason"]
    assert "join" in trace.loc["c3", "reason"]


def test_run_log_records_an_explain_step_with_governance_counts(tmp_path):
    store = Store(tmp_path)
    strategy = AccumulateByRun("run-1", "2026-05-29")
    log_path = tmp_path / "run.log"
    (
        Pipeline("selection", DatasetReader(_available()), run_log=RunLog(log_path))
        .with_processor(Filter(lambda r: r["amount"] >= 100, name="high-value"))
        .explain(
            store.writer("gold", "selection_trace", strategy),
            id_column="case_ref",
        )
        .write_to(store.writer("gold", "selection_pool", strategy))
        .run()
    )

    records = [json.loads(line) for line in log_path.read_text().splitlines()]
    explain = next(r for r in records if r["step"] == "explain")
    # Considered 3, selected 2, excluded 1 — the governance summary (AC6).
    assert explain["rows_in"] == 3
    assert explain["rows_out"] == 2
    assert explain["rows_excluded"] == 1
