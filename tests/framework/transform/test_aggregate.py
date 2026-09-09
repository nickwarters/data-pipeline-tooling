"""The aggregate helpers: the plumbing a gold reduction calls around its
group-by, exported through the ``framework.transform`` facade."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Annotated

import pandas as pd
import pytest

from framework.core import NonNull, Range, SchemaValidator
from framework.transform import (
    count_by,
    fill_dimensions,
    ratio,
    ratios,
    shaped,
    statistic,
    summarise,
    total,
)


@dataclass
class Table:
    """A table as a reduction declares one: dimensions, a count, statistics."""

    brand: Annotated[str, NonNull()]
    case_type: Annotated[str, NonNull()]
    case_count: Annotated[int, NonNull(), Range(minimum=0)]
    days_mean: float
    days_p50: float
    days_p90: float
    days_max: float
    flagged: bool
    seen_on: date
    as_of_utc: Annotated[str, NonNull()]


# --- statistics -------------------------------------------------------------


def test_statistic_rounds_and_turns_the_nan_of_nothing_into_none():
    assert statistic(1.23456) == 1.235
    assert statistic(1.23456, places=1) == 1.2
    assert statistic(float("nan")) is None
    assert statistic(pd.Series([], dtype="float64").mean()) is None


def test_summarise_keys_mean_percentiles_and_max_on_the_prefix():
    values = pd.Series([1.0, 2.0, 3.0, 4.0, None])
    assert summarise(values, "days") == {
        "days_mean": 2.5,
        "days_p50": 2.5,
        "days_p90": 3.7,
        "days_max": 4.0,
    }


def test_summarise_takes_the_quantiles_and_places_it_is_asked_for():
    values = pd.Series([10.0, 20.0, 30.0])
    row = summarise(values, "duration", quantiles=(0.95,), places=6)
    assert row == {"duration_mean": 20.0, "duration_p95": 29.0, "duration_max": 30.0}
    assert summarise(values, "late", quantiles=()) == {
        "late_mean": 20.0,
        "late_max": 30.0,
    }


def test_summarise_of_nothing_is_none_everywhere_not_zero():
    assert summarise(pd.Series([None, None], dtype="float64"), "days") == {
        "days_mean": None,
        "days_p50": None,
        "days_p90": None,
        "days_max": None,
    }


def test_ratio_is_none_on_a_zero_or_missing_denominator():
    assert ratio(1, 4) == 0.25
    assert ratio(2, 3, places=2) == 0.67
    assert ratio(1, 0) is None
    assert ratio(1, None) is None
    assert ratio(None, 3) is None


def test_ratios_null_where_the_denominator_is_not_positive():
    numerator = pd.Series([1.0, 2.0, 3.0, 4.0])
    denominator = pd.Series([4.0, 0.0, None, -1.0])
    out = ratios(numerator, denominator)
    assert out.iloc[0] == 0.25
    assert out.iloc[1:].isna().all()


def test_total_stays_none_when_no_row_reported_a_value():
    assert total(pd.Series([None, None], dtype="float64")) is None
    assert total(pd.Series([1.0, None, 2.0])) == 3.0


# --- dimensions -------------------------------------------------------------


def test_fill_dimensions_fills_an_all_null_float_column_with_the_literal():
    frame = pd.DataFrame({"who": [None, None], "n": [1, 2]})
    assert frame["who"].dtype == "float64" or frame["who"].dtype == object
    filled = fill_dimensions(frame, {"who": "(unassigned)"})
    assert filled["who"].tolist() == ["(unassigned)", "(unassigned)"]
    assert frame["who"].isna().all()  # the input is left alone


def test_count_by_counts_each_combination_and_keeps_filled_rows_in_the_total():
    frame = pd.DataFrame(
        {
            "brand": ["b", "b", "b"],
            "who": ["ann", None, "ann"],
            "status": ["open", "open", "done"],
        }
    )
    counted = count_by(
        frame, ("brand", "who", "status"), measure="n", fills={"who": "(unassigned)"}
    )
    assert counted.to_dict("records") == [
        {"brand": "b", "who": "(unassigned)", "status": "open", "n": 1},
        {"brand": "b", "who": "ann", "status": "done", "n": 1},
        {"brand": "b", "who": "ann", "status": "open", "n": 1},
    ]
    assert counted["n"].sum() == len(frame)


def test_count_by_over_no_rows_keeps_every_column():
    frame = pd.DataFrame({"brand": pd.Series(dtype="object"), "status": []})
    counted = count_by(frame, ("brand", "status"), measure="n")
    assert list(counted.columns) == ["brand", "status", "n"]
    assert counted.empty


# --- landing ----------------------------------------------------------------


def test_shaped_lands_rows_in_the_declared_columns_order_and_types():
    rows = [
        {
            "case_type": "claims",
            "brand": "b",
            "case_count": 2,
            **summarise(pd.Series([1.0, 3.0]), "days"),
            "flagged": True,
            "seen_on": pd.Timestamp("2026-09-01"),
        }
    ]
    dataset = shaped(rows, Table, stamp={"as_of_utc": "2026-09-09T00:00:00+00:00"})
    frame = dataset.to_pandas()
    assert list(frame.columns) == [
        "brand",
        "case_type",
        "case_count",
        "days_mean",
        "days_p50",
        "days_p90",
        "days_max",
        "flagged",
        "seen_on",
        "as_of_utc",
    ]
    assert frame["case_count"].dtype == "int64"
    assert frame["days_p90"].dtype == "float64"
    assert frame["as_of_utc"].tolist() == ["2026-09-09T00:00:00+00:00"]
    SchemaValidator(Table).validate(dataset)


def test_shaped_of_nothing_still_carries_the_declared_shape_and_the_stamp():
    dataset = shaped([], Table, stamp={"as_of_utc": "now"})
    frame = dataset.to_pandas()
    assert len(frame) == 0
    assert list(frame.columns)[:3] == ["brand", "case_type", "case_count"]
    assert frame["case_count"].dtype == "int64"
    assert frame["days_mean"].dtype == "float64"
    assert str(frame["seen_on"].dtype) == "datetime64[ns]"
    SchemaValidator(Table).validate(dataset)


def test_shaped_sorts_stably_and_leaves_a_missing_statistic_null():
    rows = [
        {
            "brand": "b",
            "case_type": "z",
            "case_count": 1,
            "days_mean": None,
            "days_p50": None,
            "days_p90": None,
            "days_max": None,
            "flagged": None,
            "seen_on": None,
        },
        {
            "brand": "a",
            "case_type": "y",
            "case_count": 1,
            "days_mean": 1.0,
            "days_p50": 1.0,
            "days_p90": 1.0,
            "days_max": 1.0,
            "flagged": False,
            "seen_on": None,
        },
    ]
    frame = shaped(
        rows, Table, stamp={"as_of_utc": "now"}, sort_by=("brand", "case_type")
    ).to_pandas()
    assert frame["case_type"].tolist() == ["y", "z"]
    assert frame["days_mean"].isna().tolist() == [False, True]
    # A missing flag stays missing rather than becoming True.
    assert frame["flagged"].isna().tolist() == [False, True]


def test_shaped_accepts_a_frame_and_refuses_rows_lacking_a_declared_column():
    frame = pd.DataFrame({"brand": ["b"], "case_type": ["c"], "case_count": [1]})
    with pytest.raises(KeyError, match="days_mean"):
        shaped(frame, Table, stamp={"as_of_utc": "now"})
