from pathlib import Path

from framework.store import Store
from pipelines.demo_source_to_selection import main, high_value_case, priority_score


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
    # gold SelectionPool — so a reader sees the whole #11 flow without wiring it.
    main(str(tmp_path))

    # Ingest landed the medallion's raw + silver, and Selection wrote gold.
    cases_dir = tmp_path / "cases"
    assert (cases_dir / "raw.db").exists()
    assert (cases_dir / "silver.db").exists()
    assert (cases_dir / "gold.db").exists()

    # The SelectionPool holds only the available, high-value cases, ranked by a
    # named priority score, each stamped with the chosen Variation's bank.
    selection_pool = Store(cases_dir).reader("gold", "selection_pool").read().to_pandas()
    assert list(selection_pool["case_ref"]) == ["c1", "c2"]
    assert list(selection_pool["priority_score"]) == [1000, 240]
    assert set(selection_pool["question_bank_id"]) == {"qb-100"}
    # Stamped with the namespaced logical run id derived from the RunContext, and
    # a per-execution execution_id for traceability (#77, ADR-0006).
    assert set(selection_pool["run_id"]) == {"cases/selection:2026-05-29"}
    assert set(selection_pool["logical_run_id"]) == {"cases/selection:2026-05-29"}
    assert selection_pool["execution_id"].notna().all()

    # Selection explainability (#53): a sibling trace landed alongside the pool,
    # stamped by the same run, with a per-Case verdict for every available Case.
    trace = Store(cases_dir).reader("gold", "selection_trace").read().to_pandas()
    by_ref = trace.set_index("case_ref")
    assert set(trace["case_ref"]) == {"c1", "c2", "c3"}  # all considered, not just survivors
    assert set(trace["run_id"]) == {"cases/selection:2026-05-29"}
    assert by_ref.loc["c1", "verdict"] == "selected"
    assert by_ref.loc["c1", "score"] == 1000
    assert by_ref.loc["c3", "verdict"] == "excluded"  # below the high-value gate
    assert by_ref.loc["c3", "score"] == 160
    assert "high-value" in by_ref.loc["c3", "reason"]

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
        cwd=Path(__file__).resolve().parent.parent,
    )
    assert result.returncode == 0
    assert "SelectionPool" in result.stdout
