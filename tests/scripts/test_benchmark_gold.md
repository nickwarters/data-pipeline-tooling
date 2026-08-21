```python
"""Tests for the gold publication benchmark.

The script exists to be run against a network share, where a wrong answer is
expensive to discover. Two things need guarding: the synthetic silver history
must be shaped like the real one, so what is measured is the real reduction
and not a simplified stand-in; and the run must not touch anything in the
directory an operator points it at.

The scenarios here are deliberately tiny -- this asserts the measurement is
sound, not what the numbers are.
"""

from pathlib import Path

import pytest

from pipelines.sharepoint_cases.schema import CaseVersion
from scripts import benchmark_gold

# The smallest scenario the CLI will accept, for the tests that are about the
# script's file handling rather than its measurements.
_TINY = ("--lists", "1", "--cases", "2", "--versions", "2")


def _measure(tmp_path: Path):
    return benchmark_gold.measure(tmp_path, lists=2, cases=4, versions=3)


def test_synthetic_silver_matches_the_declared_schema():
    """Every field the silver schema declares is generated, and nothing else."""
    frame = benchmark_gold.synthetic_silver(lists=2, cases=3, versions=2)

    assert set(frame.columns) == set(CaseVersion.__dataclass_fields__)
    assert len(frame) == 2 * 3 * 2


def test_synthetic_silver_keys_each_case_by_type_and_item():
    """Two lists reusing an item id are two Cases, as they are in the real feed."""
    frame = benchmark_gold.synthetic_silver(lists=2, cases=3, versions=2)

    assert frame["source_observation_id"].is_unique
    assert frame["case_type"].nunique() == 2
    # Item ids are reused across lists on purpose: the pair is what is unique.
    assert set(frame["source_item_id"]) == {"1", "2", "3"}
    assert len(frame.groupby(["case_type", "source_item_id"])) == 6


def test_measure_reduces_the_history_to_one_row_per_case(tmp_path):
    timing = _measure(tmp_path)

    assert timing.silver_rows == 2 * 4 * 3
    assert timing.cases == 2 * 4
    assert timing.total_seconds > 0


def test_measure_times_the_read_as_part_of_building_current(tmp_path):
    """``read`` is a component of ``case_current``, not additional to it."""
    timing = _measure(tmp_path)

    assert 0 < timing.read_seconds <= timing.current_seconds


def test_a_run_leaves_the_operators_directory_otherwise_untouched(tmp_path):
    """Only the subdirectory the script creates is written, and then removed."""
    (tmp_path / "payroll.xlsx").write_text("do not touch", encoding="utf-8")

    assert benchmark_gold.main(["prog", "--base-dir", str(tmp_path), *_TINY]) == 0

    assert (tmp_path / "payroll.xlsx").read_text(encoding="utf-8") == "do not touch"
    assert not (tmp_path / "benchmark_gold").exists()


def test_keep_leaves_the_databases_behind(tmp_path):
    argv = ["prog", "--base-dir", str(tmp_path), "--keep", *_TINY]

    assert benchmark_gold.main(argv) == 0

    assert (tmp_path / "benchmark_gold").is_dir()


def test_a_sweep_frees_each_scenario_before_running_the_next(tmp_path, monkeypatch):
    """Peak disk is one scenario, not the whole ladder -- shares are not roomy."""
    monkeypatch.setattr(benchmark_gold, "SWEEP", ((1, 2, 2), (1, 3, 2)))
    seen = []
    measure = benchmark_gold.measure

    def record_live_scenarios(scenario_dir, **kwargs):
        seen.append(sorted(p.name for p in scenario_dir.parent.iterdir()))
        return measure(scenario_dir, **kwargs)

    monkeypatch.setattr(benchmark_gold, "measure", record_live_scenarios)

    assert benchmark_gold.main(["prog", "--base-dir", str(tmp_path), "--sweep"]) == 0

    # Each scenario creates its own directory, so an empty parent at call time
    # means the previous scenario was freed. Without that, the second call would
    # see ["s1x2x2"] still sitting there.
    assert seen == [[], []]


def test_an_occupied_base_directory_is_refused_rather_than_written_into(tmp_path):
    """Refusing beats deleting a directory whose contents we did not create."""
    occupied = tmp_path / "benchmark_gold"
    occupied.mkdir()
    (occupied / "earlier-results.txt").write_text("keep me", encoding="utf-8")

    assert benchmark_gold.main(["prog", "--base-dir", str(tmp_path), *_TINY]) == 1

    assert (occupied / "earlier-results.txt").read_text(encoding="utf-8") == "keep me"


@pytest.mark.parametrize("flag", ["--lists", "--cases", "--versions"])
def test_the_scale_knobs_are_all_settable(tmp_path, flag):
    argv = ["prog", "--base-dir", str(tmp_path), *_TINY, flag, "2"]

    assert benchmark_gold.main(argv) == 0

```
