"""Integration tests for InsertOrIgnore via Store.writer."""

import sqlite3

import pandas as pd

from framework.core.dataset import Dataset
from framework.io.store import Store
from framework.io.strategy import InsertOrIgnore


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
