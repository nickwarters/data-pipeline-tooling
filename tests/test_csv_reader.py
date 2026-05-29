from pathlib import Path

from framework.readers import CsvReader

FIXTURE = Path(__file__).parent / "fixtures" / "cases.csv"


def test_read_returns_datahandle_exposing_columns_and_row_count():
    handle = CsvReader(FIXTURE).read()

    # Behaviour is observed only through the DataHandle's public surface;
    # the test never touches pandas (ADR-0002 swappable engine seam).
    assert handle.columns == ["case_id", "advisor", "activity_date", "amount"]
    assert len(handle) == 3
