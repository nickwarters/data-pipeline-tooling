from pathlib import Path

from framework.store import Store
from pipelines.demo_source_to_selection import main


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

    # The SelectionPool holds only the available, high-value cases, ranked
    # highest-amount first, each stamped with the chosen Variation's bank.
    selection_pool = Store(cases_dir).reader("gold", "selection_pool").read().to_pandas()
    assert list(selection_pool["case_ref"]) == ["c1", "c2"]
    assert set(selection_pool["question_bank_id"]) == {"qb-100"}
    assert set(selection_pool["run_id"]) == {"2026-05-29"}

    captured = capsys.readouterr()
    assert "SelectionPool" in captured.out


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
