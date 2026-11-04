```python
from pathlib import Path

import pytest

from case_review.variation import variation_by_id
from cli import operator
from pipelines.ingest.schema import VARIATIONS
from pipelines.selection.pipeline import high_value_case, priority_score
from tests.framework_testing import read_rows
from tools.medallion import medallion
from tools.store import StoreRegistry

ROOT = Path(__file__).resolve().parents[2]


def _run(pipeline: str, base_dir: Path, *params: str) -> int:
    args = ["run", pipeline, "--base-dir", str(base_dir), "--run-date", "2026-05-29"]
    for param in params:
        args += ["--param", param]
    return operator.main(args)


def test_demo_selection_rules_are_independently_testable():
    # Rule authors should be able to test predicates and scorers without running
    # a full Pipeline; the demo keeps them as named pure functions rather than
    # burying business logic in inline lambdas.
    assert high_value_case({"amount": 100})
    assert not high_value_case({"amount": 99})
    assert priority_score({"amount": 100}) == 200


def test_demo_variation_lookup_reports_an_unknown_id():
    with pytest.raises(KeyError, match="No Variation with id 'missing'"):
        variation_by_id(VARIATIONS, "missing")


def test_demo_runs_the_full_source_to_selection_path(tmp_path, capsys):
    # The capstone demo comprises two path-addressed pipelines: ingest (CSV -> raw
    # -> silver -> the gold CasePool) then selection (the available cases ->
    # the gold SelectionPool). Running them in order through the framework's
    # `run` exercises the whole flow, freshness gate included.
    assert _run("pipelines/ingest", tmp_path) == 0

    # Ingest landed the medallion's raw, silver, and identity-stable gold.
    cases_dir = tmp_path / "cases"
    assert (cases_dir / "raw.db").exists()
    assert (cases_dir / "silver.db").exists()
    assert (cases_dir / "gold.db").exists()
    gold = medallion(StoreRegistry(tmp_path), "cases").gold
    cases = read_rows(gold, "cases")
    assert {row["case_ref"]: row["case_id"] for row in cases} == {
        "c1": "8dc403aa2bd789514e4fd7f99d5a580c8136512daecbdb22f8baf57aeefb9713",
        "c2": "e35cf73c7cb458109de1ba78352fb1a7c2918471d9673d2637818f7bbbd3a30f",
        "c3": "be545771d08a85cfaca0b47f1eb342ffd5cb942c80ab5ddca9e0cbd13c716e5a",
        "c4": "342deebb46899c2d5fac7bc934f4c1346667f7a8c2cdc3fa2fe7e5e233395b8b",
        "c5": "571a7c2d87025959d8f5b8d25461b02bd21867b7b1619fba2fe951b68275e7f6",
    }

    assert _run("pipelines/selection", tmp_path) == 0

    # The SelectionPool holds only the available, high-value cases, ranked by a
    # named priority score, each stamped with the chosen Variation's bank.
    selection_pool = read_rows(gold, "selection_pool")
    assert [r["case_ref"] for r in selection_pool] == ["c1", "c2"]
    assert {r["case_ref"]: r["case_id"] for r in selection_pool} == {
        "c1": "8dc403aa2bd789514e4fd7f99d5a580c8136512daecbdb22f8baf57aeefb9713",
        "c2": "e35cf73c7cb458109de1ba78352fb1a7c2918471d9673d2637818f7bbbd3a30f",
    }
    assert [r["priority_score"] for r in selection_pool] == [1000, 240]
    assert {r["question_bank_id"] for r in selection_pool} == {"qb-100"}
    # Stamped with the pipeline-name logical run id derived from the RunContext,
    # and a per-execution pipeline_run_id for traceability.
    assert {r["logical_run_id"] for r in selection_pool} == {"selection:2026-05-29"}
    assert all(r["pipeline_run_id"] for r in selection_pool)

    # Selection explainability: a sibling trace landed alongside the pool,
    # stamped by the same run, with a per-Case verdict for every available Case.
    trace = read_rows(gold, "selection_trace")
    by_ref = {r["case_ref"]: r for r in trace}
    assert set(by_ref) == {"c1", "c2", "c3"}  # all considered, not just survivors
    assert {r["logical_run_id"] for r in trace} == {"selection:2026-05-29"}
    assert by_ref["c1"]["verdict"] == "selected"
    assert by_ref["c1"]["score"] == 1000
    assert by_ref["c3"]["verdict"] == "excluded"  # below the high-value gate
    assert by_ref["c3"]["score"] == 160
    assert "high-value" in by_ref["c3"]["reason"]

    captured = capsys.readouterr()
    assert "SelectionPool" in captured.out
    assert "trace" in captured.out


def test_a_seeded_calendar_widens_the_availability_window(tmp_path):
    # The window is five *working* days back from 2026-05-29, so it normally
    # reaches 05-25 and considers c1/c2/c3. Seeding 05-22 through 05-28 as
    # holidays pushes it back to 05-18, which brings c4 into scope and drops
    # c2/c3 out — the same calendar file `orchestrate --calendar` reads.
    calendar = tmp_path / "calendar.yml"
    calendar.write_text(
        "holidays: [2026-05-22, 2026-05-25, 2026-05-26, 2026-05-27, 2026-05-28]\n",
        encoding="utf-8",
    )
    assert _run("pipelines/ingest", tmp_path) == 0
    assert _run("pipelines/selection", tmp_path, f"calendar={calendar}") == 0

    gold = medallion(StoreRegistry(tmp_path), "cases").gold
    assert [r["case_ref"] for r in read_rows(gold, "selection_pool")] == ["c1", "c4"]
    assert {r["case_ref"] for r in read_rows(gold, "selection_trace")} == {"c1", "c4"}


def test_an_unreadable_calendar_param_fails_without_a_traceback(tmp_path, capsys):
    assert _run("pipelines/ingest", tmp_path) == 0
    assert _run("pipelines/selection", tmp_path, "calendar=nope.yml") == 1
    assert "no calendar file at" in capsys.readouterr().err


def test_demo_pipelines_are_runnable_as_modules(tmp_path):
    # Belt-and-braces: each pipeline runs via the documented `python -m`
    # invocation from the repo root, proving the import-only framework package
    # and the cross-pipeline import (selection -> ingest) resolve on sys.path.
    import subprocess
    import sys

    for module in ("pipelines.ingest.pipeline", "pipelines.selection.pipeline"):
        result = subprocess.run(
            [sys.executable, "-m", module, "--base-dir", str(tmp_path)],
            capture_output=True,
            text=True,
            cwd=ROOT,
        )
        assert result.returncode == 0, result.stderr

```
