```python
import pandas as pd
import pytest

from framework.core.dataset import Dataset
from tools.analytics.processors import Parse, Sample, SamplePerGroup, TopNPerGroup


def test_sample_keeps_at_most_n_from_the_whole_feed():
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_id": [f"c{i}" for i in range(10)]})
    )
    kept = Sample(n=3, seed=7)(dataset).to_pandas()
    assert len(kept) == 3


def test_sample_is_reproducible_for_the_same_input_and_seed():
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_id": [f"c{i}" for i in range(10)]})
    )
    first = Sample(n=3, seed=7)(dataset).to_pandas()
    second = Sample(n=3, seed=7)(dataset).to_pandas()
    assert list(first["case_id"]) == list(second["case_id"])


def test_sample_is_invariant_to_incoming_row_order():
    forward = pd.DataFrame({"case_id": [f"c{i}" for i in range(6)]})
    shuffled = forward.iloc[[4, 0, 2, 5, 1, 3]].reset_index(drop=True)
    a = Sample(n=3, seed=7)(Dataset.from_pandas(forward)).to_pandas()
    b = Sample(n=3, seed=7)(Dataset.from_pandas(shuffled)).to_pandas()
    assert list(a["case_id"]) == list(b["case_id"])


def test_sample_passes_a_feed_smaller_than_n_through_whole():
    dataset = Dataset.from_pandas(pd.DataFrame({"case_id": ["c1", "c2", "c3"]}))
    kept = Sample(n=5, seed=1)(dataset).to_pandas()
    assert set(kept["case_id"]) == {"c1", "c2", "c3"}


def test_sample_empty_in_empty_out():
    empty = Dataset.from_pandas(pd.DataFrame({"case_id": []}))
    assert len(Sample(n=2, seed=1)(empty)) == 0


def test_sample_different_seeds_can_draw_different_samples():
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_id": [f"c{i}" for i in range(20)]})
    )
    one = Sample(n=5, seed=1)(dataset).to_pandas()
    two = Sample(n=5, seed=2)(dataset).to_pandas()
    assert set(one["case_id"]) != set(two["case_id"])


def test_sample_draws_a_fraction_of_the_feed():
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_id": [f"c{i}" for i in range(10)]})
    )
    kept = Sample(fraction=0.3, seed=7)(dataset).to_pandas()
    assert len(kept) == 3


def test_sample_fraction_resolves_against_the_run_population():
    big = Dataset.from_pandas(pd.DataFrame({"case_id": [f"c{i}" for i in range(20)]}))
    small = Dataset.from_pandas(pd.DataFrame({"case_id": [f"c{i}" for i in range(4)]}))
    assert len(Sample(fraction=0.5, seed=7)(big).to_pandas()) == 10
    assert len(Sample(fraction=0.5, seed=7)(small).to_pandas()) == 2


def test_sample_fraction_is_reproducible_for_the_same_input_and_seed():
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_id": [f"c{i}" for i in range(10)]})
    )
    first = Sample(fraction=0.4, seed=7)(dataset).to_pandas()
    second = Sample(fraction=0.4, seed=7)(dataset).to_pandas()
    assert list(first["case_id"]) == list(second["case_id"])


def test_sample_fraction_of_one_keeps_the_whole_feed():
    dataset = Dataset.from_pandas(pd.DataFrame({"case_id": ["c1", "c2", "c3"]}))
    kept = Sample(fraction=1.0, seed=1)(dataset).to_pandas()
    assert set(kept["case_id"]) == {"c1", "c2", "c3"}


def test_sample_requires_exactly_one_of_n_or_fraction():
    with pytest.raises(ValueError, match="exactly one of `n` or `fraction`"):
        Sample()
    with pytest.raises(ValueError, match="exactly one of `n` or `fraction`"):
        Sample(n=5, fraction=0.5)


def test_sample_rejects_a_fraction_outside_the_unit_interval():
    with pytest.raises(ValueError, match="must be in"):
        Sample(fraction=0)
    with pytest.raises(ValueError, match="must be in"):
        Sample(fraction=1.5)


def test_sample_per_group_keeps_at_most_n_per_group():
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_id": ["c1", "c2", "c3", "c4", "c5"],
                "adviser": ["a", "a", "a", "b", "b"],
            }
        )
    )
    kept = SamplePerGroup(key="adviser", n=2, seed=7)(dataset).to_pandas()
    counts = kept.groupby("adviser").size()
    assert counts["a"] == 2
    assert counts["b"] == 2


def test_sample_per_group_is_reproducible_for_the_same_input_and_seed():
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_id": ["c1", "c2", "c3", "c4", "c5"],
                "adviser": ["a", "a", "a", "b", "b"],
            }
        )
    )
    first = SamplePerGroup(key="adviser", n=2, seed=7)(dataset).to_pandas()
    second = SamplePerGroup(key="adviser", n=2, seed=7)(dataset).to_pandas()
    assert list(first["case_id"]) == list(second["case_id"])


def test_sample_per_group_is_invariant_to_incoming_row_order():
    rows = {
        "case_id": ["c1", "c2", "c3", "c4", "c5"],
        "adviser": ["a", "a", "a", "b", "b"],
    }
    forward = pd.DataFrame(rows)
    shuffled = forward.iloc[[4, 0, 2, 1, 3]].reset_index(drop=True)
    a = SamplePerGroup(key="adviser", n=2, seed=7)(
        Dataset.from_pandas(forward)
    ).to_pandas()
    b = SamplePerGroup(key="adviser", n=2, seed=7)(
        Dataset.from_pandas(shuffled)
    ).to_pandas()
    assert set(a["case_id"]) == set(b["case_id"])
    assert list(a["case_id"]) == list(b["case_id"])


def test_sample_per_group_passes_a_group_smaller_than_n_through_whole():
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_id": ["c1", "c2", "c3"], "adviser": ["a", "b", "b"]})
    )
    kept = SamplePerGroup(key="adviser", n=5, seed=1)(dataset).to_pandas()
    assert set(kept["case_id"]) == {"c1", "c2", "c3"}


def test_sample_per_group_empty_in_empty_out():
    empty = Dataset.from_pandas(pd.DataFrame({"case_id": [], "adviser": []}))
    assert len(SamplePerGroup(key="adviser", n=2, seed=1)(empty)) == 0


def test_sample_per_group_supports_a_multi_column_key():
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_id": ["c1", "c2", "c3", "c4", "c5", "c6"],
                "adviser": ["a", "a", "a", "a", "a", "a"],
                "region": ["n", "n", "n", "s", "s", "s"],
            }
        )
    )
    kept = SamplePerGroup(key=["adviser", "region"], n=2, seed=3)(dataset).to_pandas()
    counts = kept.groupby(["adviser", "region"]).size()
    assert counts[("a", "n")] == 2
    assert counts[("a", "s")] == 2


def test_sample_per_group_different_seeds_can_draw_different_samples():
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_id": [f"c{i}" for i in range(20)], "adviser": (["a"] * 20)})
    )
    one = SamplePerGroup(key="adviser", n=5, seed=1)(dataset).to_pandas()
    two = SamplePerGroup(key="adviser", n=5, seed=2)(dataset).to_pandas()
    assert set(one["case_id"]) != set(two["case_id"])


def test_top_n_per_group_n1_keeps_the_single_highest_by_row_per_group():
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_id": ["c1", "c2", "c3", "c4"],
                "adviser": ["a", "a", "b", "b"],
                "score": [10, 30, 50, 20],
            }
        )
    )
    kept = TopNPerGroup(key="adviser", by="score", n=1)(dataset).to_pandas()
    assert set(kept["case_id"]) == {"c2", "c3"}


def test_top_n_per_group_breaks_score_ties_on_tiebreak_deterministically():
    rows = pd.DataFrame(
        {"case_id": ["c2", "c1"], "adviser": ["a", "a"], "score": [40, 40]}
    )
    kept = TopNPerGroup(key="adviser", by="score", n=1, tiebreak="case_id")(
        Dataset.from_pandas(rows)
    ).to_pandas()
    assert list(kept["case_id"]) == ["c1"]


def test_top_n_per_group_n_gt_1_keeps_the_top_n_ranked_per_group():
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_id": ["c1", "c2", "c3", "c4", "c5"],
                "adviser": ["a", "a", "a", "b", "b"],
                "score": [10, 30, 20, 5, 50],
            }
        )
    )
    kept = TopNPerGroup(key="adviser", by="score", n=2)(dataset).to_pandas()
    assert set(kept.loc[((kept["adviser"] == "a"), "case_id")]) == {"c2", "c3"}
    assert set(kept.loc[((kept["adviser"] == "b"), "case_id")]) == {"c4", "c5"}


def test_top_n_per_group_passes_a_group_smaller_than_n_through_whole():
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_id": ["c1", "c2", "c3"],
                "adviser": ["a", "b", "b"],
                "score": [10, 20, 30],
            }
        )
    )
    kept = TopNPerGroup(key="adviser", by="score", n=5)(dataset).to_pandas()
    assert set(kept["case_id"]) == {"c1", "c2", "c3"}


def test_top_n_per_group_empty_in_empty_out():
    empty = Dataset.from_pandas(
        pd.DataFrame({"case_id": [], "adviser": [], "score": []})
    )
    kept = TopNPerGroup(key="adviser", by="score", n=1)(empty)
    assert len(kept) == 0


def test_top_n_per_group_supports_a_multi_column_key():
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_id": ["c1", "c2", "c3", "c4"],
                "adviser": ["a", "a", "a", "a"],
                "region": ["n", "n", "s", "s"],
                "score": [10, 30, 50, 20],
            }
        )
    )
    kept = TopNPerGroup(key=["adviser", "region"], by="score", n=1)(dataset).to_pandas()
    assert set(kept["case_id"]) == {"c2", "c3"}


def test_top_n_per_group_ascending_ranks_lowest_first():
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_id": ["c1", "c2", "c3"],
                "adviser": ["a", "a", "a"],
                "score": [10, 30, 20],
            }
        )
    )
    kept = TopNPerGroup(key="adviser", by="score", n=1, ascending=True)(
        dataset
    ).to_pandas()
    assert list(kept["case_id"]) == ["c1"]


def test_top_n_per_group_returns_a_dataset_not_a_dataframe():
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_id": ["c1"], "adviser": ["a"], "score": [1]})
    )
    assert isinstance(TopNPerGroup(key="adviser", by="score", n=1)(dataset), Dataset)


def test_parse_decodes_a_json_column_into_structured_values():
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {"case_ref": ["c1", "c2"], "payload": ['{"score": 10}', "[1, 2, 3]"]}
        )
    )
    result = Parse("payload")(dataset).to_pandas()
    assert result.loc[(0, "payload")] == {"score": 10}
    assert result.loc[(1, "payload")] == [1, 2, 3]


def test_parse_applies_a_custom_parser_to_several_columns():
    dataset = Dataset.from_pandas(
        pd.DataFrame({"a": ["1", "2"], "b": ["3", "4"], "c": ["x", "y"]})
    )
    result = Parse(["a", "b"], parser=int)(dataset).to_pandas()
    assert list(result["a"]) == [1, 2]
    assert list(result["b"]) == [3, 4]
    assert list(result["c"]) == ["x", "y"]


def test_parse_raises_on_missing_column():
    dataset = Dataset.from_pandas(pd.DataFrame({"a": ["1"]}))
    with pytest.raises(ValueError, match="nope"):
        Parse(["a", "nope"])(dataset)


def test_parse_on_empty_feed_returns_empty_feed():
    dataset = Dataset.from_pandas(
        pd.DataFrame({"payload": pd.Series([], dtype=object)})
    )
    result = Parse("payload")(dataset)
    assert isinstance(result, Dataset)
    assert len(result) == 0

```
