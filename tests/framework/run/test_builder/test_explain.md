```python
"""Selection explainability: the per-Case trace of why a Case was/wasn't selected.

Selection's ``Filter``/``Score``/``JoinWith`` processors silently drop Cases
plain-Python callables, leaving no trace of *why* an adviser's Case was or
wasn't picked up, a governance gap management raised as a requirement.
``.explain(writer, id_column=...)`` is the quarantine-style terminus that
routes a per-Case verdict to a sibling trace table: who was considered, what
each scored, which gate excluded the rest, and how the survivors ranked.
"""

from __future__ import annotations

import json

import pandas as pd

from framework.core.dataset import Dataset
from framework.io.readers import DatasetReader
from framework.io.store import Store
from framework.io.strategy import AccumulateByRun
from framework.run.builder import Pipeline
from tools.observability.run_log import RunLog
from framework.transform.processors import AntiJoinWith, Filter, JoinWith, Score, Sort


def _available() -> Dataset:
    """Three available Cases entering Selection, one below the value gate."""
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
        store.reader("gold", "selection_trace").read().to_pandas().set_index("case_ref")
    )


def test_case_dropped_by_filter_is_excluded_with_a_located_reason(tmp_path):
    store = Store(tmp_path)
    strategy = AccumulateByRun("run-1", "2026-05-29")
    p = Pipeline("selection")
    r = p.read(DatasetReader(_available()), name="read")
    f = p.transform(Filter(lambda r: r["amount"] >= 100, name="high-value"), r, name="high-value")
    e = p.explain(store.writer("gold", "selection_trace", strategy), f, id_column="case_ref", name="explain")
    w = p.write(store.writer("gold", "selection_pool", strategy), f, name="write")
    p.run()

    trace = _trace(store)
    # c3 (amount 40) fell below the value gate: excluded, reason names the gate.
    assert trace.loc["c3", "verdict"] == "excluded"
    assert "high-value" in trace.loc["c3", "reason"]
    assert "filter" in trace.loc["c3", "reason"]


def test_retained_case_is_selected_with_gates_passed_and_rank(tmp_path):
    store = Store(tmp_path)
    strategy = AccumulateByRun("run-1", "2026-05-29")
    p = Pipeline("selection")
    r = p.read(DatasetReader(_available()), name="read")
    f1 = p.transform(Filter(lambda r: r["amount"] >= 100, name="high-value"), r, name="high-value")
    f2 = p.transform(Filter(lambda r: r["case_ref"] != "x", name="not-x"), f1, name="not-x")
    s = p.transform(Sort("amount", ascending=False), f2, name="sort")
    e = p.explain(store.writer("gold", "selection_trace", strategy), s, id_column="case_ref", name="explain")
    w = p.write(store.writer("gold", "selection_pool", strategy), s, name="write")
    p.run()

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
    p = Pipeline("selection")
    r = p.read(DatasetReader(_available()), name="read")
    s = p.transform(Score("priority", lambda r: r["amount"] * 2), r, name="priority")
    f = p.transform(Filter(lambda r: r["amount"] >= 100, name="high-value"), s, name="high-value")
    e = p.explain(store.writer("gold", "selection_trace", strategy), f, id_column="case_ref", score_column="priority", name="explain")
    w = p.write(store.writer("gold", "selection_pool", strategy), f, name="write")
    p.run()

    trace = _trace(store)
    assert trace.loc["c1", "score"] == 1800  # selected, scored
    assert trace.loc["c3", "verdict"] == "excluded"
    assert trace.loc["c3", "score"] == 80  # excluded, yet its score is retained


def test_trace_lands_in_a_sibling_table_stamped_with_run_id(tmp_path):
    store = Store(tmp_path)
    strategy = AccumulateByRun("run-1", "2026-05-29")
    p = Pipeline("selection")
    r = p.read(DatasetReader(_available()), name="read")
    f = p.transform(Filter(lambda r: r["amount"] >= 100, name="high-value"), r, name="high-value")
    e = p.explain(store.writer("gold", "selection_trace", strategy), f, id_column="case_ref", name="explain")
    w = p.write(store.writer("gold", "selection_pool", strategy), f, name="write")
    p.run()

    # The trace is its own table, a sibling of the SelectionPool, not mixed in.
    pool_refs = set(
        store.reader("gold", "selection_pool").read().to_pandas()["case_ref"]
    )
    trace_frame = store.reader("gold", "selection_trace").read().to_pandas()
    assert pool_refs == {"c1", "c2"}  # only survivors in the pool
    # Every considered Case is in the trace (selected + excluded), each stamped
    # with the run that produced it (— per Case Type / run).
    assert set(trace_frame["case_ref"]) == {"c1", "c2", "c3"}
    assert set(trace_frame["run_id"]) == {"run-1"}
    assert set(trace_frame["load_date"]) == {"2026-05-29"}


class _StaticFeed:
    """A minimal Reader returning a fixed Dataset stand-in reference feed."""

    def __init__(self, dataset: Dataset) -> None:
        self._dataset = dataset

    def read(self) -> Dataset:
        return self._dataset


def test_case_dropped_by_an_inner_join_is_explained_not_silently_absent(tmp_path):
    store = Store(tmp_path)
    strategy = AccumulateByRun("run-1", "2026-05-29")
    # The adviser hierarchy reference covers only c1 and c2 — an inner join drops
    # c3, which says must be *explained*, not silently absent.
    advisers = _StaticFeed(
        Dataset.from_pandas(
            pd.DataFrame({"case_ref": ["c1", "c2"], "adviser": ["a1", "a2"]})
        )
    )
    p = Pipeline("selection")
    r = p.read(DatasetReader(_available()), name="read")
    j = p.transform(JoinWith(advisers, on="case_ref", how="inner", name="adviser-hierarchy"), r, name="adviser-hierarchy")
    e = p.explain(store.writer("gold", "selection_trace", strategy), j, id_column="case_ref", name="explain")
    w = p.write(store.writer("gold", "selection_pool", strategy), j, name="write")
    p.run()

    trace = _trace(store)
    assert trace.loc["c3", "verdict"] == "excluded"
    assert "adviser-hierarchy" in trace.loc["c3", "reason"]
    assert "join" in trace.loc["c3", "reason"]


def test_case_dropped_by_an_anti_join_is_explained_not_silently_absent(tmp_path):
    store = Store(tmp_path)
    strategy = AccumulateByRun("run-1", "2026-05-29")
    already_reviewed = Dataset.from_pandas(pd.DataFrame({"case_ref": ["c2"]}))
    p = Pipeline("selection")
    r = p.read(DatasetReader(_available()), name="read")
    aj = p.transform(AntiJoinWith(already_reviewed, on="case_ref", name="already-reviewed"), r, name="already-reviewed")
    e = p.explain(store.writer("gold", "selection_trace", strategy), aj, id_column="case_ref", name="explain")
    w = p.write(store.writer("gold", "selection_pool", strategy), aj, name="write")
    p.run()

    trace = _trace(store)
    assert trace.loc["c2", "verdict"] == "excluded"
    assert "already-reviewed" in trace.loc["c2", "reason"]
    assert "join" in trace.loc["c2", "reason"]


def test_run_log_records_an_explain_step_with_governance_counts(tmp_path):
    store = Store(tmp_path)
    strategy = AccumulateByRun("run-1", "2026-05-29")
    log_path = tmp_path / "run.log"
    p = Pipeline("selection", run_log=RunLog(log_path))
    r = p.read(DatasetReader(_available()), name="read")
    f = p.transform(Filter(lambda r: r["amount"] >= 100, name="high-value"), r, name="high-value")
    e = p.explain(store.writer("gold", "selection_trace", strategy), f, id_column="case_ref", name="explain")
    w = p.write(store.writer("gold", "selection_pool", strategy), f, name="write")
    p.run()

    records = [json.loads(line) for line in log_path.read_text().splitlines()]
    explain = next(r for r in records if r["step"] == "explain")
    # Considered 3, selected 2, excluded 1 — the governance summary.
    assert explain["rows_in"] == 3
    assert explain["rows_out"] == 2
    assert explain["rows_excluded"] == 1

```
