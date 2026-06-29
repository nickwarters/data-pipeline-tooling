```python
"""The in-memory row helpers (``tests.framework_testing.rows``).

Exercised the way a pipeline author would: build a feed from in-memory rows or a
CSV, run a real :class:`~framework.run.Pipeline`, and assert on the output rows
without wiring temp directories or SQLite by hand.
"""

import pytest

from framework.core import Dataset
from framework.run import Pipeline
from tests.framework_testing import (
    RecordingWriter,
    assert_rows_equal,
    given_csv,
    given_rows,
    read_rows,
    rows_of,
    without_columns,
)


def test_given_rows_through_pipeline_into_recording_writer():
    # given-source-rows / expect-output-rows with no temp dir or SQLite: feed
    # in-memory rows, run the real builder, read the captured output back.
    reader = given_rows([{"amount": 100}, {"amount": 50}, {"amount": 200}])
    writer = RecordingWriter()

    p = Pipeline("selection")
    read = p.read(reader, name="read")

    def filter_high_value(dataset: Dataset) -> Dataset:
        df = dataset.to_pandas()
        return Dataset(df[df["amount"] >= 100])

    filtered = p.transform(filter_high_value, read, name="filter")
    p.write(writer, filtered, name="write")
    p.run()

    assert rows_of(writer) == [{"amount": 100}, {"amount": 200}]


def test_given_csv_writes_a_csv_readable_by_csvreader(tmp_path):
    # The file-source counterpart to given_rows: a CSV the file readers can take.
    from framework.io import CsvReader

    path = given_csv(tmp_path, [{"case_id": "c1", "amount": 100}])

    assert path.exists()
    assert rows_of(CsvReader(path)) == [{"case_id": "c1", "amount": 100}]


def test_read_rows_reads_a_landed_table_back(tmp_path):
    # When a pipeline lands in a real Store, read_rows collapses the
    # store.reader(table).read().to_pandas() chain to a list of dicts.
    from framework.io import Refresh
    from tools.store import Store

    store = Store(tmp_path / "cases.db")
    p = Pipeline("cases")
    read = p.read(given_rows([{"case_id": "c1", "amount": 100}]), name="read")
    p.write(store.writer("cases", Refresh()), read, name="write")
    p.run()

    assert read_rows(store, "cases") == [{"case_id": "c1", "amount": 100}]


def test_without_columns_drops_named_columns_and_ignores_missing():
    rows = [{"id": 1, "run_id": "r", "load_date": "2026-01-01"}]

    assert without_columns(rows, "run_id", "load_date") == [{"id": 1}]
    # Missing names are tolerated, not an error.
    assert without_columns(rows, "nope") == rows


def test_assert_rows_equal_ignoring_stamp_columns_and_order():
    actual = [
        {"case_id": "c2", "amount": 200, "run_id": "abc"},
        {"case_id": "c1", "amount": 100, "run_id": "abc"},
    ]
    expected = [
        {"case_id": "c1", "amount": 100},
        {"case_id": "c2", "amount": 200},
    ]

    assert_rows_equal(actual, expected, ignoring=["run_id"], unordered=True)


def test_assert_rows_equal_unwraps_a_recording_writer_and_ignores_a_stamp():
    # assert_rows_equal accepts anything rows_of does; here a stamped write.
    writer = RecordingWriter()
    p = Pipeline("cases")
    read = p.read(given_rows([{"case_id": "c1", "amount": 100}]), name="read")

    def stamp(dataset: Dataset) -> Dataset:
        df = dataset.to_pandas()
        df["run_id"] = "run-123"
        return Dataset(df)

    stamped = p.transform(stamp, read, name="stamp")
    p.write(writer, stamped, name="write")
    p.run()

    assert_rows_equal(writer, [{"case_id": "c1", "amount": 100}], ignoring=["run_id"])


def test_assert_rows_equal_raises_on_a_real_mismatch():
    with pytest.raises(AssertionError):
        assert_rows_equal([{"amount": 1}], [{"amount": 2}])

```
