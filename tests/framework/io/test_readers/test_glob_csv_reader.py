import pytest

from framework.io.readers import GlobCsvReader


def test_glob_csv_reader_concatenates_matching_files_as_one_dataset(tmp_path):
    landing = tmp_path / "landing"
    landing.mkdir()
    (landing / "part_b.csv").write_text("case_id,advisor\n2,b\n", encoding="utf-8")
    (landing / "part_a.csv").write_text("case_id,advisor\n1,a\n", encoding="utf-8")

    dataset = GlobCsvReader(landing, "part_*.csv").read()

    assert dataset.columns == ["case_id", "advisor"]
    assert len(dataset) == 2
    assert dataset.to_pandas()["case_id"].tolist() == ["1", "2"]


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


def test_glob_csv_reader_reports_every_file_it_read(tmp_path):
    landing = tmp_path / "landing"
    landing.mkdir()
    for part in ("a", "b", "c"):
        (landing / f"part_{part}.csv").write_text(
            "case_id,advisor\n1,x\n", encoding="utf-8"
        )

    reader = GlobCsvReader(landing, "part_*.csv")
    reader.read()

    assert reader.data_locations == [
        {"namespace": "file", "name": str(landing / f"part_{part}.csv")}
        for part in ("a", "b", "c")
    ]


def test_a_glob_that_matches_nothing_reports_no_data_location(tmp_path):
    landing = tmp_path / "landing"
    landing.mkdir()
    reader = GlobCsvReader(landing, "part_*.csv")

    with pytest.raises(FileNotFoundError):
        reader.read()

    assert reader.data_locations == []


def test_parts_agree_on_dtype_however_each_would_infer(tmp_path):
    # Independently inferred, part_a's case_id would be int64 and part_b's text;
    # concatenating them would give one silently mixed column. Text always means
    # the parts agree by construction.
    landing = tmp_path / "landing"
    landing.mkdir()
    (landing / "part_a.csv").write_text("case_id\n1\n2\n", encoding="utf-8")
    (landing / "part_b.csv").write_text("case_id\nC003\n", encoding="utf-8")

    frame = GlobCsvReader(landing, "part_*.csv").read().to_pandas()

    assert frame["case_id"].tolist() == ["1", "2", "C003"]
    assert frame["case_id"].map(type).nunique() == 1
