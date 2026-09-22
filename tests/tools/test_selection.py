from itertools import combinations, permutations
from random import Random

import pandas as pd
import pytest

from framework.core import Dataset
from tools.selection import SelectionGroup, _balance, _Slot, select_cases


def dataset(rows):
    return Dataset.from_pandas(
        pd.DataFrame(rows, columns=["case_id", "A", "C", "D", "F"])
    )


def test_protects_exact_quotas_then_redistributes_and_preserves_input():
    source = dataset(
        [
            ("a", "one", "c1", "d1", True),
            ("b", "one", "c2", "d2", True),
            ("c", "one", "c2", "d2", False),
            ("d", "one", "c2", "d2", False),
            ("e", "one", "unlisted", "d3", False),
        ]
    )
    before = source.to_pandas()
    result = select_cases(
        source,
        groups=[
            SelectionGroup(
                {"A": "one"}, 4, ("C", "D"), [("c1", "d1", 2), ("c2", "d2", 2)]
            )
        ],
        balance_on="F",
    )
    assert result.selected.to_pandas().case_id.tolist() == ["a", "b", "c", "d"]
    assert result.quota_report[0].exact == 1
    assert result.quota_report[0].redistributed == 1
    assert result.quota_report[1].exact == 2
    assert result.group_report[0].selected_true == 2
    pd.testing.assert_frame_equal(source.to_pandas(), before)


def test_fallback_drops_rightmost_dimension_and_never_crosses_boundary():
    result = select_cases(
        dataset(
            [
                ("a", "one", "c1", "other", True),
                ("b", "one", "other", "other", False),
                ("c", "two", "c1", "d1", False),
            ]
        ),
        groups=[SelectionGroup({"A": "one"}, 3, ("C", "D"), [("c1", "d1", 3)])],
        balance_on="F",
    )
    assert result.trace.to_pandas().reason.tolist() == [
        "fallback:1",
        "fallback:0",
        "outside_groups",
    ]
    assert result.quota_report[0].fallback == 2
    assert result.quota_report[0].shortfall == 1
    assert result.group_report[0].shortfall == 1


def test_independent_absolute_targets_and_different_boundaries():
    result = select_cases(
        dataset(
            [
                ("a", "one", "c1", "d1", True),
                ("b", "one", "c1", "d1", False),
                ("c", "two", "c2", "d2", True),
                ("d", "two", "c2", "d2", False),
                ("e", "two", "c3", "d2", False),
            ]
        ),
        groups=[
            SelectionGroup({"A": "one"}, 3, ("C", "D"), [("c1", "d1", 3)]),
            SelectionGroup({"A": "two", "C": "c2"}, 1, ("D",), [("d2", 1)]),
        ],
        balance_on="F",
    )
    assert result.selected.to_pandas().case_id.tolist() == ["a", "b", "c"]
    assert [report.shortfall for report in result.group_report] == [1, 0]
    assert [report.selected_true for report in result.group_report] == [1, 1]


def test_balance_revises_earlier_choices_and_keeps_specificity():
    result = select_cases(
        dataset(
            [
                ("a", "one", "flexible", "d", True),
                ("b", "one", "flexible", "d", False),
                ("c", "one", "forced", "d", True),
                ("d", "one", "unlisted", "d", False),
            ]
        ),
        groups=[
            SelectionGroup({"A": "one"}, 2, ("C",), [("flexible", 1), ("forced", 1)])
        ],
        balance_on="F",
    )
    assert result.selected.to_pandas().case_id.tolist() == ["b", "c"]
    assert all(report.exact == 1 for report in result.quota_report)


def test_balancing_preserves_exact_and_redistributed_counts():
    result = select_cases(
        dataset(
            [
                ("a", "one", "c1", "d", True),
                ("b", "one", "c1", "d", True),
                ("c", "one", "c1", "d", False),
                ("d", "one", "c2", "d", True),
            ]
        ),
        groups=[SelectionGroup({"A": "one"}, 3, ("C",), [("c1", 1), ("c2", 2)])],
        balance_on="F",
    )
    report = result.group_report[0]
    assert (report.selected_true, report.selected_false) == (2, 1)
    assert result.quota_report[1].redistributed == 1
    assert result.selected.to_pandas().case_id.is_unique


def test_exchange_balancing_matches_exhaustive_small_assignment_oracle():
    random = Random(2026)
    for _ in range(60):
        rows = [{"F": random.choice([True, False])} for _ in range(6)]
        slots = [
            _Slot(
                i,
                i,
                "exact",
                tuple(j for j in range(6) if j == i or random.choice([True, False])),
            )
            for i in range(4)
        ]
        best = min(
            abs(sum(rows[row]["F"] for row in assignment) - 2)
            for assignment in permutations(range(6), 4)
            if all(row in slot.candidates for row, slot in zip(assignment, slots))
        )
        _balance(slots, rows, "F")
        assert len({slot.row for slot in slots}) == 4
        assert all(slot.row in slot.candidates for slot in slots)
        assert abs(sum(rows[slot.row]["F"] for slot in slots) - 2) == best


@pytest.mark.parametrize(
    "flags",
    [
        [True] * 5,
        [False] * 5,
        [True, True, False, False, False],
    ],
)
def test_balance_is_closest_feasible_and_odd_extra_is_true(flags):
    result = select_cases(
        dataset([(str(i), "one", "c", "d", flag) for i, flag in enumerate(flags)]),
        groups=[SelectionGroup({"A": "one"}, 3, (), [(3,)])],
        balance_on="F",
    )
    achieved = result.group_report[0].selected_true
    best = min(abs(sum(choice) - 2) for choice in combinations(flags, 3))
    assert abs(achieved - 2) == best


def test_empty_dataset_and_zero_target_preserve_columns():
    for source, groups in [
        (dataset([]), [SelectionGroup({"A": "one"}, 2, (), [(2,)])]),
        (
            dataset([("a", "one", "c", "d", True)]),
            [SelectionGroup({"A": "one"}, 0, (), [])],
        ),
    ]:
        result = select_cases(source, groups=groups, balance_on="F")
        assert len(result.selected) == 0
        assert result.selected.columns == source.columns
        assert len(result.trace) == len(source)


@pytest.mark.parametrize(
    "group, message",
    [
        (SelectionGroup({}, -1, (), []), "non-negative integer"),
        (SelectionGroup({}, True, (), [(True,)]), "non-negative integer"),
        (SelectionGroup({}, 2, (), [(1,)]), "sum"),
        (SelectionGroup({}, 1, ("C",), [(1,)]), "dimension values"),
        (SelectionGroup({}, 2, ("C",), [("c", 1), ("c", 1)]), "duplicate"),
        (SelectionGroup({"C": "c"}, 1, ("C",), [("c", 1)]), "distinct"),
        (SelectionGroup({}, 1, ("F",), [(True, 1)]), "distinct"),
        (SelectionGroup({}, 1, ("C",), [(None, 1)]), "non-null scalars"),
    ],
)
def test_invalid_configuration(group, message):
    with pytest.raises(ValueError, match=message):
        select_cases(dataset([]), groups=[group], balance_on="F")


def test_rejects_overlapping_boundaries_even_without_matching_data():
    with pytest.raises(ValueError, match="overlap"):
        select_cases(
            dataset([]),
            groups=[
                SelectionGroup({"A": "one"}, 0, (), []),
                SelectionGroup({"A": "one", "C": "c"}, 0, (), []),
            ],
            balance_on="F",
        )


@pytest.mark.parametrize(
    "rows, message",
    [
        ([("a", "one", "c", "d", "False")], "booleans"),
        ([("a", "one", "c", "d", 1)], "booleans"),
        ([("a", "one", "c", "d", None)], "booleans"),
        ([(None, "one", "c", "d", True)], "IDs"),
        ([("a", "one", "c", "d", True)] * 2, "IDs"),
    ],
)
def test_invalid_input(rows, message):
    with pytest.raises(ValueError, match=message):
        select_cases(dataset(rows), groups=[], balance_on="F")


def test_missing_columns_and_custom_id_and_non_default_index():
    frame = dataset([("a", "one", "c", "d", True)]).to_pandas()
    frame.index = [42]
    frame = frame.rename(columns={"case_id": "reference"})
    with pytest.raises(ValueError, match="missing columns"):
        select_cases(Dataset.from_pandas(frame), groups=[], balance_on="F")
    result = select_cases(
        Dataset.from_pandas(frame),
        groups=[SelectionGroup({}, 1, (), [(1,)])],
        balance_on="F",
        id_column="reference",
    )
    assert result.selected.to_pandas().index.tolist() == [42]
    assert result.trace.to_pandas().case_id.tolist() == ["a"]
