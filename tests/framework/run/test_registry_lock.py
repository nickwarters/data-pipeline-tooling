"""A run that finds the run registry locked fails, and says how to record it."""

from __future__ import annotations

import shlex
import sqlite3

import pytest

from cli import operator
from framework.core import format_failure
from framework.run import RunRegistryLockedError, run_pipeline
from framework.run.runner import ingest_log_command
from tools.observability.run_registry import RunRegistry
from tools.observability.run_store import RunStore


@pytest.fixture(autouse=True)
def impatient_registry(monkeypatch):
    # The default busy timeout is five seconds; a lock test needn't wait it out.
    monkeypatch.setattr(
        RunStore, "registry", lambda self: RunRegistry(self.registry_path, 50)
    )


class Lock:
    """Another process holding the registry, as a second pipeline run would."""

    def __init__(self, db_path) -> None:
        self._con = sqlite3.connect(db_path, isolation_level=None)

    def take(self) -> None:
        self._con.execute("BEGIN EXCLUSIVE")

    def release(self) -> None:
        self._con.execute("ROLLBACK")
        self._con.close()


def _prime(base_dir) -> None:
    """One earlier run, so the registry and a run log exist."""
    run_pipeline(lambda context: None, "other", base_dir)


def _registry_steps(base_dir, name):
    return [
        (r["step"], r["status"])
        for r in RunStore(base_dir).registry().query_runs(pipeline=name)
    ]


def test_a_finished_run_that_cannot_be_recorded_prints_the_command_that_records_it(
    tmp_path,
):
    _prime(tmp_path)
    lock = Lock(RunStore(tmp_path).registry_path)

    def handler(context):
        lock.take()  # another run takes the registry while this one works

    with pytest.raises(RunRegistryLockedError) as raised:
        run_pipeline(handler, "orders", tmp_path)

    error = raised.value
    message = str(error)
    assert "pipeline 'orders' finished, but the run could not be recorded" in message
    assert "is locked by another process" in message
    assert "nothing needs re-running" in message
    assert error.command in message
    assert error.category == "operational"
    assert isinstance(error.__cause__, sqlite3.OperationalError)
    lock.release()
    # The run log already has the whole run; only the registry is behind.
    assert _registry_steps(tmp_path, "orders") == []

    args = shlex.split(error.command)
    assert args[:4] == ["python", "-m", "cli", "ingest-log"]
    assert operator.main(args[3:]) == 0

    assert ("run", "ok") in _registry_steps(tmp_path, "orders")


def test_a_failed_run_keeps_its_own_error_and_gains_the_command_as_a_note(tmp_path):
    _prime(tmp_path)
    lock = Lock(RunStore(tmp_path).registry_path)

    def handler(context):
        lock.take()
        raise ValueError("the pipeline's own failure")

    with pytest.raises(ValueError, match="the pipeline's own failure") as raised:
        run_pipeline(handler, "orders", tmp_path)
    lock.release()

    (note,) = raised.value.__notes__
    assert "pipeline 'orders' failed, but the run could not be recorded" in note
    assert "python -m cli ingest-log orders --base-dir" in note
    # A run boundary that formats the failure shows the note too.
    assert "python -m cli ingest-log orders" in format_failure(raised.value)


def test_a_registry_locked_before_the_run_starts_runs_nothing(tmp_path):
    _prime(tmp_path)
    lock = Lock(RunStore(tmp_path).registry_path)
    lock.take()
    ran = []

    try:
        with pytest.raises(RunRegistryLockedError, match="did not start") as raised:
            run_pipeline(ran.append, "orders", tmp_path)
    finally:
        lock.release()

    assert ran == []
    assert raised.value.command is None
    assert "Run the pipeline again" in str(raised.value)


def test_a_registry_failure_that_is_not_a_lock_propagates_untouched(
    tmp_path, monkeypatch
):
    def broken(self, log_path):
        raise sqlite3.OperationalError("disk I/O error")

    monkeypatch.setattr(RunRegistry, "ingest", broken)
    (tmp_path / "_runs").mkdir()
    (tmp_path / "_runs" / "x.log").write_text("")

    with pytest.raises(sqlite3.OperationalError, match="disk I/O error"):
        run_pipeline(lambda context: None, "orders", tmp_path)


# --- the command itself ------------------------------------------------------


def test_the_command_names_a_default_log_by_its_subject(tmp_path):
    log = RunStore(tmp_path).log_path_for("cases")
    command = ingest_log_command(tmp_path, log, log)
    assert shlex.split(command) == [
        "python", "-m", "cli", "ingest-log", "cases", "--base-dir", str(tmp_path),
    ]  # fmt: skip


def test_the_command_names_a_redirected_log_by_path_and_quotes_it(tmp_path):
    log = tmp_path / "elsewhere with space" / "cases.log"
    default = RunStore(tmp_path).log_path_for("cases")
    command = ingest_log_command(tmp_path, log, default)
    assert shlex.split(command)[4:6] == ["--log-file", str(log)]


def test_ingest_log_with_no_subject_records_every_log(tmp_path, capsys):
    run_pipeline(lambda context: None, "a", tmp_path)
    run_pipeline(lambda context: None, "b", tmp_path)

    assert operator.main(["ingest-log", "--base-dir", str(tmp_path)]) == 0
    out = capsys.readouterr().out
    assert "a.log: recorded 0 new record(s)" in out
    assert "b.log: recorded 0 new record(s)" in out


def test_ingest_log_reports_a_missing_log(tmp_path, capsys):
    assert operator.main(["ingest-log", "nope", "--base-dir", str(tmp_path)]) == 1
    assert "no run log at" in capsys.readouterr().err


def test_ingest_log_says_so_when_the_registry_is_still_locked(tmp_path, capsys):
    _prime(tmp_path)
    lock = Lock(RunStore(tmp_path).registry_path)
    (tmp_path / "_runs" / "late.log").write_text(
        (tmp_path / "_runs" / "other.log").read_text()
    )
    lock.take()
    try:
        code = operator.main(["ingest-log", "late", "--base-dir", str(tmp_path)])
    finally:
        lock.release()
    assert code == 1
    assert "still locked" in capsys.readouterr().err
