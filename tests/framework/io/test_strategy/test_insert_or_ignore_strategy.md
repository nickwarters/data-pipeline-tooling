```python
"""Integration tests for InsertOrIgnore via Store.writer."""

import sqlite3

import pandas as pd

from framework.core.dataset import Dataset
from framework.core.protocols import RUN_PROVENANCE_COLUMN
from framework.io.strategy import InsertOrIgnore
from framework.run.run_context import RunContext, active_context
from tools.store import Store


def _ds(*rows: dict) -> Dataset:
    return Dataset.from_pandas(pd.DataFrame(list(rows)))


def test_insert_or_ignore_inserts_into_empty_table(tmp_path):
    store = Store(tmp_path / "store.db")
    writer = store.writer("things", InsertOrIgnore())
    writer.write(_ds({"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}))

    result = store.reader("things").read().to_pandas()
    assert len(result) == 2
    assert set(result["id"]) == {1, 2}


def test_insert_or_ignore_appends_when_no_constraints(tmp_path):
    store = Store(tmp_path / "store.db")
    writer = store.writer("things", InsertOrIgnore())
    writer.write(_ds({"id": 1, "name": "Alice"}))
    writer.write(_ds({"id": 2, "name": "Bob"}))

    result = store.reader("things").read().to_pandas()
    assert len(result) == 2


def test_insert_or_ignore_skips_rows_violating_unique_constraint(tmp_path):
    db_path = tmp_path / "gold.db"
    con = sqlite3.connect(db_path)
    try:
        con.execute("CREATE TABLE things (id INTEGER UNIQUE, name TEXT)")
        con.execute("INSERT INTO things VALUES (1, 'Alice')")
        con.commit()
    finally:
        con.close()

    store = Store(db_path)
    writer = store.writer("things", InsertOrIgnore())
    writer.write(_ds({"id": 1, "name": "Alice Updated"}, {"id": 2, "name": "Bob"}))

    result = store.reader("things").read().to_pandas()
    assert len(result) == 2
    names = dict(zip(result["id"], result["name"]))
    assert names[1] == "Alice"  # original preserved — conflict ignored
    assert names[2] == "Bob"  # new row inserted


def test_insert_or_ignore_is_idempotent_with_unique_constraint(tmp_path):
    db_path = tmp_path / "gold.db"
    con = sqlite3.connect(db_path)
    try:
        con.execute("CREATE TABLE things (id INTEGER UNIQUE, name TEXT)")
        con.commit()
    finally:
        con.close()

    store = Store(db_path)
    writer = store.writer("things", InsertOrIgnore())
    batch = _ds({"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"})
    writer.write(batch)
    writer.write(batch)  # same rows again — all conflict, nothing changes

    result = store.reader("things").read().to_pandas()
    assert len(result) == 2


def test_insert_or_ignore_preserves_rows_not_in_incoming_batch(tmp_path):
    db_path = tmp_path / "gold.db"
    con = sqlite3.connect(db_path)
    try:
        con.execute("CREATE TABLE things (id INTEGER UNIQUE, name TEXT)")
        con.commit()
    finally:
        con.close()

    store = Store(db_path)
    writer = store.writer("things", InsertOrIgnore())
    writer.write(_ds({"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}))
    writer.write(_ds({"id": 3, "name": "Carol"}))  # only a new row

    result = store.reader("things").read().to_pandas()
    assert len(result) == 3
    assert set(result["id"]) == {1, 2, 3}


def test_an_ignored_row_keeps_the_run_that_first_inserted_it(tmp_path):
    # An ignored row is not written, so the row already there is not restamped:
    # the same "first landed" reading an append-only target has. The target's
    # own PRIMARY KEY is what does the ignoring, and the extra column takes no
    # part in it.
    db = tmp_path / "store.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE things (id INTEGER PRIMARY KEY, name TEXT)")
    con.commit()
    con.close()

    store = Store(db)
    writer = store.writer("things", InsertOrIgnore())
    with active_context(RunContext(pipeline_run_id="run-a")):
        writer.write(_ds({"id": 1, "name": "Alice"}))

    with active_context(RunContext(pipeline_run_id="run-b")):
        writer.write(_ds({"id": 1, "name": "Alicia"}, {"id": 2, "name": "Bob"}))

    landed = store.reader("things").read().to_pandas()
    assert dict(zip(landed["id"], landed["name"])) == {1: "Alice", 2: "Bob"}
    assert dict(zip(landed["id"], landed[RUN_PROVENANCE_COLUMN])) == {
        1: "run-a",
        2: "run-b",
    }


def test_insert_or_ignore_outside_a_run_context_still_writes(tmp_path):
    store = Store(tmp_path / "store.db")
    store.writer("things", InsertOrIgnore()).write(_ds({"id": 1, "name": "A"}))

    assert list(store.reader("things").read().to_pandas()["id"]) == [1]

```
