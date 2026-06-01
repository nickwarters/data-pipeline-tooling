"""Selection processors — filter/score/sort/rename + the lazy cross-feed join (#9).

These are the engine-confined transforms the Selection workload composes between
a feed's read and its post-validators (ADR-0002: all business logic in Python,
no business-rule SQL). ``Filter`` and ``Score`` carry **plain-Python row
callables** so the business rule never names the engine; ``JoinWith`` holds a
**lazy reference to another builder**, resolved to a DAG only at ``.run()``
(ADR-0003), so a pipeline can filter one feed and join another feed's silver/gold.
"""

import pandas as pd

from framework.builder import Pipeline
from framework.dataset import Dataset
from framework.processors import Filter, JoinWith, Rename, Score, Sort, Stamp
from framework.store import Store
from framework.strategy import Refresh


class RecordingBuilder:
    """A lazy builder stand-in: returns a dataset and counts how often it ran.

    Stands in for another feed's pipeline (`Pipeline.run() -> Dataset`) so a
    test can assert JoinWith holds an *unexecuted* reference (ADR-0003) without
    needing a real Store-backed pipeline.
    """

    def __init__(self, dataset: Dataset) -> None:
        self._dataset = dataset
        self.run_count = 0

    def run(self) -> Dataset:
        self.run_count += 1
        return self._dataset


def test_filter_keeps_only_rows_matching_the_predicate():
    # The predicate is a plain-Python callable over a row mapping (ADR-0002):
    # rows it returns True for survive, the rest are dropped.
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
    # Score derives a new column from each row via a plain-Python scorer; the
    # rest of the row is untouched. The scoring half of Selection (CONTEXT.md).
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1", "c2"], "amount": [100, 50]})
    )

    scored = (
        Score("priority", lambda row: row["amount"] * 2).process(dataset).to_pandas()
    )

    assert list(scored["priority"]) == [200, 100]
    assert list(scored["case_ref"]) == ["c1", "c2"]


def test_stamp_writes_a_constant_column_onto_every_row():
    # Stamp puts one constant value on every row — how Selection records the
    # applicable question_bank_id (CONTEXT.md) onto the selected Cases. Unlike
    # Score it carries no per-row rule, so it reads as the constant it is.
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1", "c2", "c3"]})
    )

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
    # The cross-feed join (ADR-0003): the processed feed gains the other feed's
    # columns matched on the shared key — e.g. a CasePool joined to the Adviser
    # hierarchy Reference Data. Joined in Python, not SQL (ADR-0002).
    cases = Dataset.from_pandas(
        pd.DataFrame({"adviser": ["a1", "a2"], "case_ref": ["c1", "c2"]})
    )
    advisers = RecordingBuilder(
        Dataset.from_pandas(
            pd.DataFrame({"adviser": ["a1", "a2"], "region": ["north", "south"]})
        )
    )

    joined = JoinWith(advisers, on="adviser").process(cases).to_pandas()

    assert list(joined["case_ref"]) == ["c1", "c2"]
    assert list(joined["region"]) == ["north", "south"]


def test_join_with_holds_an_unexecuted_reference_until_process():
    # ADR-0003: the referenced builder is lazy — constructing JoinWith runs
    # nothing; the other feed is materialised only when the join is processed.
    advisers = RecordingBuilder(
        Dataset.from_pandas(pd.DataFrame({"adviser": ["a1"], "region": ["north"]}))
    )

    join = JoinWith(advisers, on="adviser")
    assert advisers.run_count == 0

    join.process(Dataset.from_pandas(pd.DataFrame({"adviser": ["a1"]})))
    assert advisers.run_count == 1


def test_join_with_inner_default_drops_unmatched_rows():
    # The default inner join keeps only rows present in both feeds, so a case
    # with no matching reference row is dropped rather than carried with nulls.
    cases = Dataset.from_pandas(
        pd.DataFrame({"adviser": ["a1", "a2"], "case_ref": ["c1", "c2"]})
    )
    advisers = RecordingBuilder(
        Dataset.from_pandas(
            pd.DataFrame({"adviser": ["a1"], "region": ["north"]})
        )
    )

    joined = JoinWith(advisers, on="adviser").process(cases).to_pandas()

    assert list(joined["case_ref"]) == ["c1"]


def test_pipeline_filters_one_feed_and_joins_another_feeds_silver(tmp_path):
    # Acceptance (#9): end to end through the real builder — a Selection-shaped
    # pipeline reads one subject's silver, filters it in Python, and joins
    # another subject's silver Reference Data via a lazy JoinWith whose reference
    # is a read-only Pipeline over that other subject's medallion. The DAG is two
    # builders resolved at one .run() (ADR-0003), all joined in Python (ADR-0002).
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

    # The other feed is an unexecuted read-only builder (no writer) — the lazy
    # reference JoinWith resolves at run time.
    reference = Pipeline("advisers", advisers.reader("silver", "advisers"))
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


# ---------------------------------------------------------------------------
# DeriveKey — deterministic uuid5 processor (issue #35)
# ---------------------------------------------------------------------------

import uuid as _uuid

from framework.processors import DeriveKey

_NS = _uuid.UUID("12345678-1234-5678-1234-567812345678")


def test_derive_key_stamps_uuid5_for_a_single_column_key():
    # DeriveKey computes uuid5(namespace, key_string) per row and writes it into
    # the `into` column; the value must equal the uuid5 we'd compute by hand.
    dataset = Dataset.from_pandas(
        pd.DataFrame({"surname": ["SMITH"], "dob": ["2024-01-15"]})
    )

    result = DeriveKey(into="case_id", namespace=_NS, natural_key=["surname"]).process(dataset).to_pandas()

    expected = _uuid.uuid5(_NS, "SMITH")
    assert result["case_id"].iloc[0] == expected


def test_derive_key_is_deterministic_across_runs():
    # Re-running DeriveKey over identical input must produce identical case_ids —
    # the same natural-key values always map to the same UUID on every run and
    # every machine (determinism criterion).
    dataset = Dataset.from_pandas(
        pd.DataFrame({"ref": ["A", "B"]})
    )
    processor = DeriveKey(into="case_id", namespace=_NS, natural_key=["ref"])

    first = list(processor.process(dataset).to_pandas()["case_id"])
    second = list(processor.process(dataset).to_pandas()["case_id"])

    assert first == second


def test_derive_key_different_namespaces_yield_different_ids():
    # The same natural-key values under two different namespaces must produce
    # different case_ids — the namespace is the case-type discriminator.
    _NS2 = _uuid.UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    dataset = Dataset.from_pandas(pd.DataFrame({"ref": ["X"]}))

    id_ns1 = DeriveKey(into="case_id", namespace=_NS, natural_key=["ref"]).process(dataset).to_pandas()["case_id"].iloc[0]
    id_ns2 = DeriveKey(into="case_id", namespace=_NS2, natural_key=["ref"]).process(dataset).to_pandas()["case_id"].iloc[0]

    assert id_ns1 != id_ns2


def test_derive_key_multi_column_key_composes_in_declared_order():
    # Multi-column natural keys are composed as "col_a|col_b" in declared order;
    # the uuid5 result must equal hand-computing uuid5(NS, "SMITH|2024-01-15").
    dataset = Dataset.from_pandas(
        pd.DataFrame({"surname": ["SMITH"], "dob": ["2024-01-15"]})
    )

    result = DeriveKey(
        into="case_id", namespace=_NS, natural_key=["surname", "dob"]
    ).process(dataset).to_pandas()

    expected = _uuid.uuid5(_NS, "SMITH|2024-01-15")
    assert result["case_id"].iloc[0] == expected


def test_derive_key_multi_column_key_order_matters():
    # Column order in natural_key is significant: ["surname", "dob"] and
    # ["dob", "surname"] must produce different ids for the same row.
    dataset = Dataset.from_pandas(
        pd.DataFrame({"surname": ["SMITH"], "dob": ["2024-01-15"]})
    )

    id_ab = DeriveKey(into="case_id", namespace=_NS, natural_key=["surname", "dob"]).process(dataset).to_pandas()["case_id"].iloc[0]
    id_ba = DeriveKey(into="case_id", namespace=_NS, natural_key=["dob", "surname"]).process(dataset).to_pandas()["case_id"].iloc[0]

    assert id_ab != id_ba


def test_derive_key_returns_a_dataset_not_a_dataframe():
    # Engine-confined (ADR-0002): DeriveKey.process must return a Dataset, not
    # a pandas DataFrame — pandas stays behind the seam.
    dataset = Dataset.from_pandas(pd.DataFrame({"ref": ["A"]}))

    result = DeriveKey(into="case_id", namespace=_NS, natural_key=["ref"]).process(dataset)

    assert isinstance(result, Dataset)
