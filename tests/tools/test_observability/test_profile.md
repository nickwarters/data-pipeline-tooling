```python
"""Per-column data profiling (#284).

Two layers, mirroring how the volume guardrail is tested: the pure profile
computation and the drift check are exercised in isolation against fixed inputs
(and a fake baseline), then an integration test drives a *real*
``Pipeline.profile`` + ``RunLog`` + ``RunRegistry`` so the
emitter → store → baseline seam is covered end to end, never a hand-faked record
shape.
"""

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.run.builder import Pipeline
from tools.observability.profile import (
    DataProfiler,
    DatasetProfile,
    ProfileDriftCheck,
    ProfileError,
    profile_dataset,
)
from tools.observability.run_log import RunLog
from tools.observability.run_registry import RunRegistry


class RecordingReader:
    """A Reader that returns a fixed dataset."""

    def __init__(self, dataset: Dataset) -> None:
        self._dataset = dataset

    def read(self) -> Dataset:
        return self._dataset


class _FakeBaseline:
    """A stand-in baseline returning fixed recent profile records, newest first.

    Mirrors ``RunRegistry.recent_profiles`` so the drift logic can be exercised in
    isolation; an integration test drives the real registry seam end-to-end.
    """

    def __init__(self, profiles: list[DatasetProfile]) -> None:
        self._records = [p.to_record() for p in profiles]

    def recent_profiles(self, address, limit=10) -> list[dict]:
        return self._records[:limit]


def _dataset(**columns) -> Dataset:
    return Dataset.from_pandas(pd.DataFrame(columns))


# --- profile_dataset: the computation -------------------------------------


def test_profile_captures_completeness_cardinality_and_range_per_column():
    # A numeric column reports its null rate, distinct count, and min/max range.
    profile = profile_dataset(_dataset(amount=[10.0, 20.0, 20.0, None]))

    [amount] = profile.columns
    assert profile.row_count == 4
    assert amount.null_count == 1
    assert amount.null_rate == 0.25
    assert amount.distinct_count == 2
    assert amount.minimum == 10.0
    assert amount.maximum == 20.0


def test_profile_of_a_categorical_column_bounds_the_value_distribution():
    # A categorical has no numeric range (min/max stay None) but a bounded top-N
    # distribution, most-frequent first — the signal for "gained a junk value".
    dataset = _dataset(status=["open", "open", "open", "closed", "stuck"])

    [status] = profile_dataset(dataset, top_n=2).columns

    assert status.minimum is None and status.maximum is None
    assert status.distinct_count == 3
    assert status.top_values == [["open", 3], ["closed", 1]]  # capped at top_n=2


def test_profile_flags_a_high_null_column():
    # The motivating regression: a column that is mostly null. The rate is what
    # the drift check trends, so it must be computed faithfully.
    [col] = profile_dataset(_dataset(maybe=[None, None, None, 1])).columns

    assert col.null_count == 3
    assert col.null_rate == 0.75


def test_profile_columns_allow_list_bounds_the_cost():
    # Profiling is opt-in and cost-bounded: an allow-list profiles only the named
    # columns (and silently skips an unknown name) so a wide feed stays cheap.
    dataset = _dataset(a=[1, 2], b=[3, 4], c=[5, 6])

    profile = profile_dataset(dataset, columns=["a", "c", "missing"])

    assert [c.name for c in profile.columns] == ["a", "c"]


def test_profile_record_round_trips_through_json_shape():
    # The run log stores to_record(); the registry reads it back via from_record.
    profile = profile_dataset(_dataset(amount=[1.0, 2.0, None], tag=["x", "x", "y"]))

    restored = DatasetProfile.from_record(profile.to_record())

    assert restored.to_record() == profile.to_record()
    assert restored.column("tag").top_values == [["x", 2], ["y", 1]]


def test_profile_of_an_empty_dataset_reports_zero_null_rate():
    # No rows means no division: the rate is a defined 0.0, not a NaN/ZeroDiv.
    [col] = profile_dataset(_dataset(amount=pd.Series([], dtype="float64"))).columns

    assert col.null_rate == 0.0
    assert col.null_count == 0


# --- ProfileDriftCheck: the run-over-run baseline -------------------------


def _baseline_with_null_rate(rate: float, runs: int = 4) -> _FakeBaseline:
    """A fake baseline whose ``amount`` column sits at a fixed null rate."""
    nulls = int(round(rate * 4))
    values = [None] * nulls + [1.0] * (4 - nulls)
    return _FakeBaseline(
        [profile_dataset(_dataset(amount=values)) for _ in range(runs)]
    )


def test_drift_check_reports_a_column_whose_null_rate_jumped():
    # The headline catch a row-count check misses: a column quietly sliding from
    # ~0% null to 75% null over its history. The drift check names it.
    baseline = _baseline_with_null_rate(0.0)
    check = ProfileDriftCheck(baseline, "cases.profile", null_rate_tolerance=0.2)

    today = profile_dataset(_dataset(amount=[None, None, None, 1.0]))
    messages = check.check(today)

    assert len(messages) == 1
    assert "amount" in messages[0] and "75" in messages[0]


def test_drift_check_is_silent_within_tolerance():
    # A null rate that wobbles within tolerance of the baseline is not drift.
    baseline = _baseline_with_null_rate(0.25)
    check = ProfileDriftCheck(baseline, "cases.profile", null_rate_tolerance=0.2)

    today = profile_dataset(_dataset(amount=[None, 1.0, 2.0, 3.0]))  # 25% null

    assert check.check(today) == []


def test_drift_check_degrades_gracefully_below_min_history():
    # A feed's first nights have too little history for a baseline; the band is
    # skipped rather than reporting spurious drift.
    baseline = _baseline_with_null_rate(0.0, runs=2)  # < default min_history of 3
    check = ProfileDriftCheck(baseline, "cases.profile")

    today = profile_dataset(_dataset(amount=[None, None, None, None]))

    assert check.check(today) == []


def test_drift_check_only_watches_named_columns_when_narrowed():
    # An explicit watch-list ignores drift in unlisted columns.
    baseline = _FakeBaseline(
        [profile_dataset(_dataset(amount=[1.0, 2, 3, 4], other=[1.0, 2, 3, 4]))] * 4
    )
    check = ProfileDriftCheck(
        baseline, "cases.profile", null_rate_tolerance=0.2, columns=["amount"]
    )

    today = profile_dataset(
        _dataset(amount=[1.0, 2, 3, 4], other=[None, None, None, None])
    )

    assert check.check(today) == []  # other drifted, but it is not watched


# --- DataProfiler: the injected port -------------------------------------


def test_data_profiler_returns_the_record_and_no_warnings_without_a_baseline():
    # The plain case: a profiler with no baseline returns the DatasetProfile
    # record to record and an empty warning list.
    profiler = DataProfiler(columns=["amount"], top_n=5)

    payload, warnings = profiler.profile(_dataset(amount=[1.0, None, 3.0]))

    assert warnings == []
    amount = DatasetProfile.from_record(payload).column("amount")
    assert amount.null_rate == pytest.approx(1 / 3)


def test_data_profiler_warns_on_drift_in_warn_severity():
    # warn severity returns drift messages (the node logs them) without raising.
    baseline = _baseline_with_null_rate(0.0)
    profiler = DataProfiler(
        baseline=baseline,
        address="cases.profile",
        null_rate_tolerance=0.2,
        severity="warn",
    )

    _, warnings = profiler.profile(_dataset(amount=[None, None, None, 1.0]))

    assert warnings and "amount" in warnings[0]


def test_data_profiler_raises_on_drift_in_fail_severity():
    # fail severity raises ProfileError so the run aborts.
    baseline = _baseline_with_null_rate(0.0)
    profiler = DataProfiler(
        baseline=baseline,
        address="cases.profile",
        null_rate_tolerance=0.2,
        severity="fail",
    )

    with pytest.raises(ProfileError, match="amount"):
        profiler.profile(_dataset(amount=[None, None, None, 1.0]))


def test_data_profiler_rejects_a_baseline_without_an_address():
    with pytest.raises(ValueError, match="address"):
        DataProfiler(baseline=_baseline_with_null_rate(0.0))


# --- end-to-end: Pipeline.profile -> RunLog -> RunRegistry ----------------


def _run_profiling_pipeline(log_path, dataset, *, name="cases", profiler=None):
    p = Pipeline(name, run_log=RunLog(log_path))
    r = p.read(RecordingReader(dataset), name="read")
    p.profile(profiler or DataProfiler(), r, name="profile")
    p.run()
    return p.run_id


def test_profile_task_records_a_queryable_profile_on_the_run_log(tmp_path):
    # A wired profile Task records its per-column profile to the run log; after
    # ingest the registry exposes it in a structured, queryable shape.
    log_path = tmp_path / "cases.log"
    dataset = _dataset(amount=[10.0, 20.0, None], tag=["a", "a", "b"])
    run_id = _run_profiling_pipeline(log_path, dataset)

    registry = RunRegistry(tmp_path / "registry.db")
    registry.ingest(log_path)

    [record] = registry.records_for_address("cases.profile")
    assert record["run_id"] == run_id
    profile = DatasetProfile.from_record(record["profile"])
    assert profile.row_count == 3
    assert profile.column("amount").null_rate == pytest.approx(1 / 3)


def test_recent_profiles_baseline_drives_drift_detection_end_to_end(tmp_path):
    # The full loop: several healthy runs build the baseline in the registry, then
    # a regressed run's profile, checked against recent_profiles, warns on drift.
    log_path = tmp_path / "cases.log"
    registry = RunRegistry(tmp_path / "registry.db")

    healthy = _dataset(amount=[1.0, 2.0, 3.0, 4.0])  # 0% null
    for _ in range(4):
        _run_profiling_pipeline(log_path, healthy)
        registry.ingest(log_path)

    # recent_profiles is the production baseline source.
    assert len(registry.recent_profiles("cases.profile")) == 4

    check = ProfileDriftCheck(registry, "cases.profile", null_rate_tolerance=0.2)
    regressed = profile_dataset(_dataset(amount=[None, None, None, 4.0]))  # 75% null
    assert check.check(regressed)  # drift detected from real run history


def test_profile_task_fails_the_run_on_drift_in_fail_severity(tmp_path):
    # In fail severity a baseline deviation raises ProfileError (a DATA abort),
    # so a regressed feed stops before it can land downstream.
    log_path = tmp_path / "cases.log"
    registry = RunRegistry(tmp_path / "registry.db")

    healthy = _dataset(amount=[1.0, 2.0, 3.0, 4.0])
    for _ in range(4):
        _run_profiling_pipeline(log_path, healthy)
        registry.ingest(log_path)

    profiler = DataProfiler(
        baseline=registry,
        address="cases.profile",
        null_rate_tolerance=0.2,
        severity="fail",
    )
    regressed = _dataset(amount=[None, None, None, 4.0])

    with pytest.raises(ProfileError, match="amount"):
        _run_profiling_pipeline(
            tmp_path / "regressed.log", regressed, profiler=profiler
        )

```
