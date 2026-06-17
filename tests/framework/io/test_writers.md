```python
import json
from pathlib import Path

import pandas as pd
import pytest

from framework._internal.connection import connect
from framework.core.dataset import Dataset
from framework.io.readers import CsvReader, ExcelReader, SqliteReader
from framework.io.strategy import AccumulateByRun, Refresh
from framework.io.writers import (
    AccumulateByRunWriter,
    CsvWriter,
    ExcelWriter,
    JsonWriter,
    SqliteTruncateReloadWriter,
    StdoutWriter,
)
from framework.run.builder import Pipeline

FIXTURE = Path(__file__).parent.parent.parent / "fixtures" / "cases.csv"


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

    landed = (
        Pipeline("cases", CsvReader(FIXTURE))
        .write_to(CsvWriter(target, Refresh()))
        .run()
    )

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

    Pipeline("cases", CsvReader(FIXTURE)).write_to(
        ExcelWriter(target, Refresh(), sheet="cases")
    ).run()

    round_tripped = ExcelReader(target, sheet="cases").read()
    assert round_tripped.columns == source.columns
    assert len(round_tripped) == len(source)


def test_json_writer_emits_file_deliverable_records(tmp_path):
    # JSON currently has a Writer but no matching Reader; the observable
    # Deliverable contract is a JSON array of record objects at the target path.
    source = CsvReader(FIXTURE).read()
    target = tmp_path / "deliverables" / "cases.json"

    Pipeline("cases", CsvReader(FIXTURE)).write_to(JsonWriter(target, Refresh())).run()

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
    assert "run_id" in landed.columns
    assert "load_date" in landed.columns


def test_accumulate_by_run_writer_keeps_each_run(tmp_path):
    # Gold accumulates: each run's rows are retained and stamped run_id /
    # load_date. Two distinct runs land both sets.
    dataset = CsvReader(FIXTURE).read()
    db = tmp_path / "gold.db"

    AccumulateByRunWriter(db, "selection_pool", "r1", "2026-05-29").write(dataset)
    AccumulateByRunWriter(db, "selection_pool", "r2", "2026-05-30").write(dataset)

    landed = SqliteReader(db, "selection_pool").read()
    assert len(landed) == 2 * len(dataset)
    assert "run_id" in landed.columns
    assert "load_date" in landed.columns


def test_accumulate_by_run_writer_is_idempotent_per_run(tmp_path):
    # Re-driving the same run replaces only that run's rows (delete-by-run then
    # insert — ), so a re-run does not duplicate.
    dataset = CsvReader(FIXTURE).read()
    db = tmp_path / "gold.db"
    writer = AccumulateByRunWriter(db, "selection_pool", "r1", "2026-05-29")

    writer.write(dataset)
    writer.write(dataset)

    assert len(SqliteReader(db, "selection_pool").read()) == len(dataset)


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

```
