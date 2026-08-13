"""Integration tests for UpsertStrategy via Store.writer."""

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.core.protocols import RUN_PROVENANCE_COLUMN
from framework.io.strategy import UpsertStrategy
from framework.run.run_context import RunContext, active_context
from tools.store import Store


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


def test_upsert_gives_a_replaced_row_the_run_that_replaced_it(tmp_path):
    # An upsert is a real rewrite — the target row is deleted and the incoming
    # one inserted — so the last writer is the honest answer. A key the batch
    # does not carry is untouched, and keeps the run that wrote it.
    store = Store(tmp_path / "store.db")
    writer = store.writer("entities", UpsertStrategy("id"))
    with active_context(RunContext(pipeline_run_id="run-a")):
        writer.write(_ds({"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}))

    with active_context(RunContext(pipeline_run_id="run-b")):
        writer.write(_ds({"id": 2, "name": "Bobby"}))

    landed = store.reader("entities").read().to_pandas()
    assert dict(zip(landed["id"], landed[RUN_PROVENANCE_COLUMN])) == {
        1: "run-a",
        2: "run-b",
    }


def test_upsert_outside_a_run_context_still_writes(tmp_path):
    store = Store(tmp_path / "store.db")
    store.writer("entities", UpsertStrategy("id")).write(_ds({"id": 1, "name": "A"}))

    assert list(store.reader("entities").read().to_pandas()["id"]) == [1]
