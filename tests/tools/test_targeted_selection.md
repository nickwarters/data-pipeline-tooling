```python
from collections import Counter

import pandas as pd
import pytest

from framework.core import Dataset
from framework.io import DatasetReader
from framework.run import read, transform
from tools.targeted_selection import TargetedSelection, TargetedSelectionConfig

_LEVELS = ("brand", "case_type", "product", "attribute")


def _pool(*groups: tuple[tuple[str, str, str, str], int, int]) -> Dataset:
    # Each group is (cell, how many flagged True, how many flagged False).
    rows = []
    for cell, true_count, false_count in groups:
        for flag in [True] * true_count + [False] * false_count:
            rows.append(
                dict(zip(_LEVELS, cell), vulnerable=flag, case_id=f"c{len(rows):04d}")
            )
    return Dataset.from_pandas(pd.DataFrame(rows))


def _config(targets, **overrides) -> TargetedSelectionConfig:
    settings = dict(
        levels=_LEVELS,
        targets=targets,
        total=sum(targets.values()),
        make_up_to=("brand", "case_type"),
    )
    settings.update(overrides)
    return TargetedSelectionConfig(**settings)


def _cells(dataset: Dataset) -> Counter:
    frame = dataset.to_pandas()
    return Counter(tuple(row) for row in frame[list(_LEVELS)].itertuples(index=False))


A1 = ("b1", "ct1", "p1", "a1")
A2 = ("b1", "ct1", "p1", "a2")
P2 = ("b1", "ct1", "p2", "a1")
OTHER_CASE_TYPE = ("b1", "ct2", "p1", "a1")


def test_each_cell_is_reduced_to_its_own_target():
    selected = TargetedSelection(_config({A1: 3, A2: 2}))(_pool((A1, 5, 5), (A2, 5, 5)))

    assert _cells(selected) == {A1: 3, A2: 2}


def test_the_total_caps_the_selection_across_cells():
    # Cells fill in declared order, so a total below the sum of the targets
    # leaves the last-declared cells short.
    config = _config({A1: 3, A2: 3}, total=4)

    selected = TargetedSelection(config)(_pool((A1, 5, 5), (A2, 5, 5)))

    assert _cells(selected) == {A1: 3, A2: 1}


def test_a_short_cell_is_made_up_from_the_next_level_up():
    # A1 has 2 of its 5; the other 3 come from its product (any attribute) —
    # the untargeted a2 Cases — before reaching the other product.
    config = _config({A1: 5})

    selected = TargetedSelection(config)(_pool((A1, 1, 1), (A2, 2, 1), (P2, 5, 5)))

    assert _cells(selected) == {A1: 2, A2: 3}


def test_make_up_climbs_until_the_make_up_group_and_no_further():
    # Its product is exhausted, so A1 climbs to brand/case type (P2), but never
    # to another case type, which is outside the make-up group.
    config = _config({A1: 10})

    selected = TargetedSelection(config)(
        _pool((A1, 1, 1), (A2, 1, 1), (P2, 1, 2), (OTHER_CASE_TYPE, 5, 5))
    )

    assert _cells(selected) == {A1: 2, A2: 2, P2: 3}


def test_make_up_to_the_full_levels_disables_make_up():
    config = _config({A1: 5}, make_up_to=_LEVELS)

    selected = TargetedSelection(config)(_pool((A1, 1, 1), (A2, 5, 5)))

    assert _cells(selected) == {A1: 2}


def test_every_cell_takes_its_own_cases_before_any_make_up():
    # A1 is declared first and short; filling its make-up first would take the
    # A2 Cases that A2 itself is targeted at.
    config = _config({A1: 4, A2: 3})

    selected = TargetedSelection(config)(_pool((A1, 1, 0), (A2, 3, 0)))

    assert _cells(selected) == {A1: 1, A2: 3}


def test_the_balance_column_is_split_evenly_within_each_balance_group():
    # Balanced per product, not per attribute: a1 offers only True Cases, so a2
    # leans False to bring the product to 50/50.
    config = _config(
        {A1: 4, A2: 4},
        balance_column="vulnerable",
        balance_by=("brand", "case_type", "product"),
    )

    selected = TargetedSelection(config)(_pool((A1, 10, 0), (A2, 10, 10)))

    frame = selected.to_pandas()
    assert _cells(selected) == {A1: 4, A2: 4}
    assert frame["vulnerable"].sum() == 4
    assert frame.loc[frame["attribute"] == "a2", "vulnerable"].sum() == 0


def test_the_balance_is_a_preference_not_a_gate():
    # Only True Cases exist, so the target is still met rather than held at 50%.
    config = _config({A1: 4}, balance_column="vulnerable")

    selected = TargetedSelection(config)(_pool((A1, 10, 0)))

    assert _cells(selected) == {A1: 4}


def test_the_selection_is_reproducible_and_independent_of_row_order():
    pool = _pool((A1, 20, 20), (A2, 20, 20))
    shuffled = Dataset.from_pandas(pool.to_pandas().sample(frac=1, random_state=7))
    selection = TargetedSelection(_config({A1: 5, A2: 5}, balance_column="vulnerable"))

    first = selection(pool).to_pandas()["case_id"].tolist()

    assert selection(shuffled).to_pandas()["case_id"].tolist() == first


def test_without_a_seed_cases_are_taken_in_order():
    config = _config({A1: 3}, seed=None)

    selected = TargetedSelection(config)(_pool((A1, 5, 5)))

    assert selected.to_pandas()["case_id"].tolist() == ["c0000", "c0001", "c0002"]


def test_it_runs_as_a_pipeline_transform_step():
    config = _config({A1: 2})

    selected = transform(
        TargetedSelection(config), read(DatasetReader(_pool((A1, 5, 5))))
    )

    assert _cells(selected) == {A1: 2}


def test_a_missing_column_is_named():
    config = _config({A1: 1}, balance_column="not_a_column")

    with pytest.raises(ValueError, match="not_a_column"):
        TargetedSelection(config)(_pool((A1, 1, 1)))


@pytest.mark.parametrize(
    "overrides, message",
    [
        (dict(make_up_to=("case_type",)), "make_up_to"),
        (dict(balance_by=("product",)), "balance_by"),
        (dict(targets={("b1", "ct1"): 1}), "one value per level"),
        (dict(total=-1), "total"),
    ],
)
def test_an_inconsistent_config_is_refused(overrides, message):
    with pytest.raises(ValueError, match=message):
        _config(overrides.pop("targets", {A1: 1}), **overrides)

```
