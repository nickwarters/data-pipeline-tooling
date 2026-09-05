```python
import io
import json
import sqlite3
from pathlib import Path

import pandas as pd
import pytest

from framework._internal.connection import connect
from framework.core.dataset import Dataset
from framework.core.protocols import RUN_PROVENANCE_COLUMN
from framework.io import writers as writers_module
from framework.io.readers import CsvReader, ExcelReader, SqliteReader
from framework.io.strategy import AccumulateByRun, InsertOrIgnore, Refresh
from framework.io.writers import (
    AccumulateByRunWriter,
    CsvWriter,
    ExcelWriter,
    JsonWriter,
    QuarantineWriter,
    SqliteInsertIfAbsentWriter,
    SqliteInsertOrIgnoreWriter,
    SqliteTruncateReloadWriter,
    SqliteUpsertWriter,
    StdoutWriter,
)
from framework.run.builder import Pipeline
from framework.run.run_context import RunContext, active_context

FIXTURE = Path(__file__).parent.parent.parent.parent / "fixtures" / "cases.csv"


def test_truncate_reload_writer_round_trips_a_dataset(tmp_path):
    # The Writer owns its target location (a layer db file + table); writing a
    # dataset and reading it back through the read-side dual returns the same
    # shape.
    dataset = CsvReader(FIXTURE).read()
    db = tmp_path / "raw.db"
    SqliteTruncateReloadWriter(db, "cases").write(dataset)

    landed = SqliteReader(db, "cases").read()
    assert landed.columns == dataset.columns
    assert len(landed) == len(dataset)


def test_truncate_reload_writer_replaces_rather_than_accumulates(tmp_path):
    # A current-state snapshot is full-refreshed each run: a second
    # write replaces the first rather than appending.
    dataset = CsvReader(FIXTURE).read()
    db = tmp_path / "raw.db"
    writer = SqliteTruncateReloadWriter(db, "cases")

    writer.write(dataset)
    writer.write(dataset)

    assert len(SqliteReader(db, "cases").read()) == len(dataset)


def test_connection_factory_sets_busy_timeout(tmp_path):
    # The single connection factory sets a busy_timeout so read-only
    # clients ride out the writer's in-place commits instead of erroring. Both
    # the Store and Writers open connections through here.
    con = connect(tmp_path / "raw.db", busy_timeout_ms=7000)
    try:
        (value,) = con.execute("PRAGMA busy_timeout").fetchone()
    finally:
        con.close()

    assert value == 7000


def test_csv_writer_round_trips_through_the_matching_reader(tmp_path):
    # File-form Deliverables are ordinary Writers: the pipeline hands over a
    # Dataset, the Writer owns the path and refresh strategy, and CSV is read
    # back through the matching Reader.
    source = CsvReader(FIXTURE).read()
    target = tmp_path / "deliverables" / "cases.csv"

    p = Pipeline("cases")
    r = p.read(CsvReader(FIXTURE), name="read")
    p.write(CsvWriter(target, Refresh()), r, name="write")
    landed = p.run()

    round_tripped = CsvReader(target).read()
    assert landed.columns == source.columns
    assert round_tripped.columns == source.columns
    assert len(round_tripped) == len(source)
    assert b"\r\n" not in target.read_bytes()


def test_excel_writer_round_trips_through_the_matching_reader(tmp_path):
    # Excel is another file-form Deliverable Writer; sheet selection remains
    # owned by the file adapter rather than the Pipeline builder.
    source = CsvReader(FIXTURE).read()
    target = tmp_path / "deliverables" / "cases.xlsx"

    p = Pipeline("cases")
    r = p.read(CsvReader(FIXTURE), name="read")
    p.write(ExcelWriter(target, Refresh(), sheet="cases"), r, name="write")
    p.run()

    round_tripped = ExcelReader(target, sheet="cases").read()
    assert round_tripped.columns == source.columns
    assert len(round_tripped) == len(source)


def test_json_writer_emits_file_deliverable_records(tmp_path):
    # The JSON deliverable contract is an array of records at the target path.
    source = CsvReader(FIXTURE).read()
    target = tmp_path / "deliverables" / "cases.json"

    p = Pipeline("cases")
    r = p.read(CsvReader(FIXTURE), name="read")
    p.write(JsonWriter(target, Refresh()), r, name="write")
    p.run()

    records = json.loads(target.read_text(encoding="utf-8"))
    assert len(records) == len(source)
    assert list(records[0]) == source.columns


def test_stdout_writer_prints_the_dataset_as_a_table():
    # A terminal sink for *seeing* a result: it prints every row of the dataset
    # to the stream rather than persisting it, with an optional caption.
    import io

    dataset = CsvReader(FIXTURE).read()
    buffer = io.StringIO()

    StdoutWriter("Explainer trace", stream=buffer).write(dataset)

    printed = buffer.getvalue()
    assert "Explainer trace" in printed
    for column in dataset.columns:
        assert column in printed
    # One line per caption + header + each data row.
    assert printed.count("\n") >= len(dataset) + 1


def test_stdout_writer_defaults_to_stdout_and_describes_itself(capsys):
    dataset = CsvReader(FIXTURE).read()

    writer = StdoutWriter()
    writer.write(dataset)

    assert capsys.readouterr().out.strip() != ""
    # No label: the plan summary is the bare class name (render omits None).
    assert writer.describe() == "StdoutWriter"
    assert StdoutWriter("trace").describe() == "StdoutWriter(label='trace')"


def test_file_writer_accumulate_by_run_replaces_only_that_run(tmp_path):
    # File Deliverables can also carry the accumulation strategy: re-driving the
    # same logical run replaces that run's rows while preserving other runs.
    dataset = CsvReader(FIXTURE).read()
    target = tmp_path / "deliverables" / "cases.csv"

    CsvWriter(target, AccumulateByRun("r1", "2026-05-29")).write(dataset)
    CsvWriter(target, AccumulateByRun("r2", "2026-05-30")).write(dataset)
    CsvWriter(target, AccumulateByRun("r1", "2026-05-29")).write(dataset)

    landed = CsvReader(target).read()
    assert len(landed) == 2 * len(dataset)
    assert "logical_run_id" in landed.columns
    assert "load_date" in landed.columns


def test_accumulate_by_run_writer_keeps_each_run(tmp_path):
    # Gold accumulates: each run's rows are retained and stamped logical_run_id /
    # load_date. Two distinct runs land both sets.
    dataset = CsvReader(FIXTURE).read()
    db = tmp_path / "gold.db"

    AccumulateByRunWriter(db, "selection_pool", "r1", "2026-05-29").write(dataset)
    AccumulateByRunWriter(db, "selection_pool", "r2", "2026-05-30").write(dataset)

    landed = SqliteReader(db, "selection_pool").read()
    assert len(landed) == 2 * len(dataset)
    assert "logical_run_id" in landed.columns
    assert "load_date" in landed.columns


def test_accumulate_by_run_writer_is_idempotent_per_run(tmp_path):
    # Re-driving the same run deletes its prior rows before inserting replacements.
    dataset = CsvReader(FIXTURE).read()
    db = tmp_path / "gold.db"
    writer = AccumulateByRunWriter(db, "selection_pool", "r1", "2026-05-29")

    writer.write(dataset)
    writer.write(dataset)

    assert len(SqliteReader(db, "selection_pool").read()) == len(dataset)


def test_csv_writer_insert_or_ignore_appends_to_existing_file(tmp_path):
    # Files carry no constraints, so InsertOrIgnore is equivalent to a plain
    # append — all incoming rows land regardless of any prior content.
    dataset = CsvReader(FIXTURE).read()
    target = tmp_path / "out.csv"

    CsvWriter(target, InsertOrIgnore()).write(dataset)
    CsvWriter(target, InsertOrIgnore()).write(dataset)

    landed = CsvReader(target).read()
    assert len(landed) == 2 * len(dataset)


def test_csv_writer_insert_or_ignore_on_empty_file_writes_normally(tmp_path):
    dataset = CsvReader(FIXTURE).read()
    target = tmp_path / "out.csv"

    CsvWriter(target, InsertOrIgnore()).write(dataset)

    landed = CsvReader(target).read()
    assert len(landed) == len(dataset)
    assert landed.columns == dataset.columns


def test_excel_writer_insert_or_ignore_appends_to_existing_sheet(tmp_path):
    dataset = CsvReader(FIXTURE).read()
    target = tmp_path / "out.xlsx"

    ExcelWriter(target, InsertOrIgnore()).write(dataset)
    ExcelWriter(target, InsertOrIgnore()).write(dataset)

    from framework.io.readers import ExcelReader

    landed = ExcelReader(target).read()
    assert len(landed) == 2 * len(dataset)


def test_json_writer_insert_or_ignore_appends_to_existing_file(tmp_path):
    dataset = CsvReader(FIXTURE).read()
    target = tmp_path / "out.json"

    JsonWriter(target, InsertOrIgnore()).write(dataset)
    JsonWriter(target, InsertOrIgnore()).write(dataset)

    records = json.loads(target.read_text(encoding="utf-8"))
    assert len(records) == 2 * len(dataset)


def test_accumulate_by_run_writer_is_atomic_when_the_write_fails(tmp_path):
    # The layer write is a single SQLite transaction: gold's
    # delete-by-run then insert is all-or-nothing. If the insert fails, the
    # delete must roll back so a re-driven run never half-wipes prior rows.
    db = tmp_path / "gold.db"
    good = Dataset.from_pandas(pd.DataFrame({"id": [1, 2]}))
    AccumulateByRunWriter(db, "selection_pool", "r1", "2026-05-29").write(good)

    # A frame with a surprise column the table lacks fails on append, after the
    # delete-by-run has already run within the same transaction.
    broken = Dataset.from_pandas(pd.DataFrame({"id": [1], "surprise": [9]}))
    with pytest.raises(Exception):
        AccumulateByRunWriter(db, "selection_pool", "r1", "2026-05-29").write(broken)

    survivors = SqliteReader(db, "selection_pool").read()
    assert len(survivors) == 2
    assert "surprise" not in survivors.columns


class _DeleteRefusingConnection(sqlite3.Connection):
    """Simulate a delete-by-run losing the database write-lock race."""

    def execute(self, sql, *parameters):  # type: ignore[override]
        if sql.lstrip().upper().startswith("DELETE"):
            raise sqlite3.OperationalError("database is locked")
        return super().execute(sql, *parameters)


def _connect_refusing_delete(db_path, busy_timeout_ms=5000):
    con = sqlite3.connect(db_path, factory=_DeleteRefusingConnection)
    con.execute(f"PRAGMA busy_timeout = {busy_timeout_ms}")
    return con


def test_accumulate_by_run_writer_fails_when_its_delete_is_locked_out(
    tmp_path, monkeypatch
):
    # A locked delete must fail the run. Absorbing it would turn "replace this
    # logical run's rows" into "append them again" — a silent duplicate.
    db = tmp_path / "gold.db"
    dataset = Dataset.from_pandas(pd.DataFrame({"id": [1, 2]}))
    writer = AccumulateByRunWriter(db, "selection_pool", "r1", "2026-05-29")
    writer.write(dataset)

    monkeypatch.setattr(writers_module, "connect", _connect_refusing_delete)
    with pytest.raises(sqlite3.OperationalError):
        writer.write(dataset)

    assert len(SqliteReader(db, "selection_pool").read()) == 2


def test_quarantine_writer_fails_when_its_delete_is_locked_out(tmp_path, monkeypatch):
    # The reject table's re-drive carries the same guarantee as gold's.
    db = tmp_path / "rejects.db"
    frame = pd.DataFrame({"case_ref": ["BAD"], "logical_run_id": ["r1"]})
    writer = QuarantineWriter(db, "rejects")
    writer.write(Dataset.from_pandas(frame))

    monkeypatch.setattr(writers_module, "connect", _connect_refusing_delete)
    with pytest.raises(sqlite3.OperationalError):
        writer.write(Dataset.from_pandas(frame))

    assert len(SqliteReader(db, "rejects").read()) == 1


def test_accumulate_by_run_writer_surfaces_a_locked_database(tmp_path):
    # The same guarantee against a really locked file rather than a stand-in.
    db = tmp_path / "gold.db"
    dataset = Dataset.from_pandas(pd.DataFrame({"id": [1, 2]}))
    writer = AccumulateByRunWriter(
        db, "selection_pool", "r1", "2026-05-29", busy_timeout_ms=50
    )
    writer.write(dataset)

    blocker = connect(db, 50)
    try:
        blocker.execute("BEGIN EXCLUSIVE")
        with pytest.raises(sqlite3.OperationalError):
            writer.write(dataset)
    finally:
        blocker.rollback()
        blocker.close()

    assert len(SqliteReader(db, "selection_pool").read()) == 2


def test_insert_if_absent_writer_surfaces_a_locked_database(tmp_path):
    # Reading the existing key->surrogate mapping is probed, not caught: a
    # locked database must not read as "no mapping yet" and remint surrogates.
    db = tmp_path / "ref.db"
    dataset = Dataset.from_pandas(pd.DataFrame({"value": ["A", "B"]}))
    writer = SqliteInsertIfAbsentWriter(db, "ref", ("value",), busy_timeout_ms=50)
    writer.write(dataset)

    blocker = connect(db, 50)
    try:
        blocker.execute("BEGIN EXCLUSIVE")
        with pytest.raises(sqlite3.OperationalError):
            writer.write(Dataset.from_pandas(pd.DataFrame({"value": ["C"]})))
    finally:
        blocker.rollback()
        blocker.close()

    landed = SqliteReader(db, "ref").read().to_pandas()
    assert sorted(landed["id"]) == [1, 2]


def _table_names(db_path) -> set[str]:
    con = connect(db_path, 5000)
    try:
        rows = con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        return {row[0] for row in rows}
    finally:
        con.close()


def test_merge_writers_leave_no_staging_table_behind(tmp_path):
    # Every merge writer stages under one convention and drops it after the
    # merge commits, whichever writer targeted the table.
    db = tmp_path / "silver.db"
    dataset = Dataset.from_pandas(pd.DataFrame({"id": [1], "name": ["Alice"]}))

    SqliteUpsertWriter(db, "entities", ("id",)).write(dataset)
    SqliteInsertOrIgnoreWriter(db, "entities").write(dataset)

    assert _table_names(db) == {"entities"}


def test_merge_sweeps_up_a_staging_table_stranded_by_an_older_build(tmp_path):
    # The staging names changed with this consolidation; a scratch table left by
    # a process killed mid-write under an older name is swept up rather than
    # stranded on the share forever.
    db = tmp_path / "silver.db"
    con = connect(db, 5000)
    try:
        con.execute('CREATE TABLE "_upsert_stage_entities" (id INTEGER)')
        con.execute('CREATE TABLE "_insert_or_ignore_stage_entities" (id INTEGER)')
        con.commit()
    finally:
        con.close()

    SqliteUpsertWriter(db, "entities", ("id",)).write(
        Dataset.from_pandas(pd.DataFrame({"id": [1]}))
    )

    assert _table_names(db) == {"entities"}


# --- what a Writer reports having touched -------------------------------------


def _table(db_path, table):
    return [{"namespace": f"sqlite:{db_path.as_posix()}", "name": table}]


def _one_row() -> Dataset:
    return Dataset.from_pandas(pd.DataFrame({"id": [1]}))


def test_the_file_writers_report_the_file_they_wrote(tmp_path):
    for writer_type, suffix in (
        (CsvWriter, "csv"),
        (ExcelWriter, "xlsx"),
        (JsonWriter, "json"),
    ):
        path = tmp_path / f"out.{suffix}"
        writer = writer_type(path, Refresh())
        writer.write(_one_row())

        assert writer.data_locations == [{"namespace": "file", "name": str(path)}]


def test_stdout_writer_reports_no_data_location(capsys):
    writer = StdoutWriter()
    writer.write(_one_row())

    # A display sink persists nothing, so it names nothing.
    assert not hasattr(writer, "data_locations")


def test_the_sqlite_writers_report_the_table_they_wrote(tmp_path):
    db = tmp_path / "raw.db"
    writers = [
        SqliteTruncateReloadWriter(db, "refreshed"),
        SqliteInsertOrIgnoreWriter(db, "appended"),
        SqliteUpsertWriter(db, "merged", ("id",)),
        AccumulateByRunWriter(db, "accumulated", "run-a", "2026-07-27"),
        QuarantineWriter(db, "rejects"),
    ]
    for writer in writers:
        writer.write(_one_row())

    assert [w.data_locations for w in writers] == [
        _table(db, "refreshed"),
        _table(db, "appended"),
        _table(db, "merged"),
        _table(db, "accumulated"),
        _table(db, "rejects"),
    ]


def test_insert_if_absent_reports_its_table_even_when_no_rows_are_new(tmp_path):
    db = tmp_path / "reference.db"
    writer = SqliteInsertIfAbsentWriter(db, "advisers", ("code",))
    writer.write(Dataset.from_pandas(pd.DataFrame({"code": ["a"]})))

    fresh = SqliteInsertIfAbsentWriter(db, "advisers", ("code",))
    fresh.write(Dataset.from_pandas(pd.DataFrame({"code": ["a"]})))

    assert writer.data_locations == _table(db, "advisers")
    assert fresh.data_locations == _table(db, "advisers")


# --- the reserved run-provenance column ------------------------------------
#
# Every table-backed Writer stamps the run that wrote the row. The value comes
# from the ambient run context, so these tests put one around the write rather than
# passing an id in — that *is* the contract.


def test_refresh_stamps_the_run_that_rebuilt_the_table(tmp_path):
    db = tmp_path / "gold.db"
    with active_context(RunContext(pipeline_run_id="run-a")):
        SqliteTruncateReloadWriter(db, "case_current").write(
            Dataset.from_pandas(pd.DataFrame({"case_id": ["c1", "c2"]}))
        )

    landed = SqliteReader(db, "case_current").read().to_pandas()
    # A replaced table is uniform: the run named on any row wrote all of them.
    assert list(landed[RUN_PROVENANCE_COLUMN]) == ["run-a", "run-a"]


def test_a_refresh_re_drive_keeps_the_data_and_moves_the_provenance(tmp_path):
    # The property that survives the stamp: a re-drive of the same window
    # produces identical *data*, and the column records which attempt produced
    # it. Byte-identity does not survive, and is not what is claimed any more.
    db = tmp_path / "gold.db"
    rows = Dataset.from_pandas(pd.DataFrame({"case_id": ["c1"], "count": [3]}))

    with active_context(RunContext(pipeline_run_id="run-a")):
        SqliteTruncateReloadWriter(db, "case_counts").write(rows)
    first = SqliteReader(db, "case_counts").read().to_pandas()

    with active_context(RunContext(pipeline_run_id="run-b")):
        SqliteTruncateReloadWriter(db, "case_counts").write(rows)
    second = SqliteReader(db, "case_counts").read().to_pandas()

    pd.testing.assert_frame_equal(
        first.drop(columns=[RUN_PROVENANCE_COLUMN]),
        second.drop(columns=[RUN_PROVENANCE_COLUMN]),
    )
    assert list(first[RUN_PROVENANCE_COLUMN]) == ["run-a"]
    assert list(second[RUN_PROVENANCE_COLUMN]) == ["run-b"]


def test_a_refresh_write_outside_any_run_context_still_works(tmp_path):
    # The framework is import-only and its components are usable from a script
    # or a test with no run around them; a provenance stamp must not become a
    # reason a write fails. No context, no id, no column — and no error.
    db = tmp_path / "raw.db"
    SqliteTruncateReloadWriter(db, "cases").write(
        Dataset.from_pandas(pd.DataFrame({"case_id": ["c1"]}))
    )

    landed = SqliteReader(db, "cases").read()
    assert landed.columns == ["case_id"]


def test_the_file_writers_deliver_exactly_the_columns_they_were_given(tmp_path):
    # The deliberate asymmetry, pinned. A table-backed Writer stamps the run
    # that wrote the row; the file Writers must not, because what they produce
    # leaves the system and its columns are a contract with whoever reads it.
    # Run *inside* a run context, so the absence is the rule rather than the
    # absence of an id.
    dataset = Dataset.from_pandas(pd.DataFrame({"case_id": ["c1"], "amount": [100]}))
    csv_path = tmp_path / "out.csv"
    excel_path = tmp_path / "out.xlsx"
    json_path = tmp_path / "out.json"
    console = io.StringIO()

    with active_context(RunContext(pipeline_run_id="run-a")):
        CsvWriter(csv_path, Refresh()).write(dataset)
        ExcelWriter(excel_path, Refresh()).write(dataset)
        JsonWriter(json_path, Refresh()).write(dataset)
        StdoutWriter(stream=console).write(dataset)

    assert csv_path.read_text(encoding="utf-8").splitlines()[0] == "case_id,amount"
    assert list(pd.read_excel(excel_path).columns) == ["case_id", "amount"]
    assert json.loads(json_path.read_text(encoding="utf-8")) == [
        {"case_id": "c1", "amount": 100}
    ]
    assert RUN_PROVENANCE_COLUMN not in console.getvalue()


def test_an_accumulating_row_carries_the_run_columns_from_exactly_one_stamper(tmp_path):
    # The reconciliation: `AccumulateByRun` owns `logical_run_id` / `load_date`
    # — the idempotency key it deletes by, and the business date — while the run
    # that wrote the row is the Writer's provenance stamp, read from the ambient
    # context rather than carried on the strategy.
    db = tmp_path / "gold.db"
    strategy = AccumulateByRun.from_context(
        RunContext(
            pipeline_run_id="run-a", logical_run_id="load-1", load_date="2026-05-29"
        )
    )
    assert not hasattr(strategy, "pipeline_run_id")

    with active_context(RunContext(pipeline_run_id="run-a")):
        strategy.writer_for(db, "selection_pool").write(
            Dataset.from_pandas(pd.DataFrame({"case_id": ["c1"]}))
        )

    [landed] = SqliteReader(db, "selection_pool").read().to_pandas().to_dict("records")
    assert landed == {
        "case_id": "c1",
        "logical_run_id": "load-1",
        "load_date": "2026-05-29",
        RUN_PROVENANCE_COLUMN: "run-a",
    }


def test_a_re_driven_logical_run_keeps_its_key_and_names_the_new_attempt(tmp_path):
    # A re-drive replaces the logical run's rows, so the rows that survive are
    # the ones the second attempt wrote — and they say so.
    db = tmp_path / "gold.db"
    rows = Dataset.from_pandas(pd.DataFrame({"case_id": ["c1"]}))

    for run_id in ("run-a", "run-b"):
        with active_context(RunContext(pipeline_run_id=run_id)):
            AccumulateByRunWriter(db, "selection_pool", "load-1", "2026-05-29").write(
                rows
            )

    landed = SqliteReader(db, "selection_pool").read().to_pandas()
    assert list(landed["logical_run_id"]) == ["load-1"]
    assert list(landed[RUN_PROVENANCE_COLUMN]) == ["run-b"]


def test_the_quarantine_writer_stamps_the_run_the_pipeline_no_longer_does(tmp_path):
    # The other reconciled stamper. The pipeline hands the rejects their
    # `logical_run_id` / `load_date`; the run that wrote them comes from the
    # Writer, on the same one path every other table uses.
    db = tmp_path / "silver.db"
    rejects = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_ref": ["BAD"],
                "logical_run_id": ["load-1"],
                "load_date": ["2026-05-29"],
            }
        )
    )

    with active_context(RunContext(pipeline_run_id="run-a")):
        QuarantineWriter(db, "rejects").write(rejects)

    [landed] = SqliteReader(db, "rejects").read().to_pandas().to_dict("records")
    assert landed[RUN_PROVENANCE_COLUMN] == "run-a"
    assert landed["logical_run_id"] == "load-1"

```
