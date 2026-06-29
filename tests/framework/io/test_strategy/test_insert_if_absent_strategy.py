"""Integration tests for InsertIfAbsent via Store.writer."""

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.io.strategy import InsertIfAbsent
from tools.store import Store


def _ds(*rows: dict) -> Dataset:
    return Dataset.from_pandas(pd.DataFrame(list(rows)))


def test_insert_if_absent_first_run_assigns_surrogates_from_one(tmp_path):
    store = Store(tmp_path / "store.db")
    writer = store.writer("ref", InsertIfAbsent("value"))
    writer.write(_ds({"value": "A"}, {"value": "B"}, {"value": "C"}))

    result = store.reader("ref").read().to_pandas()
    assert len(result) == 3
    assert set(result["id"]) == {1, 2, 3}
    assert set(result["value"]) == {"A", "B", "C"}


def test_insert_if_absent_rerun_is_idempotent(tmp_path):
    store = Store(tmp_path / "store.db")
    writer = store.writer("ref", InsertIfAbsent("value"))
    batch = _ds({"value": "A"}, {"value": "B"})
    writer.write(batch)
    writer.write(batch)  # same rows again — nothing should change

    result = store.reader("ref").read().to_pandas()
    assert len(result) == 2
    ids = dict(zip(result["value"], result["id"]))
    assert ids["A"] == 1
    assert ids["B"] == 2


def test_insert_if_absent_new_key_gets_next_id_existing_ids_stable(tmp_path):
    store = Store(tmp_path / "store.db")
    writer = store.writer("ref", InsertIfAbsent("value"))
    writer.write(_ds({"value": "A"}, {"value": "B"}))
    writer.write(_ds({"value": "A"}, {"value": "C"}))  # A exists, C is new

    result = store.reader("ref").read().to_pandas()
    assert len(result) == 3
    ids = dict(zip(result["value"], result["id"]))
    assert ids["A"] == 1  # original id preserved
    assert ids["B"] == 2  # original id preserved
    assert ids["C"] == 3  # new key gets next id


def test_insert_if_absent_deduplicates_keys_within_batch(tmp_path):
    store = Store(tmp_path / "store.db")
    writer = store.writer("ref", InsertIfAbsent("value"))
    # Batch contains "A" twice — only one row should be inserted.
    writer.write(_ds({"value": "A"}, {"value": "A"}, {"value": "B"}))

    result = store.reader("ref").read().to_pandas()
    assert len(result) == 2
    assert set(result["value"]) == {"A", "B"}


def test_insert_if_absent_composite_key(tmp_path):
    store = Store(tmp_path / "store.db")
    writer = store.writer("ref", InsertIfAbsent(("group", "value")))
    writer.write(
        _ds(
            {"group": "colour", "value": "red"},
            {"group": "colour", "value": "blue"},
            {"group": "size", "value": "small"},
        )
    )
    writer.write(
        _ds(
            {"group": "colour", "value": "red"},  # existing — skip
            {"group": "size", "value": "large"},  # new
        )
    )

    result = store.reader("ref").read().to_pandas()
    assert len(result) == 4
    ids = {(r["group"], r["value"]): r["id"] for _, r in result.iterrows()}
    assert ids[("colour", "red")] == 1
    assert ids[("colour", "blue")] == 2
    assert ids[("size", "small")] == 3
    assert ids[("size", "large")] == 4


def test_insert_if_absent_custom_surrogate_column(tmp_path):
    store = Store(tmp_path / "store.db")
    writer = store.writer("ref", InsertIfAbsent("value", surrogate_column="ref_id"))
    writer.write(_ds({"value": "X"}, {"value": "Y"}))

    result = store.reader("ref").read().to_pandas()
    assert "ref_id" in result.columns
    assert set(result["ref_id"]) == {1, 2}


def test_insert_if_absent_raises_on_missing_key_column(tmp_path):
    store = Store(tmp_path / "store.db")
    writer = store.writer("ref", InsertIfAbsent("missing_col"))
    with pytest.raises(ValueError, match="missing_col"):
        writer.write(_ds({"value": "A"}))


def test_insert_if_absent_empty_batch_is_a_noop(tmp_path):
    store = Store(tmp_path / "store.db")
    writer = store.writer("ref", InsertIfAbsent("value"))
    writer.write(_ds({"value": "A"}))
    writer.write(Dataset.from_pandas(pd.DataFrame(columns=["value"])))

    result = store.reader("ref").read().to_pandas()
    assert len(result) == 1
