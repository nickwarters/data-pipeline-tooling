from pathlib import Path

import pandas as pd

from framework.io.readers import CsvReader

FIXTURE = Path(__file__).parent.parent.parent.parent / "fixtures" / "cases.csv"


def test_read_returns_dataset_exposing_columns_and_row_count():
    dataset = CsvReader(FIXTURE).read()

    # Behaviour is observed only through the Dataset's public surface;
    # the test never touches pandas.
    assert dataset.columns == ["case_id", "advisor", "activity_date", "amount"]
    assert len(dataset) == 3


def test_csv_reader_projects_only_requested_columns():
    # When columns=[...] is supplied only those columns should appear in the
    # returned Dataset; row count is unchanged.
    dataset = CsvReader(FIXTURE, columns=["case_id", "amount"]).read()

    assert dataset.columns == ["case_id", "amount"]
    assert len(dataset) == 3


def test_csv_reader_without_columns_reads_all_columns():
    # Omitting columns reads every column.
    dataset = CsvReader(FIXTURE).read()

    assert dataset.columns == ["case_id", "advisor", "activity_date", "amount"]


def test_csv_reader_reports_the_file_it_read():
    reader = CsvReader(FIXTURE)
    reader.read()

    assert reader.data_locations == [{"namespace": "file", "name": str(FIXTURE)}]


def test_csv_reader_lands_every_column_as_text(tmp_path):
    # Inference is a guess over the first rows and is lossy: a digits-only
    # reference would lose its leading zeros before anything downstream could
    # object. Text is what the file holds; the declared schema decides types.
    src = tmp_path / "feed.csv"
    src.write_text("case_ref,amount\n00123,1.50\n00124,2\n", encoding="utf-8")

    frame = CsvReader(src).read().to_pandas()

    assert frame["case_ref"].tolist() == ["00123", "00124"]
    assert frame["amount"].tolist() == ["1.50", "2"]


def test_csv_reader_lands_a_blank_field_as_a_gap_not_an_empty_string(tmp_path):
    # Whether a gap is allowed is NonNull()'s question; the reader must not
    # answer it by turning a blank into a value.
    src = tmp_path / "feed.csv"
    src.write_text("case_ref,amount\nC001,\n", encoding="utf-8")

    value = CsvReader(src).read().to_pandas()["amount"].iloc[0]

    assert value != ""
    assert pd.isna(value)


def test_csv_reader_still_reads_the_default_na_sentinels_as_gaps(tmp_path):
    # Landing text does not narrow the missing-value set: the pandas defaults
    # still decide which spellings of "absent" are gaps.
    src = tmp_path / "feed.csv"
    src.write_text("a,b,c\nNA,NULL,N/A\n", encoding="utf-8")

    frame = CsvReader(src).read().to_pandas()

    assert frame.iloc[0].isna().all()


def test_projection_still_lands_text(tmp_path):
    src = tmp_path / "feed.csv"
    src.write_text("case_ref,advisor,amount\n00123,Alice,7\n", encoding="utf-8")

    frame = CsvReader(src, columns=["case_ref", "amount"]).read().to_pandas()

    assert frame.columns.tolist() == ["case_ref", "amount"]
    assert frame.to_dict(orient="records") == [{"case_ref": "00123", "amount": "7"}]
