from pathlib import Path

from framework.readers import CsvReader

FIXTURE = Path(__file__).parent / "fixtures" / "cases.csv"


def test_read_returns_dataset_exposing_columns_and_row_count():
    dataset = CsvReader(FIXTURE).read()

    # Behaviour is observed only through the Dataset's public surface;
    # the test never touches pandas (ADR-0002 swappable engine seam).
    assert dataset.columns == ["case_id", "advisor", "activity_date", "amount"]
    assert len(dataset) == 3


def test_csv_reader_projects_only_requested_columns():
    # When columns=[...] is supplied only those columns should appear in the
    # returned Dataset; row count is unchanged.
    dataset = CsvReader(FIXTURE, columns=["case_id", "amount"]).read()

    assert dataset.columns == ["case_id", "amount"]
    assert len(dataset) == 3


def test_csv_reader_without_columns_reads_all_columns():
    # Omitting columns preserves read-everything behaviour (regression guard).
    dataset = CsvReader(FIXTURE).read()

    assert dataset.columns == ["case_id", "advisor", "activity_date", "amount"]
