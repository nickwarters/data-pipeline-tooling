"""Integration tests for UpsertStrategy via Store.writer."""

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.io.store import Store
from framework.io.strategy import UpsertStrategy


def _ds(*rows: dict) -> Dataset:
    return Dataset.from_pandas(pd.DataFrame(list(rows)))


def test_upsert_insert_only_into_empty_target(tmp_path):
    store = Store(tmp_path / "store.db")
    writer = store.writer("entities", UpsertStrategy("id"))
    writer.write(_ds({"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}))

    result = store.reader("entities").read().to_pandas()
    assert len(result) == 2
    assert set(result["id"]) == {1, 2}


def test_upsert_update_only_all_keys_already_present(tmp_path):
    store = Store(tmp_path / "store.db")
    writer = store.writer("entities", UpsertStrategy("id"))
    writer.write(_ds({"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}))
    writer.write(_ds({"id": 1, "name": "Alicia"}, {"id": 2, "name": "Bobby"}))

    result = store.reader("entities").read().to_pandas()
    assert len(result) == 2
    names = dict(zip(result["id"], result["name"]))
    assert names[1] == "Alicia"
    assert names[2] == "Bobby"


def test_upsert_mixed_insert_and_update(tmp_path):
    store = Store(tmp_path / "store.db")
    writer = store.writer("entities", UpsertStrategy("id"))
    writer.write(_ds({"id": 1, "name": "Alice"}))
    writer.write(_ds({"id": 1, "name": "Alicia"}, {"id": 2, "name": "Bob"}))

    result = store.reader("entities").read().to_pandas()
    assert len(result) == 2
    names = dict(zip(result["id"], result["name"]))
    assert names[1] == "Alicia"
    assert names[2] == "Bob"


def test_upsert_is_idempotent(tmp_path):
    store = Store(tmp_path / "store.db")
    writer = store.writer("entities", UpsertStrategy("id"))
    batch = _ds({"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"})
    writer.write(batch)
    writer.write(batch)

    result = store.reader("entities").read().to_pandas()
    assert len(result) == 2


def test_upsert_preserves_rows_not_in_incoming_batch(tmp_path):
    store = Store(tmp_path / "store.db")
    writer = store.writer("entities", UpsertStrategy("id"))
    writer.write(_ds({"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}))
    writer.write(_ds({"id": 2, "name": "Bobby"}))

    result = store.reader("entities").read().to_pandas()
    assert len(result) == 2
    names = dict(zip(result["id"], result["name"]))
    assert names[1] == "Alice"
    assert names[2] == "Bobby"


def test_upsert_rejects_missing_key_column(tmp_path):
    store = Store(tmp_path / "store.db")
    writer = store.writer("entities", UpsertStrategy("nonexistent_col"))
    with pytest.raises(ValueError, match="nonexistent_col"):
        writer.write(_ds({"id": 1, "name": "Alice"}))
