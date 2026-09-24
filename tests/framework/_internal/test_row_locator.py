"""Naming the rows behind a breach: by key when there is one, else by position."""

import pandas as pd

from framework._internal.row_locator import (
    MAX_ROWS_NAMED,
    locate_mask,
    locate_rows,
    normalise_key,
)


def _frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "case_type": ["claims", "claims", "appeals"],
            "item_id": [7.0, None, 9.0],
            "case_ref": ["C-1", "C-2", "C-3"],
        }
    )


def test_without_a_key_rows_are_named_by_zero_based_position():
    assert locate_rows(_frame(), [0, 2]) == "2 rows: positions 0, 2"
    assert locate_rows(_frame(), [1]) == "1 row: position 1"


def test_a_single_key_names_rows_by_their_key_value():
    assert (
        locate_rows(_frame(), [0, 2], ("case_ref",))
        == "2 rows: case_ref='C-1', case_ref='C-3'"
    )


def test_a_composite_key_names_every_part_and_renders_whole_floats_as_integers():
    # A key column that gained a null is float64; 7.0 must still read as 7.
    assert (
        locate_rows(_frame(), [0], ("case_type", "item_id"))
        == "1 row: (case_type='claims', item_id='7')"
    )


def test_a_row_missing_its_own_key_falls_back_to_its_position():
    assert (
        locate_rows(_frame(), [0, 1], ("case_type", "item_id"))
        == "2 rows: (case_type='claims', item_id='7'), position 1"
    )


def test_a_key_column_the_frame_lacks_falls_back_to_positions_rather_than_failing():
    assert locate_rows(_frame(), [2], ("no_such_column",)) == "1 row: position 2"


def test_only_the_first_few_rows_are_named_then_a_count_of_the_rest():
    frame = pd.DataFrame({"id": range(MAX_ROWS_NAMED + 3)})
    located = locate_rows(frame, range(len(frame)))
    assert located == f"{len(frame)} rows: positions 0, 1, 2, 3, 4 and 3 more"


def test_a_mask_selects_rows_by_position_even_when_index_labels_repeat():
    frame = pd.concat([_frame(), _frame()])  # labels 0,1,2,0,1,2
    assert locate_mask(frame, [False, False, False, True, False, False]) == (
        "1 row: position 3"
    )


def test_a_key_may_be_given_as_one_name_or_several():
    assert normalise_key(None) == ()
    assert normalise_key("case_ref") == ("case_ref",)
    assert normalise_key(["case_type", "item_id"]) == ("case_type", "item_id")
