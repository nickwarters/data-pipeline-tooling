from pathlib import Path

from framework.readers import CsvReader

FIXTURE = Path(__file__).parent / "fixtures" / "cases.csv"


def test_read_returns_dataset_exposing_columns_and_row_count():
    dataset = CsvReader(FIXTURE).read()

    # Behaviour is observed only through the Dataset's public surface;
    # the test never touches pandas (ADR-0002 swappable engine seam).
    assert dataset.columns == ["case_id", "advisor", "activity_date", "amount"]
    assert len(dataset) == 3
