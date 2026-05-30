import pandas as pd
import pytest

from framework.dataset import Dataset
from framework.validators import (
    ColumnValidator,
    RowCountValidator,
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
