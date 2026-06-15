from pathlib import Path

from framework.core import GOLD
from framework.io import Store
from framework.testing import read_rows
from pipelines.demo_source_to_selection import high_value_case, main, priority_score


def test_demo_selection_rules_are_independently_testable():
    # Rule authors should be able to test predicates and scorers without running
    # a full Pipeline; the demo keeps them as named pure functions rather than
    # burying business logic in inline lambdas.
    assert high_value_case({"amount": 100})
    assert not high_value_case({"amount": 99})
    assert priority_score({"amount": 100}) == 200


def test_demo_runs_the_full_source_to_selection_path(tmp_path, capsys):
    # The capstone demo runs one Case Type end to end — CSV feed -> raw ->
    # silver (the CasePool), then Selection narrows the available cases into the
    # gold SelectionPool — so a reader sees the whole  flow without wiring it.
    main(str(tmp_path))

    # Ingest landed the medallion's raw + silver, and Selection wrote gold.
    cases_dir = tmp_path / "cases"
    assert (cases_dir / "raw.db").exists()
    assert (cases_dir / "silver.db").exists()
    assert (cases_dir / "gold.db").exists()

    # The SelectionPool holds only the available, high-value cases, ranked by a
    # named priority score, each stamped with the chosen Variation's bank.
    store = Store(cases_dir)
    selection_pool = read_rows(store, GOLD, "selection_pool")
    assert [r["case_ref"] for r in selection_pool] == ["c1", "c2"]
    assert [r["priority_score"] for r in selection_pool] == [1000, 240]
    assert {r["question_bank_id"] for r in selection_pool} == {"qb-100"}
    # Stamped with the namespaced logical run id derived from the RunContext, and
    # a per-execution execution_id for traceability.
    assert {r["run_id"] for r in selection_pool} == {"cases/selection:2026-05-29"}
    assert {r["logical_run_id"] for r in selection_pool} == {
        "cases/selection:2026-05-29"
    }
    assert all(r["execution_id"] for r in selection_pool)

    # Selection explainability: a sibling trace landed alongside the pool,
    # stamped by the same run, with a per-Case verdict for every available Case.
    trace = read_rows(store, GOLD, "selection_trace")
    by_ref = {r["case_ref"]: r for r in trace}
    assert set(by_ref) == {"c1", "c2", "c3"}  # all considered, not just survivors
    assert {r["run_id"] for r in trace} == {"cases/selection:2026-05-29"}
    assert by_ref["c1"]["verdict"] == "selected"
    assert by_ref["c1"]["score"] == 1000
    assert by_ref["c3"]["verdict"] == "excluded"  # below the high-value gate
    assert by_ref["c3"]["score"] == 160
    assert "high-value" in by_ref["c3"]["reason"]

    captured = capsys.readouterr()
    assert "SelectionPool" in captured.out
    assert "trace" in captured.out


def test_demo_is_runnable_as_a_module(tmp_path):
    # Belt-and-braces: the documented `python -m` invocation runs from the repo
    # root, proving the import-only framework package resolves on sys.path.
    import subprocess
    import sys

    result = subprocess.run(
        [sys.executable, "-m", "pipelines.demo_source_to_selection", str(tmp_path)],
        capture_output=True,
        text=True,
        cwd=Path(__file__).resolve().parent.parent.parent,
    )
    assert result.returncode == 0
    assert "SelectionPool" in result.stdout
