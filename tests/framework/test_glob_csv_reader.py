import pytest

from framework.readers import GlobCsvReader


def test_glob_csv_reader_concatenates_matching_files_as_one_dataset(tmp_path):
    landing = tmp_path / "landing"
    landing.mkdir()
    (landing / "part_b.csv").write_text("case_id,advisor\n2,b\n", encoding="utf-8")
    (landing / "part_a.csv").write_text("case_id,advisor\n1,a\n", encoding="utf-8")

    dataset = GlobCsvReader(landing, "part_*.csv").read()

    assert dataset.columns == ["case_id", "advisor"]
    assert len(dataset) == 2
    assert dataset.to_pandas()["case_id"].tolist() == [1, 2]


def test_glob_csv_reader_raises_clear_error_when_no_files_match(tmp_path):
    landing = tmp_path / "landing"
    landing.mkdir()

    with pytest.raises(FileNotFoundError) as exc:
        GlobCsvReader(landing, "part_*.csv").read()

    message = str(exc.value)
    assert str(landing) in message
    assert "part_*.csv" in message


def test_glob_csv_reader_projects_only_requested_columns(tmp_path):
    landing = tmp_path / "landing"
    landing.mkdir()
    (landing / "part_a.csv").write_text(
        "case_id,advisor,amount\n1,a,10\n", encoding="utf-8"
    )
    (landing / "part_b.csv").write_text(
        "case_id,advisor,amount\n2,b,20\n", encoding="utf-8"
    )

    dataset = GlobCsvReader(landing, "part_*.csv", columns=["case_id", "amount"]).read()

    assert dataset.columns == ["case_id", "amount"]
    assert len(dataset) == 2
