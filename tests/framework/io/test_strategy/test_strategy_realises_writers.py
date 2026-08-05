"""A load strategy realises its own Writer — nothing else branches on it.

These tests pin the mechanism rather than any single strategy's semantics (those
live in the sibling modules): the store asks the strategy for a Writer, the file
writers ask the strategy for the frame to write, and a strategy nobody has heard
of works anyway because there is nothing left to teach.
"""

import ast
from pathlib import Path

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.io import (
    AccumulateByRun,
    AccumulateByRunWriter,
    AppendOnly,
    CsvWriter,
    InsertIfAbsent,
    InsertOrIgnore,
    Refresh,
    SqliteAppendOnlyWriter,
    SqliteInsertIfAbsentWriter,
    SqliteInsertOrIgnoreWriter,
    SqliteTruncateReloadWriter,
    SqliteUpsertWriter,
    UpsertStrategy,
)
from tools.store import Store

IO_DIR = Path(__file__).parents[4] / "framework" / "io"

STRATEGIES = {
    "refresh": (Refresh(), SqliteTruncateReloadWriter),
    "accumulate": (
        AccumulateByRun(logical_run_id="r1", load_date="2026-01-01"),
        AccumulateByRunWriter,
    ),
    "upsert": (UpsertStrategy("case_id"), SqliteUpsertWriter),
    "insert_or_ignore": (InsertOrIgnore(), SqliteInsertOrIgnoreWriter),
    "insert_if_absent": (InsertIfAbsent("case_id"), SqliteInsertIfAbsentWriter),
    "append_only": (AppendOnly("case_id"), SqliteAppendOnlyWriter),
}


def _dataset():
    return Dataset.from_pandas(pd.DataFrame({"case_id": ["c1", "c2"]}))


@pytest.mark.parametrize("name", sorted(STRATEGIES))
def test_each_strategy_mints_the_writer_that_implements_it(tmp_path, name):
    # The store resolves the location only; which Writer implements the load is
    # the strategy's own knowledge, so this mapping lives in one place.
    strategy, expected = STRATEGIES[name]
    writer = Store(tmp_path / "cases.db").writer("cases", strategy)
    assert isinstance(writer, expected)


@pytest.mark.parametrize("name", sorted(STRATEGIES))
def test_busy_timeout_reaches_every_sqlite_writer_a_strategy_mints(
    tmp_path, monkeypatch, name
):
    # The contention timeout is the store's to set (a network share cannot use
    # WAL), so re-plumbing the constructors must never drop it on the way
    # through. Assert it at the connection, where it actually matters.
    from framework.io import writers as writers_module

    real_connect = writers_module.connect
    seen = []

    def recording_connect(db_path, busy_timeout_ms):
        seen.append(busy_timeout_ms)
        return real_connect(db_path, busy_timeout_ms)

    monkeypatch.setattr(writers_module, "connect", recording_connect)

    strategy, _ = STRATEGIES[name]
    store = Store(tmp_path / "cases.db", busy_timeout_ms=7777)
    store.writer("cases", strategy).write(_dataset())

    assert seen and set(seen) == {7777}


class _RecordingWriter:
    """A throwaway Writer standing in for whatever a new strategy would need."""

    def __init__(self, db_path, table, busy_timeout_ms):
        self.db_path = db_path
        self.table = table
        self.busy_timeout_ms = busy_timeout_ms
        self.written = []

    def write(self, dataset):
        self.written.append(dataset.to_pandas())


class _MarkRows:
    """A strategy beyond the shipped set, defined here — the blast-radius proof.

    It is unknown to the store, to the writers module, and to the facade, and
    yet it loads through both seams. Adding a real strategy is the same shape
    of work: one class, one export line.
    """

    def __init__(self, mark):
        self.mark = mark

    def writer_for(self, db_path, table, *, busy_timeout_ms=5000):
        return _RecordingWriter(db_path, table, busy_timeout_ms)

    def apply_to_frame(self, frame, read_existing):
        frame["mark"] = self.mark
        return frame


def test_a_strategy_the_store_has_never_heard_of_just_works(tmp_path):
    # No TypeError for an "unknown" strategy: satisfying the protocol is the
    # whole requirement, and the store's own arguments still flow through.
    store = Store(tmp_path / "cases.db", busy_timeout_ms=1234)
    writer = store.writer("cases", _MarkRows("x"))

    writer.write(_dataset())

    assert writer.table == "cases"
    assert writer.busy_timeout_ms == 1234
    assert list(writer.written[0]["case_id"]) == ["c1", "c2"]


def test_a_new_strategy_also_drives_the_file_writers(tmp_path):
    target = tmp_path / "out.csv"
    CsvWriter(target, _MarkRows("seen")).write(_dataset())

    assert list(pd.read_csv(target)["mark"]) == ["seen", "seen"]


@pytest.mark.parametrize(
    "strategy",
    [UpsertStrategy("case_id"), InsertIfAbsent("case_id"), AppendOnly("case_id")],
)
def test_a_file_writer_names_the_strategy_it_cannot_realise(tmp_path, strategy):
    # A key-driven load has no whole-file rewrite, so those strategies define no
    # apply_to_frame. The mismatch must name both sides rather than fall off the
    # end of a chain of branches.
    writer = CsvWriter(tmp_path / "out.csv", strategy)

    with pytest.raises(TypeError) as excinfo:
        writer.write(_dataset())

    message = str(excinfo.value)
    assert "CsvWriter" in message
    assert type(strategy).__name__ in message


def test_framework_io_never_imports_the_application_tools_package():
    # Strategies mint writers from a db path, never from a Store: framework.io
    # must not reach up into application infrastructure to do it.
    offenders = []
    for path in sorted(IO_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                names = [node.module]
            elif isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            for name in names:
                if name == "tools" or name.startswith("tools."):
                    offenders.append(f"{path.name}:{node.lineno} imports {name}")

    assert offenders == []
