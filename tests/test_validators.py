import pandas as pd
import pytest

from framework.dataset import Dataset
from framework.validators import (
    ColumnValidator,
    RowCountValidator,
    UniqueValidator,
    ValidationError,
)


def _dataset(**columns) -> Dataset:
    return Dataset.from_pandas(pd.DataFrame(columns or {"id": [1, 2, 3]}))


def test_column_validator_raises_when_a_required_column_is_missing():
    # A required-columns check fails loudly with a located message naming the
    # missing column (ADR-0008: failure at a predictable place, not mid-process).
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
    # The gold grain (ADR-0009) requires one row per case_id; a duplicate
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
