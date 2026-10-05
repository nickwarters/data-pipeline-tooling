"""Shared connection defaults and read-only path handling."""

import sqlite3
from pathlib import PureWindowsPath

import pytest

from framework._internal.connection import _read_only_uri, connect


def test_default_connection_still_creates_and_writes(tmp_path):
    path = tmp_path / "writable.db"
    con = connect(path, busy_timeout_ms=123)
    try:
        con.execute("CREATE TABLE sample (value TEXT)")
        con.execute("INSERT INTO sample VALUES ('saved')")
        con.commit()
        assert con.execute("PRAGMA busy_timeout").fetchone() == (123,)
        assert con.execute("PRAGMA journal_mode").fetchone() == ("delete",)
    finally:
        con.close()


def test_read_only_reads_encoded_native_path_but_rejects_writes(tmp_path):
    path = tmp_path / "données #100%.db"
    writable = connect(path)
    try:
        writable.execute("CREATE TABLE sample (value TEXT)")
        writable.execute("INSERT INTO sample VALUES ('saved')")
        writable.commit()
    finally:
        writable.close()
    con = connect(path, read_only=True, busy_timeout_ms=123)
    try:
        assert con.execute("SELECT value FROM sample").fetchall() == [("saved",)]
        assert con.execute("PRAGMA busy_timeout").fetchone() == (123,)
        with pytest.raises(sqlite3.OperationalError, match="readonly"):
            con.execute("INSERT INTO sample VALUES ('forbidden')")
    finally:
        con.close()


def test_read_only_cannot_create_a_missing_database(tmp_path):
    path = tmp_path / "absent.db"
    with pytest.raises(sqlite3.OperationalError, match="unable to open"):
        connect(path, read_only=True)
    assert not path.exists()


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        (
            PureWindowsPath("C:/data dir/données #100%.db"),
            "file:///C:/data%20dir/donn%C3%A9es%20%23100%25.db?mode=ro",
        ),
        (
            PureWindowsPath("//server/share/data dir/données #100%.db"),
            "file:////server/share/data%20dir/donn%C3%A9es%20%23100%25.db?mode=ro",
        ),
    ],
)
def test_windows_uri_spelling_preserves_encoding(path, expected):
    # Exercises Windows spelling on every OS, not native Windows/share access.
    assert _read_only_uri(path.as_uri()) == expected
