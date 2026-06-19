```python
"""Selection processors: filter, score, sort, rename, and cross-feed joins.

These are the engine-confined transforms the Selection workload composes between
a feed's read and its post-validators. ``Filter`` and ``Score`` carry
plain-Python row callables so the business rule never names the engine;
``JoinWith`` consumes an explicit read-only dependency so upstream execution is
not hidden inside ``process``.
"""

import json
import uuid as _uuid

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.io.store import Store
from framework.io.strategy import Refresh
from framework.run.builder import Pipeline
from framework.run.run_log import RunLog
from framework.transform import AntiJoinWith as PublicAntiJoinWith
from framework.transform.processors import (
    AntiJoinWith,
    DeriveKey,
    DropColumns,
    Filter,
    JoinColumns,
    JoinDependency,
    JoinWith,
    LatestPerKey,
    Parse,
    Rename,
    SamplePerGroup,
    Score,
    SelectColumns,
    Sort,
    SplitColumn,
    Stamp,
    TopNPerGroup,
    Unpivot,
    VectorizedDerive,
    VectorizedFilter,
)


class RecordingReader:
    """A Reader stand-in: returns a dataset and counts reads."""

    def __init__(self, dataset: Dataset) -> None:
        self._dataset = dataset
        self.read_count = 0

    def read(self) -> Dataset:
        self.read_count += 1
        return self._dataset


def test_filter_keeps_only_rows_matching_the_predicate():
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1", "c2", "c3"], "score": [10, 5, 20]})
    )

    kept = Filter(lambda row: row["score"] >= 10).process(dataset).to_pandas()

    assert list(kept["case_ref"]) == ["c1", "c3"]


def test_filter_handles_an_empty_feed():
    # An empty input is realistic in Selection (an upstream filter matched
    # nothing); row-wise apply over zero rows must yield an empty dataset, not
    # raise — a regression guard for the apply-on-empty pandas pitfall.
    empty = Dataset.from_pandas(pd.DataFrame({"score": []}))

    kept = Filter(lambda row: row["score"] >= 10).process(empty)

    assert len(kept) == 0


def test_score_writes_a_column_computed_per_row():
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1", "c2"], "amount": [100, 50]})
    )

    scored = (
        Score("priority", lambda row: row["amount"] * 2).process(dataset).to_pandas()
    )

    assert list(scored["priority"]) == [200, 100]
    assert list(scored["case_ref"]) == ["c1", "c2"]


def test_vectorized_filter_matches_row_filter_for_the_same_rule():
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1", "c2", "c3"], "score": [5, 10, 15]})
    )

    row = Filter(lambda row: row["score"] >= 10).process(dataset).to_pandas()
    vectorized = (
        VectorizedFilter(lambda frame: frame["score"] >= 10)
        .process(dataset)
        .to_pandas()
    )

    assert vectorized.to_dict("records") == row.to_dict("records")


def test_vectorized_derive_matches_row_score_for_the_same_rule():
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1", "c2"], "amount": [100, 50]})
    )

    row = Score("priority", lambda row: row["amount"] * 2).process(dataset).to_pandas()
    vectorized = (
        VectorizedDerive("priority", lambda frame: frame["amount"] * 2)
        .process(dataset)
        .to_pandas()
    )

    assert vectorized.to_dict("records") == row.to_dict("records")


def test_vectorized_processors_call_their_rules_once_per_dataset():
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1", "c2", "c3"], "score": [5, 10, 15]})
    )
    calls = {"filter": 0, "derive": 0}

    def high_score(frame: pd.DataFrame) -> pd.Series:
        calls["filter"] += 1
        return frame["score"] >= 10

    def double_score(frame: pd.DataFrame) -> pd.Series:
        calls["derive"] += 1
        return frame["score"] * 2

    filtered = VectorizedFilter(high_score).process(dataset)
    result = (
        VectorizedDerive("double_score", double_score).process(filtered).to_pandas()
    )

    assert calls == {"filter": 1, "derive": 1}
    assert result.to_dict("records") == [
        {"case_ref": "c2", "score": 10, "double_score": 20},
        {"case_ref": "c3", "score": 15, "double_score": 30},
    ]


def test_stamp_writes_a_constant_column_onto_every_row():
    dataset = Dataset.from_pandas(pd.DataFrame({"case_ref": ["c1", "c2", "c3"]}))

    stamped = Stamp("question_bank_id", "qb-100").process(dataset).to_pandas()

    assert list(stamped["question_bank_id"]) == ["qb-100", "qb-100", "qb-100"]
    assert list(stamped["case_ref"]) == ["c1", "c2", "c3"]


def test_stamp_writes_the_column_even_onto_an_empty_feed():
    # An empty SelectionPool (an upstream filter matched nothing) must still
    # carry the stamped column, so the gold schema is the same shape whether or
    # not any Case was selected — a regression guard for assign-on-empty.
    empty = Dataset.from_pandas(pd.DataFrame({"case_ref": []}))

    stamped = Stamp("question_bank_id", "qb-100").process(empty)

    assert "question_bank_id" in stamped.columns
    assert len(stamped) == 0


def test_sort_orders_rows_by_a_column():
    # Sort orders the rows so a downstream "top N" selection is meaningful;
    # ascending is the default, with descending available for highest-first.
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1", "c2", "c3"], "score": [10, 30, 20]})
    )

    ordered = Sort("score", ascending=False).process(dataset).to_pandas()

    assert list(ordered["case_ref"]) == ["c2", "c3", "c1"]


def test_sort_resets_the_index_so_position_is_stable():
    # The sorted dataset reads positionally clean (0..n-1), so it round-trips to
    # storage without a stale source order leaking through the index.
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1", "c2"], "score": [2, 1]})
    )

    ordered = Sort("score").process(dataset).to_pandas()

    assert list(ordered.index) == [0, 1]


def test_rename_renames_mapped_columns_and_leaves_the_rest():
    # Rename aligns a feed's columns to a shared vocabulary (e.g. before a join);
    # only mapped columns change, undeclared ones pass through untouched.
    dataset = Dataset.from_pandas(
        pd.DataFrame({"ref": ["c1"], "amt": [100], "note": ["keep"]})
    )

    renamed = Rename({"ref": "case_ref", "amt": "amount"}).process(dataset)

    assert renamed.columns == ["case_ref", "amount", "note"]


def test_join_with_brings_in_the_other_feeds_columns_on_the_key():
    # Joined in Python, not SQL, so business logic stays out of storage.
    cases = Dataset.from_pandas(
        pd.DataFrame({"adviser": ["a1", "a2"], "case_ref": ["c1", "c2"]})
    )
    advisers = JoinDependency(
        "advisers",
        RecordingReader(
            Dataset.from_pandas(
                pd.DataFrame({"adviser": ["a1", "a2"], "region": ["north", "south"]})
            )
        ),
    )

    joined = JoinWith(advisers, on="adviser").process(cases).to_pandas()

    assert list(joined["case_ref"]) == ["c1", "c2"]
    assert list(joined["region"]) == ["north", "south"]


def test_join_dependency_is_read_once_and_logged_separately(tmp_path):
    cases = Dataset.from_pandas(pd.DataFrame({"adviser": ["a1"], "case_ref": ["c1"]}))
    reader = RecordingReader(
        Dataset.from_pandas(
            pd.DataFrame({"adviser": ["a1"], "region": ["north"], "team": ["A"]})
        )
    )
    advisers = JoinDependency("advisers", reader)
    log_path = tmp_path / "selection.log"

    result = (
        Pipeline("selection", RecordingReader(cases), run_log=RunLog(log_path))
        .with_processor(JoinWith(advisers, on="adviser"))
        .with_processor(JoinWith(advisers, on="adviser", how="left"))
        .run()
        .to_pandas()
    )

    records = [json.loads(line) for line in log_path.read_text().splitlines()]
    assert reader.read_count == 1
    assert list(result["case_ref"]) == ["c1"]
    assert [record["step"] for record in records].count("dependency:advisers") == 1
    assert "process" in [record["step"] for record in records]


def test_join_with_inner_default_drops_unmatched_rows():
    # The default inner join keeps only rows present in both feeds, so a case
    # with no matching reference row is dropped rather than carried with nulls.
    cases = Dataset.from_pandas(
        pd.DataFrame({"adviser": ["a1", "a2"], "case_ref": ["c1", "c2"]})
    )
    advisers = RecordingReader(
        Dataset.from_pandas(pd.DataFrame({"adviser": ["a1"], "region": ["north"]}))
    )

    joined = JoinWith(advisers, on="adviser").process(cases).to_pandas()

    assert list(joined["case_ref"]) == ["c1"]


def test_anti_join_with_excludes_rows_whose_key_is_in_the_other_dataset():
    cases = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_id": ["c1", "c2", "c3"],
                "amount": [100, 200, 300],
            }
        )
    )
    already_seen = Dataset.from_pandas(pd.DataFrame({"case_id": ["c2"]}))

    kept = (
        PublicAntiJoinWith(already_seen, on="case_id", name="already-seen")
        .process(cases)
        .to_pandas()
    )

    assert list(kept["case_id"]) == ["c1", "c3"]
    assert list(kept["amount"]) == [100, 300]


def test_anti_join_with_supports_composite_keys():
    cases = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_id": ["c1", "c1", "c2"],
                "run_id": ["r1", "r2", "r1"],
                "amount": [100, 200, 300],
            }
        )
    )
    excluded = Dataset.from_pandas(pd.DataFrame({"case_id": ["c1"], "run_id": ["r2"]}))

    kept = AntiJoinWith(excluded, on=["case_id", "run_id"]).process(cases).to_pandas()

    assert list(kept["case_id"]) == ["c1", "c2"]
    assert list(kept["run_id"]) == ["r1", "r1"]


def test_anti_join_with_keeps_all_rows_when_no_keys_match():
    cases = Dataset.from_pandas(pd.DataFrame({"case_id": ["c1", "c2"]}))
    excluded = Dataset.from_pandas(pd.DataFrame({"case_id": ["c3"]}))

    kept = AntiJoinWith(excluded, on="case_id").process(cases).to_pandas()

    assert list(kept["case_id"]) == ["c1", "c2"]


def test_anti_join_with_treats_duplicate_other_keys_as_set_membership():
    cases = Dataset.from_pandas(
        pd.DataFrame({"case_id": ["c1", "c2", "c3"], "amount": [10, 20, 30]})
    )
    excluded = Dataset.from_pandas(pd.DataFrame({"case_id": ["c2", "c2"]}))

    kept = AntiJoinWith(excluded, on="case_id").process(cases).to_pandas()

    assert list(kept["case_id"]) == ["c1", "c3"]
    assert list(kept["amount"]) == [10, 30]


def test_anti_join_dependency_is_read_once_and_logged_separately(
    tmp_path,
):
    cases = Dataset.from_pandas(pd.DataFrame({"case_id": ["c1", "c2", "c3"]}))
    reader = RecordingReader(Dataset.from_pandas(pd.DataFrame({"case_id": ["c2"]})))
    excluded = JoinDependency("already-reviewed", reader)
    log_path = tmp_path / "selection.log"

    result = (
        Pipeline("selection", RecordingReader(cases), run_log=RunLog(log_path))
        .with_processor(AntiJoinWith(excluded, on="case_id"))
        .with_processor(AntiJoinWith(excluded, on="case_id"))
        .run()
        .to_pandas()
    )

    records = [json.loads(line) for line in log_path.read_text().splitlines()]
    assert reader.read_count == 1
    assert list(result["case_id"]) == ["c1", "c3"]
    assert [record["step"] for record in records].count(
        "dependency:already-reviewed"
    ) == 1


def test_anti_join_with_missing_key_columns_fails_fast_with_context():
    cases = Dataset.from_pandas(pd.DataFrame({"case_id": ["c1"]}))
    excluded = Dataset.from_pandas(pd.DataFrame({"other_id": ["c1"]}))

    try:
        AntiJoinWith(excluded, on="case_id").process(cases)
    except ValueError as exc:
        message = str(exc)
    else:
        raise AssertionError("AntiJoinWith should fail when a key column is missing")

    assert "AntiJoinWith" in message
    assert "case_id" in message
    assert "other" in message


def test_anti_join_with_exposes_trace_metadata_for_selection_explainability():
    excluded = Dataset.from_pandas(pd.DataFrame({"case_id": ["c1"]}))

    gate = AntiJoinWith(excluded, on="case_id", name="already-reviewed")

    assert gate.trace_role == "join"
    assert gate.trace_name == "already-reviewed"


def test_pipeline_filters_one_feed_and_joins_another_feeds_silver(tmp_path):
    # Acceptance: end to end through the real builder — a Selection-shaped
    # pipeline reads one subject's silver, filters it in Python, and joins
    # another subject's silver Reference Data via an explicit read-only
    # dependency. Upstream execution is not hidden in JoinWith.process().
    cases = Store(tmp_path / "cases")
    advisers = Store(tmp_path / "advisers")
    cases.writer("silver", "cases", Refresh()).write(
        Dataset.from_pandas(
            pd.DataFrame(
                {
                    "adviser": ["a1", "a2", "a3"],
                    "case_ref": ["c1", "c2", "c3"],
                    "amount": [100, 5, 50],
                }
            )
        )
    )
    advisers.writer("silver", "advisers", Refresh()).write(
        Dataset.from_pandas(
            pd.DataFrame({"adviser": ["a1", "a3"], "region": ["north", "south"]})
        )
    )

    reference = JoinDependency("advisers", advisers.reader("silver", "advisers"))
    selected = (
        Pipeline("cases", cases.reader("silver", "cases"))
        .with_processor(Filter(lambda row: row["amount"] >= 50))
        .with_processor(JoinWith(reference, on="adviser"))
        .run()
        .to_pandas()
    )

    # a2 dropped by the filter (amount 5); the survivors gain the adviser region.
    assert list(selected["case_ref"]) == ["c1", "c3"]
    assert list(selected["region"]) == ["north", "south"]


_NS = _uuid.UUID("12345678-1234-5678-1234-567812345678")


def test_derive_key_stamps_uuid5_for_a_single_column_key():
    # DeriveKey computes uuid5(namespace, key_string) per row and writes it into
    # the `into` column as a string; the value must equal the uuid5 we'd compute
    # by hand (stored as text so it round-trips through SQLite unchanged).
    dataset = Dataset.from_pandas(
        pd.DataFrame({"surname": ["SMITH"], "dob": ["2024-01-15"]})
    )

    result = (
        DeriveKey(into="case_id", namespace=_NS, natural_key=["surname"])
        .process(dataset)
        .to_pandas()
    )

    expected = str(_uuid.uuid5(_NS, "SMITH"))
    assert result["case_id"].iloc[0] == expected


def test_derive_key_is_deterministic_across_runs():
    # Re-running DeriveKey over identical input must produce identical case_ids —
    # the same natural-key values always map to the same UUID on every run and
    # every machine (determinism criterion).
    dataset = Dataset.from_pandas(pd.DataFrame({"ref": ["A", "B"]}))
    processor = DeriveKey(into="case_id", namespace=_NS, natural_key=["ref"])

    first = list(processor.process(dataset).to_pandas()["case_id"])
    second = list(processor.process(dataset).to_pandas()["case_id"])

    assert first == second


def test_derive_key_different_namespaces_yield_different_ids():
    # The same natural-key values under two different namespaces must produce
    # different case_ids — the namespace is the case-type discriminator.
    _NS2 = _uuid.UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    dataset = Dataset.from_pandas(pd.DataFrame({"ref": ["X"]}))

    id_ns1 = (
        DeriveKey(into="case_id", namespace=_NS, natural_key=["ref"])
        .process(dataset)
        .to_pandas()["case_id"]
        .iloc[0]
    )
    id_ns2 = (
        DeriveKey(into="case_id", namespace=_NS2, natural_key=["ref"])
        .process(dataset)
        .to_pandas()["case_id"]
        .iloc[0]
    )

    assert id_ns1 != id_ns2


def test_derive_key_multi_column_key_composes_in_declared_order():
    # Multi-column natural keys are composed as "col_a|col_b" in declared order;
    # the uuid5 result must equal hand-computing uuid5(NS, "SMITH|2024-01-15").
    dataset = Dataset.from_pandas(
        pd.DataFrame({"surname": ["SMITH"], "dob": ["2024-01-15"]})
    )

    result = (
        DeriveKey(into="case_id", namespace=_NS, natural_key=["surname", "dob"])
        .process(dataset)
        .to_pandas()
    )

    expected = str(_uuid.uuid5(_NS, "SMITH|2024-01-15"))
    assert result["case_id"].iloc[0] == expected


def test_derive_key_multi_column_key_order_matters():
    # Column order in natural_key is significant: ["surname", "dob"] and
    # ["dob", "surname"] must produce different ids for the same row.
    dataset = Dataset.from_pandas(
        pd.DataFrame({"surname": ["SMITH"], "dob": ["2024-01-15"]})
    )

    id_ab = (
        DeriveKey(into="case_id", namespace=_NS, natural_key=["surname", "dob"])
        .process(dataset)
        .to_pandas()["case_id"]
        .iloc[0]
    )
    id_ba = (
        DeriveKey(into="case_id", namespace=_NS, natural_key=["dob", "surname"])
        .process(dataset)
        .to_pandas()["case_id"]
        .iloc[0]
    )

    assert id_ab != id_ba


def test_derive_key_returns_a_dataset_not_a_dataframe():
    # Engine-confined: DeriveKey.process must return a Dataset, not
    # a pandas DataFrame — pandas stays behind the seam.
    dataset = Dataset.from_pandas(pd.DataFrame({"ref": ["A"]}))

    result = DeriveKey(into="case_id", namespace=_NS, natural_key=["ref"]).process(
        dataset
    )

    assert isinstance(result, Dataset)


def test_latest_per_key_keeps_one_row_per_key_with_maximum_by_value():
    # Simulates accumulated silver history: case_id "A" has two rows with
    # different load_dates. LatestPerKey must return the row with the max
    # load_date and drop the earlier one.
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_id": ["A", "A", "B"],
                "load_date": ["2024-01-01", "2024-03-01", "2024-02-01"],
                "status": ["open", "closed", "open"],
            }
        )
    )

    result = LatestPerKey(key="case_id", by="load_date").process(dataset).to_pandas()

    assert len(result) == 2
    assert set(result["case_id"]) == {"A", "B"}
    # The latest row for A is the "closed" one (2024-03-01)
    row_a = result[result["case_id"] == "A"].iloc[0]
    assert row_a["status"] == "closed"


def test_latest_per_key_supports_multi_column_keys():
    # key can be a list of column names; the unique key is the combination.
    # Entity (type="complaint", ref="C1") has two rows; (type="request", ref="C1")
    # has one. Result must have one row per (type, ref) pair.
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "type": ["complaint", "complaint", "request"],
                "ref": ["C1", "C1", "C1"],
                "load_date": ["2024-01-01", "2024-06-01", "2024-03-01"],
                "status": ["open", "resolved", "pending"],
            }
        )
    )

    result = (
        LatestPerKey(key=["type", "ref"], by="load_date").process(dataset).to_pandas()
    )

    assert len(result) == 2
    complaint_row = result[result["type"] == "complaint"].iloc[0]
    assert complaint_row["status"] == "resolved"


def test_latest_per_key_ties_resolve_to_last_row_in_input_order():
    # When two rows share the same maximum `by` value (a tie), the row that
    # appears last in the input is kept. This is the documented tie-break rule.
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_id": ["A", "A"],
                "load_date": ["2024-01-01", "2024-01-01"],
                "status": ["first", "second"],
            }
        )
    )

    result = LatestPerKey(key="case_id", by="load_date").process(dataset).to_pandas()

    assert len(result) == 1
    assert result.iloc[0]["status"] == "second"


def test_latest_per_key_raises_when_key_column_is_missing():
    # A located error (naming the missing column) is raised when the key column
    # is absent from the dataset — prevents silent wrong results.
    dataset = Dataset.from_pandas(
        pd.DataFrame({"load_date": ["2024-01-01"], "status": ["open"]})
    )

    with pytest.raises(ValueError, match="case_id"):
        LatestPerKey(key="case_id", by="load_date").process(dataset)


def test_latest_per_key_raises_when_by_column_is_missing():
    # A located error is raised when the `by` column is absent — the caller
    # must know exactly which column is missing to fix their pipeline.
    dataset = Dataset.from_pandas(pd.DataFrame({"case_id": ["A"], "status": ["open"]}))

    with pytest.raises(ValueError, match="load_date"):
        LatestPerKey(key="case_id", by="load_date").process(dataset)


def test_latest_per_key_returns_a_dataset_not_a_dataframe():
    # Engine-confined: process() must return a Dataset, keeping
    # pandas behind the seam — callers never touch the backing frame directly.
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {"case_id": ["A"], "load_date": ["2024-01-01"], "status": ["open"]}
        )
    )

    result = LatestPerKey(key="case_id", by="load_date").process(dataset)

    assert isinstance(result, Dataset)


def test_select_columns_keeps_only_the_listed_columns():
    # SelectColumns is the column-projection seam: each fan-out pipeline reads
    # only the columns it needs from the shared raw table.
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1"], "amount": [100], "product_1": ["widget"]})
    )

    result = SelectColumns(["case_ref", "amount"]).process(dataset).to_pandas()

    assert list(result.columns) == ["case_ref", "amount"]
    assert "product_1" not in result.columns


def test_select_columns_raises_when_a_column_is_missing():
    # A misconfigured projection is caught immediately so a silent wrong result
    # (missing column without error) can't reach the Writer.
    dataset = Dataset.from_pandas(pd.DataFrame({"case_ref": ["c1"]}))

    with pytest.raises(ValueError, match="product_1"):
        SelectColumns(["case_ref", "product_1"]).process(dataset)


def test_drop_columns_removes_the_listed_columns_and_keeps_the_rest_in_order():
    # DropColumns is the exclusion form of the projection seam: a wide feed that
    # wants almost every column strips the few it doesn't, rather than enumerate
    # the many it keeps.
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1"], "scratch": [1], "amount": [100]})
    )

    result = DropColumns(["scratch"]).process(dataset).to_pandas()

    assert list(result.columns) == ["case_ref", "amount"]
    assert "scratch" not in result.columns


def test_drop_columns_raises_when_a_column_is_missing():
    # A mis-typed drop is caught immediately rather than silently doing nothing,
    # mirroring SelectColumns' fail-fast contract.
    dataset = Dataset.from_pandas(pd.DataFrame({"case_ref": ["c1"]}))

    with pytest.raises(ValueError, match="scratch"):
        DropColumns(["scratch"]).process(dataset)


def test_unpivot_melts_value_vars_into_one_row_per_value():
    # Each product column becomes a row, so product_1..N are not repeated fields
    # but a proper one-row-per-product Detail Table.
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_ref": ["c1", "c2"],
                "product_1": ["widget", "gadget"],
                "product_2": ["doodad", None],
            }
        )
    )

    result = (
        Unpivot(
            id_vars=["case_ref"],
            value_vars=["product_1", "product_2"],
            var_name="product_slot",
            value_name="product_name",
            drop_empty=False,
        )
        .process(dataset)
        .to_pandas()
    )

    # 2 cases × 2 products = 4 rows (before dropping empties)
    assert len(result) == 4
    assert set(result.columns) == {"case_ref", "product_slot", "product_name"}


def test_unpivot_drops_null_and_blank_values_by_default():
    # drop_empty=True (the default) removes rows where the value is None or
    # blank — the normal behaviour for wide product feeds with unoccupied slots.
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_ref": ["c1"],
                "product_1": ["widget"],
                "product_2": [None],
                "product_3": ["   "],
            }
        )
    )

    result = (
        Unpivot(
            id_vars=["case_ref"],
            value_vars=["product_1", "product_2", "product_3"],
            var_name="slot",
            value_name="name",
        )
        .process(dataset)
        .to_pandas()
    )

    # Only the non-empty product_1 row survives
    assert len(result) == 1
    assert result.iloc[0]["name"] == "widget"


def test_unpivot_returns_a_dataset_not_a_dataframe():
    # Engine-confined: process() must return a Dataset.
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1"], "product_1": ["widget"]})
    )

    result = Unpivot(
        id_vars=["case_ref"],
        value_vars=["product_1"],
        var_name="slot",
        value_name="name",
    ).process(dataset)

    assert isinstance(result, Dataset)


def test_top_n_per_group_n1_keeps_the_single_highest_by_row_per_group():
    # "The single highest-scoring available Case per Adviser" — n=1 reduces each
    # group to its top-ranked row, ranked by `by` descending (default).
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_id": ["c1", "c2", "c3", "c4"],
                "adviser": ["a", "a", "b", "b"],
                "score": [10, 30, 50, 20],
            }
        )
    )

    kept = TopNPerGroup(key="adviser", by="score", n=1).process(dataset).to_pandas()

    assert set(kept["case_id"]) == {"c2", "c3"}  # top of each adviser


def test_top_n_per_group_breaks_score_ties_on_tiebreak_deterministically():
    # Two Cases in group "a" tie on score; the tie-break (case_id, ascending)
    # must pick the lower case_id reproducibly, regardless of input row order.
    rows = pd.DataFrame(
        {
            "case_id": ["c2", "c1"],  # deliberately reverse-ordered
            "adviser": ["a", "a"],
            "score": [40, 40],  # tied
        }
    )
    kept = (
        TopNPerGroup(key="adviser", by="score", n=1, tiebreak="case_id")
        .process(Dataset.from_pandas(rows))
        .to_pandas()
    )

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
    kept = TopNPerGroup(key="adviser", by="score", n=2).process(dataset).to_pandas()

    # adviser a: top-2 of {10,30,20} = c2(30), c3(20); adviser b: both (<n+... 2 rows)
    assert set(kept.loc[kept["adviser"] == "a", "case_id"]) == {"c2", "c3"}
    assert set(kept.loc[kept["adviser"] == "b", "case_id"]) == {"c4", "c5"}


def test_top_n_per_group_passes_a_group_smaller_than_n_through_whole():
    # A group with fewer than n rows is not an error — it passes through entire.
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_id": ["c1", "c2", "c3"],
                "adviser": ["a", "b", "b"],
                "score": [10, 20, 30],
            }
        )
    )
    kept = TopNPerGroup(key="adviser", by="score", n=5).process(dataset).to_pandas()

    assert set(kept["case_id"]) == {"c1", "c2", "c3"}


def test_top_n_per_group_empty_in_empty_out():
    empty = Dataset.from_pandas(
        pd.DataFrame({"case_id": [], "adviser": [], "score": []})
    )
    kept = TopNPerGroup(key="adviser", by="score", n=1).process(empty)

    assert len(kept) == 0


def test_top_n_per_group_supports_a_multi_column_key():
    # Group by Adviser x region — n=1 keeps the top Case per (adviser, region).
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
    kept = (
        TopNPerGroup(key=["adviser", "region"], by="score", n=1)
        .process(dataset)
        .to_pandas()
    )

    assert set(kept["case_id"]) == {"c2", "c3"}  # top of (a,n) and (a,s)


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
    kept = (
        TopNPerGroup(key="adviser", by="score", n=1, ascending=True)
        .process(dataset)
        .to_pandas()
    )

    assert list(kept["case_id"]) == ["c1"]  # lowest score


def test_top_n_per_group_returns_a_dataset_not_a_dataframe():
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_id": ["c1"], "adviser": ["a"], "score": [1]})
    )
    assert isinstance(
        TopNPerGroup(key="adviser", by="score", n=1).process(dataset), Dataset
    )


def test_sample_per_group_keeps_at_most_n_per_group():
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_id": ["c1", "c2", "c3", "c4", "c5"],
                "adviser": ["a", "a", "a", "b", "b"],
            }
        )
    )
    kept = SamplePerGroup(key="adviser", n=2, seed=7).process(dataset).to_pandas()

    counts = kept.groupby("adviser").size()
    assert counts["a"] == 2  # 3 -> sampled down to 2
    assert counts["b"] == 2  # exactly 2, all kept


def test_sample_per_group_is_reproducible_for_the_same_input_and_seed():
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_id": ["c1", "c2", "c3", "c4", "c5"],
                "adviser": ["a", "a", "a", "b", "b"],
            }
        )
    )
    first = SamplePerGroup(key="adviser", n=2, seed=7).process(dataset).to_pandas()
    second = SamplePerGroup(key="adviser", n=2, seed=7).process(dataset).to_pandas()

    assert list(first["case_id"]) == list(second["case_id"])


def test_sample_per_group_is_invariant_to_incoming_row_order():
    # Same set of Cases, two different row orders, same seed -> same sample
    # ("same set in => same sample out"), because each group is canonicalised
    # by `order` before the draw.
    rows = {
        "case_id": ["c1", "c2", "c3", "c4", "c5"],
        "adviser": ["a", "a", "a", "b", "b"],
    }
    forward = pd.DataFrame(rows)
    shuffled = forward.iloc[[4, 0, 2, 1, 3]].reset_index(drop=True)

    a = (
        SamplePerGroup(key="adviser", n=2, seed=7)
        .process(Dataset.from_pandas(forward))
        .to_pandas()
    )
    b = (
        SamplePerGroup(key="adviser", n=2, seed=7)
        .process(Dataset.from_pandas(shuffled))
        .to_pandas()
    )

    assert set(a["case_id"]) == set(b["case_id"])
    assert list(a["case_id"]) == list(b["case_id"])  # canonical output order too


def test_sample_per_group_passes_a_group_smaller_than_n_through_whole():
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_id": ["c1", "c2", "c3"],
                "adviser": ["a", "b", "b"],
            }
        )
    )
    kept = SamplePerGroup(key="adviser", n=5, seed=1).process(dataset).to_pandas()

    assert set(kept["case_id"]) == {"c1", "c2", "c3"}


def test_sample_per_group_empty_in_empty_out():
    empty = Dataset.from_pandas(pd.DataFrame({"case_id": [], "adviser": []}))

    assert len(SamplePerGroup(key="adviser", n=2, seed=1).process(empty)) == 0


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
    kept = (
        SamplePerGroup(key=["adviser", "region"], n=2, seed=3)
        .process(dataset)
        .to_pandas()
    )

    # Each (adviser, region) group of 3 sampled down to 2 independently.
    counts = kept.groupby(["adviser", "region"]).size()
    assert counts[("a", "n")] == 2
    assert counts[("a", "s")] == 2


def test_sample_per_group_different_seeds_can_draw_different_samples():
    # A large group makes a collision between two seeds vanishingly unlikely, so
    # the seed demonstrably governs the draw (it is not ignored).
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_id": [f"c{i}" for i in range(20)],
                "adviser": ["a"] * 20,
            }
        )
    )
    one = SamplePerGroup(key="adviser", n=5, seed=1).process(dataset).to_pandas()
    two = SamplePerGroup(key="adviser", n=5, seed=2).process(dataset).to_pandas()

    assert set(one["case_id"]) != set(two["case_id"])


def test_per_group_processors_conform_to_the_processor_protocol():
    # both are Processors, attachable via .with_processor.
    from framework.transform.processors import Processor

    assert isinstance(TopNPerGroup(key="adviser", by="score", n=1), Processor)
    assert isinstance(SamplePerGroup(key="adviser", n=1, seed=0), Processor)


# --- Parse -----------------------------------------------------------------


def test_parse_decodes_a_json_column_into_structured_values():
    # The default parser (json.loads) turns a packed JSON text column into the
    # dict/list values a downstream reshape can read.
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_ref": ["c1", "c2"],
                "payload": ['{"score": 10}', '[1, 2, 3]'],
            }
        )
    )

    result = Parse("payload").process(dataset).to_pandas()

    assert result.loc[0, "payload"] == {"score": 10}
    assert result.loc[1, "payload"] == [1, 2, 3]


def test_parse_applies_a_custom_parser_to_several_columns():
    dataset = Dataset.from_pandas(
        pd.DataFrame({"a": ["1", "2"], "b": ["3", "4"], "c": ["x", "y"]})
    )

    result = Parse(["a", "b"], parser=int).process(dataset).to_pandas()

    assert list(result["a"]) == [1, 2]
    assert list(result["b"]) == [3, 4]
    assert list(result["c"]) == ["x", "y"]  # untouched


def test_parse_raises_on_missing_column():
    dataset = Dataset.from_pandas(pd.DataFrame({"a": ["1"]}))

    with pytest.raises(ValueError, match="nope"):
        Parse(["a", "nope"]).process(dataset)


def test_parse_on_empty_feed_returns_empty_feed():
    dataset = Dataset.from_pandas(pd.DataFrame({"payload": pd.Series([], dtype=object)}))

    result = Parse("payload").process(dataset)

    assert isinstance(result, Dataset)
    assert len(result) == 0


# --- SplitColumn -----------------------------------------------------------


def test_split_column_fans_a_delimited_column_into_several():
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1"], "full_name": ["Ada,Lovelace"]})
    )

    result = (
        SplitColumn("full_name", ["first", "last"])
        .process(dataset)
        .to_pandas()
    )

    assert result.loc[0, "first"] == "Ada"
    assert result.loc[0, "last"] == "Lovelace"
    # source column dropped by default
    assert "full_name" not in result.columns


def test_split_column_keeps_trailing_delimiters_in_the_final_column():
    # More parts than destinations: the excess stays in the last column rather
    # than spilling into columns `into` never named.
    dataset = Dataset.from_pandas(pd.DataFrame({"path": ["a/b/c/d"]}))

    result = SplitColumn("path", ["head", "rest"], sep="/").process(dataset).to_pandas()

    assert result.loc[0, "head"] == "a"
    assert result.loc[0, "rest"] == "b/c/d"


def test_split_column_pads_missing_parts_with_none():
    dataset = Dataset.from_pandas(pd.DataFrame({"pair": ["only"]}))

    result = SplitColumn("pair", ["first", "second"]).process(dataset).to_pandas()

    assert result.loc[0, "first"] == "only"
    assert result.loc[0, "second"] is None


def test_split_column_can_overwrite_the_source_in_place():
    dataset = Dataset.from_pandas(pd.DataFrame({"v": ["a,b"]}))

    result = SplitColumn("v", ["v", "extra"]).process(dataset).to_pandas()

    assert result.loc[0, "v"] == "a"
    assert result.loc[0, "extra"] == "b"


def test_split_column_can_keep_the_source():
    dataset = Dataset.from_pandas(pd.DataFrame({"v": ["a,b"]}))

    result = SplitColumn("v", ["x", "y"], drop=False).process(dataset).to_pandas()

    assert "v" in result.columns


def test_split_column_raises_on_missing_column():
    dataset = Dataset.from_pandas(pd.DataFrame({"a": ["x"]}))

    with pytest.raises(ValueError, match="nope"):
        SplitColumn("nope", ["a", "b"]).process(dataset)


def test_split_column_on_empty_feed_returns_empty_with_destination_columns():
    dataset = Dataset.from_pandas(pd.DataFrame({"v": pd.Series([], dtype=object)}))

    result = SplitColumn("v", ["x", "y"]).process(dataset).to_pandas()

    assert len(result) == 0
    assert {"x", "y"}.issubset(result.columns)


# --- JoinColumns -----------------------------------------------------------


def test_join_columns_recombines_several_columns_into_one():
    dataset = Dataset.from_pandas(
        pd.DataFrame({"first": ["Ada"], "last": ["Lovelace"]})
    )

    result = (
        JoinColumns(["first", "last"], "full_name", sep=" ")
        .process(dataset)
        .to_pandas()
    )

    assert result.loc[0, "full_name"] == "Ada Lovelace"
    # sources kept by default
    assert {"first", "last"}.issubset(result.columns)


def test_join_columns_is_the_inverse_of_split_column():
    dataset = Dataset.from_pandas(pd.DataFrame({"full_name": ["Ada,Lovelace"]}))

    split = SplitColumn("full_name", ["first", "last"]).process(dataset)
    rejoined = JoinColumns(["first", "last"], "full_name").process(split).to_pandas()

    assert rejoined.loc[0, "full_name"] == "Ada,Lovelace"


def test_join_columns_stringifies_non_text_values():
    dataset = Dataset.from_pandas(pd.DataFrame({"a": [1], "b": [2]}))

    result = JoinColumns(["a", "b"], "key", sep="-").process(dataset).to_pandas()

    assert result.loc[0, "key"] == "1-2"


def test_join_columns_can_drop_the_sources():
    dataset = Dataset.from_pandas(pd.DataFrame({"a": ["x"], "b": ["y"], "c": ["z"]}))

    result = JoinColumns(["a", "b"], "key", drop=True).process(dataset).to_pandas()

    assert "a" not in result.columns
    assert "b" not in result.columns
    assert "c" in result.columns  # untouched
    assert result.loc[0, "key"] == "x,y"


def test_join_columns_raises_on_missing_column():
    dataset = Dataset.from_pandas(pd.DataFrame({"a": ["x"]}))

    with pytest.raises(ValueError, match="nope"):
        JoinColumns(["a", "nope"], "key").process(dataset)


def test_parse_split_join_conform_to_the_processor_protocol():
    from framework.transform.processors import Processor

    assert isinstance(Parse("a"), Processor)
    assert isinstance(SplitColumn("a", ["b", "c"]), Processor)
    assert isinstance(JoinColumns(["a", "b"], "c"), Processor)

```
