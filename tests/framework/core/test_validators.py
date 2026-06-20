import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.core.validators import (
    ColumnValidator,
    RowCountValidator,
    SchemaDriftValidator,
    UniqueValidator,
    ValidationError,
    VolumeAnomalyValidator,
)
from framework.io.strategy import Refresh


def _dataset(**columns) -> Dataset:
    return Dataset.from_pandas(pd.DataFrame(columns or {"id": [1, 2, 3]}))


def _rows(n: int) -> Dataset:
    """A dataset of exactly ``n`` rows (only the count matters here)."""
    return Dataset.from_pandas(pd.DataFrame({"id": list(range(n))}))


class _FakeHistory:
    """A stand-in baseline source returning fixed recent read volumes.

    Mirrors ``RunRegistry.recent_row_counts`` so the band logic can be exercised
    in isolation; an integration test drives the real registry seam end-to-end.
    """

    def __init__(self, counts: list[int]) -> None:
        self._counts = counts

    def recent_row_counts(self, pipeline, limit=10, step="read") -> list[int]:
        return self._counts[:limit]


def test_column_validator_raises_when_a_required_column_is_missing():
    # A required-columns check fails loudly with a located message naming the
    # missing column.
    dataset = _dataset(id=[1, 2], name=["a", "b"])

    with pytest.raises(ValidationError, match="case_ref"):
        ColumnValidator(["id", "case_ref"]).validate(dataset)


def test_column_validator_passes_when_all_required_columns_present():
    # Extra columns are fine; the check is presence of the required ones only.
    dataset = _dataset(id=[1], case_ref=["c1"], extra=["x"])

    ColumnValidator(["id", "case_ref"]).validate(dataset)  # does not raise


def test_row_count_validator_raises_below_minimum():
    # A minimum guards against a truncated / empty feed landing silently.
    with pytest.raises(ValidationError, match="below minimum"):
        RowCountValidator(minimum=5).validate(_dataset(id=[1, 2, 3]))


def test_row_count_validator_raises_above_maximum():
    # A maximum catches a feed that exploded in size relative to expectations.
    with pytest.raises(ValidationError, match="above maximum"):
        RowCountValidator(maximum=2).validate(_dataset(id=[1, 2, 3]))


def test_row_count_validator_passes_within_inclusive_bounds():
    # Bounds are inclusive; a count at the edge passes, and an open side
    # (None) imposes no constraint.
    RowCountValidator(minimum=3, maximum=3).validate(_dataset(id=[1, 2, 3]))
    RowCountValidator(minimum=1).validate(_dataset(id=[1, 2, 3]))


def test_unique_validator_raises_naming_duplicate_key_on_single_column_breach():
    # The gold grain requires one row per case_id; a duplicate
    # must abort the run with a message that identifies the offending key.
    dataset = _dataset(case_id=["A", "B", "A"], value=[1, 2, 3])

    with pytest.raises(ValidationError, match="A"):
        UniqueValidator("case_id").validate(dataset)


def test_unique_validator_passes_silently_when_key_is_unique():
    # A dataset with no duplicate values in the key column must not raise.
    dataset = _dataset(case_id=["A", "B", "C"], value=[1, 2, 3])

    UniqueValidator("case_id").validate(dataset)  # does not raise


def test_unique_validator_raises_on_multi_column_key_breach():
    # A composite key (feed_id, case_id) that is duplicated as a pair must
    # raise and name the duplicated combination.
    dataset = _dataset(
        feed_id=["X", "X", "Y"],
        case_id=["1", "1", "1"],
        value=[10, 20, 30],
    )

    with pytest.raises(ValidationError, match="X"):
        UniqueValidator(["feed_id", "case_id"]).validate(dataset)


def test_unique_validator_passes_when_multi_column_key_is_unique():
    # Each column alone has repeated values, but the pair is unique — must
    # not raise (the check is on the composite, not on individual columns).
    dataset = _dataset(
        feed_id=["X", "X", "Y"],
        case_id=["1", "2", "1"],
        value=[10, 20, 30],
    )

    UniqueValidator(["feed_id", "case_id"]).validate(dataset)  # does not raise


def test_volume_anomaly_validator_trips_on_a_far_shortfall():
    # The motivating case: recent nights read ~10k rows, tonight's source
    # export is truncated to 200. Every row may be individually valid, yet the
    # run is catastrophically incomplete — the guardrail must trip, naming the
    # count and the baseline it deviated from.
    history = _FakeHistory([10_000, 9_800, 10_200, 9_900])
    validator = VolumeAnomalyValidator(history, pipeline="cases", tolerance=0.5)

    with pytest.raises(ValidationError, match="200"):
        validator.validate(_rows(200))


def test_volume_anomaly_validator_passes_within_the_band():
    # A normal night within median × (1 ± tolerance) must not trip. Median of
    # [100, 110, 90, 105] is 102.5; tolerance 0.5 allows ~[51, 154]; 108 is fine.
    history = _FakeHistory([100, 110, 90, 105])
    validator = VolumeAnomalyValidator(history, pipeline="cases", tolerance=0.5)

    validator.validate(_rows(108))  # does not raise


def test_volume_anomaly_validator_trips_on_a_far_excess():
    # The guardrail is two-sided: a sudden explosion (e.g. a duplicated export)
    # is as suspicious as a collapse, and must trip too.
    history = _FakeHistory([100, 110, 90, 105])
    validator = VolumeAnomalyValidator(history, pipeline="cases", tolerance=0.5)

    with pytest.raises(ValidationError, match="deviates"):
        validator.validate(_rows(10_000))


def test_volume_anomaly_validator_degrades_gracefully_below_min_history():
    # A feed's first nights have too little history for a baseline; the band is
    # skipped rather than tripping spuriously. Two prior runs < the
    # default min_history of 3, so even a wildly different count passes.
    history = _FakeHistory([100, 110])
    validator = VolumeAnomalyValidator(history, pipeline="cases")

    validator.validate(_rows(1))  # does not raise — insufficient history


def test_volume_anomaly_floor_is_always_on_even_without_history():
    # The absolute floor is an independent guard that holds before any history
    # exists, so a first run below the floor still aborts.
    history = _FakeHistory([])
    validator = VolumeAnomalyValidator(history, pipeline="cases", floor=50)

    with pytest.raises(ValidationError, match="below floor"):
        validator.validate(_rows(10))


class _FakePrior:
    """A stand-in prior-columns source returning a fixed landed column set.

    Mirrors the ``PriorColumns`` seam (``Store.columns_of``) so the drift diff
    can be exercised in isolation; an integration test drives the real PRAGMA
    seam end-to-end.
    """

    def __init__(self, columns, label="raw.cases") -> None:
        self._columns = columns
        self.label = label

    def columns(self):
        return self._columns


def test_schema_drift_validator_warns_on_an_added_column():
    # An upstream source that grew a column drifts vs the prior landing; the
    # message names the added column and the table.
    prior = _FakePrior(("id", "name"))
    validator = SchemaDriftValidator(prior)

    with pytest.raises(
        ValidationError,
        match=r"added \[region\].*raw\.cases|raw\.cases.*added \[region\]",
    ):
        validator.validate(_dataset(id=[1], name=["a"], region=["x"]))


def test_schema_drift_validator_warns_on_a_dropped_column():
    # A source that lost a column drifts; the message names what is now missing.
    validator = SchemaDriftValidator(_FakePrior(("id", "name", "tier")))

    with pytest.raises(ValidationError, match=r"dropped \[tier\]"):
        validator.validate(_dataset(id=[1], name=["a"]))


def test_schema_drift_validator_names_both_added_and_dropped():
    # Both sides are reported; an upstream rename surfaces honestly as a
    # drop + an add (names-only — we cannot know it was a rename).
    validator = SchemaDriftValidator(_FakePrior(("id", "client_id")))

    with pytest.raises(ValidationError) as exc:
        validator.validate(_dataset(id=[1], customer_id=["a"]))
    assert "added [customer_id]" in str(exc.value)
    assert "dropped [client_id]" in str(exc.value)


def test_schema_drift_validator_passes_on_identical_columns():
    # Same column set, no drift — the common case must stay silent.
    validator = SchemaDriftValidator(_FakePrior(("id", "name")))

    validator.validate(_dataset(id=[1], name=["a"]))  # does not raise


def test_schema_drift_validator_ignores_column_reordering():
    # A set difference, not a sequence one: source tools reorder columns freely
    # and that is not drift.
    validator = SchemaDriftValidator(_FakePrior(("id", "name")))

    validator.validate(_dataset(name=["a"], id=[1]))  # does not raise


def test_schema_drift_validator_is_case_sensitive():
    # Column identifiers are case-sensitive (like every other column check);
    # `Status` vs `status` reads as a drop + an add, not a match.
    validator = SchemaDriftValidator(_FakePrior(("id", "Status")))

    with pytest.raises(ValidationError) as exc:
        validator.validate(_dataset(id=[1], status=["open"]))
    assert "added [status]" in str(exc.value)
    assert "dropped [Status]" in str(exc.value)


def test_schema_drift_validator_no_op_on_first_ever_run():
    # No prior landing (the table did not exist) → None → a clean no-op, not a
    # spurious warning.
    validator = SchemaDriftValidator(_FakePrior(None))

    validator.validate(_dataset(id=[1], anything=["x"]))  # does not raise


def test_schema_drift_validator_drives_the_real_store_prior_columns_seam(tmp_path):
    # End-to-end over the production PriorColumns seam (Store.columns_of's PRAGMA
    # read of the live raw table): land one shape, then a drifted snapshot warns
    # vs the prior landing — the next run reads the door, one layer before silver.
    from framework.core import RAW
    from framework.io.store import Store

    store = Store(tmp_path)
    store.writer(RAW, "cases", Refresh()).write(_dataset(id=[1], name=["a"]))

    validator = SchemaDriftValidator(store.columns_of(RAW, "cases"))

    with pytest.raises(ValidationError, match=r"raw\.cases.*dropped \[name\]"):
        validator.validate(_dataset(id=[2], region=["x"]))
