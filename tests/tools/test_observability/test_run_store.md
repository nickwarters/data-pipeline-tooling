```python
"""The run-metadata layout of a base directory.

``RunStore`` is the single owner of where a base directory's *run metadata*
lands — the counterpart of ``StoreRegistry``, which owns where the *data* lands.
These tests pin the actual path fragments, because the layout is a live on-disk
convention: existing bases already have ``_runs/`` and ``_registry/runs.db`` in
them, and centralising the knowledge must not move a single file.
"""

from pathlib import Path

from tools.observability.run_log import RunLog
from tools.observability.run_registry import RunRegistry
from tools.observability.run_store import RunStore


def test_the_layout_is_the_one_already_on_disk(tmp_path):
    store = RunStore(tmp_path)
    assert store.runs_dir == tmp_path / "_runs"
    assert store.registry_path == tmp_path / "_registry" / "runs.db"
    assert store.orchestration_path == tmp_path / "_orchestration" / "runs.db"


def test_paths_are_relative_fragments_not_hardcoded_separators(tmp_path):
    store = RunStore(tmp_path)
    assert store.registry_path.relative_to(tmp_path).parts == ("_registry", "runs.db")
    assert store.runs_dir.relative_to(tmp_path).parts == ("_runs",)
    assert store.orchestration_path.relative_to(tmp_path).parts == (
        "_orchestration",
        "runs.db",
    )


def test_a_subject_log_lands_in_the_runs_directory(tmp_path):
    store = RunStore(tmp_path)
    assert store.log_path_for("cases") == tmp_path / "_runs" / "cases.log"
    log = store.log_for("cases")
    assert isinstance(log, RunLog)
    assert log.path == store.log_path_for("cases")


def test_a_string_base_dir_is_accepted(tmp_path):
    assert RunStore(str(tmp_path)).base_dir == Path(tmp_path)


def test_registry_opens_at_the_declared_path(tmp_path):
    registry = RunStore(tmp_path).registry()
    assert isinstance(registry, RunRegistry)
    registry.query_runs()  # opening it creates the file
    assert (tmp_path / "_registry" / "runs.db").exists()


def test_catch_up_ingests_every_run_log_under_the_base(tmp_path):
    store = RunStore(tmp_path)
    store.log_for("cases").record("r1", "cases/ingest", "run", "ok", rows_out=1)
    store.log_for("orders").record("r2", "orders/ingest", "run", "ok", rows_out=2)

    registry = store.catch_up()

    assert {r["pipeline"] for r in registry.query_runs()} == {
        "cases/ingest",
        "orders/ingest",
    }


def test_catch_up_on_an_empty_base_is_a_no_op(tmp_path):
    assert RunStore(tmp_path).catch_up().query_runs() == []


def test_catch_up_is_repeatable_without_double_counting(tmp_path):
    store = RunStore(tmp_path)
    store.log_for("cases").record("r1", "cases/ingest", "run", "ok", rows_out=1)

    store.catch_up()
    registry = store.catch_up()

    assert len(registry.query_runs()) == 1

```
