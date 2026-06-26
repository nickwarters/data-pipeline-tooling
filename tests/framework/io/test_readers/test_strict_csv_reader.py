from pathlib import Path

import pytest

from framework.io.readers import StrictCsvParseError, StrictCsvReader

FIXTURE = Path(__file__).parent.parent.parent.parent / "fixtures" / "strict_cases.csv"


def _rows(dataset):
    # Cross the seam only here, in the test, to assert on parsed values.
    return dataset.to_pandas().to_dict(orient="records")


def test_reads_header_and_row_count():
    dataset = StrictCsvReader(FIXTURE).read()

    assert dataset.columns == ["case_id", "note", "advisor"]
    assert len(dataset) == 3


def test_embedded_delimiter_inside_quotes_is_one_field():
    rows = _rows(StrictCsvReader(FIXTURE).read())

    assert rows[0]["note"] == "Hello, world"
    assert rows[0]["case_id"] == "C001"
    assert rows[0]["advisor"] == "Alice"


def test_embedded_newline_inside_quotes_is_preserved():
    rows = _rows(StrictCsvReader(FIXTURE).read())

    # The quoted field spans two physical lines yet stays one record/field.
    assert rows[1]["note"] == "Line one\nLine two"
    assert rows[1]["advisor"] == "Bob"


def test_doubled_quote_inside_quotes_unescapes_to_one_quote():
    rows = _rows(StrictCsvReader(FIXTURE).read())

    assert rows[2]["note"] == 'She said "hi"'


def test_values_are_left_as_text(tmp_path):
    src = tmp_path / "nums.csv"
    src.write_text("id,amount\n1,1200.50\n2,0007\n", encoding="utf-8")

    rows = _rows(StrictCsvReader(src).read())

    # No type inference: a leading-zero code and a decimal both survive as text.
    assert rows == [
        {"id": "1", "amount": "1200.50"},
        {"id": "2", "amount": "0007"},
    ]


def test_columns_projection_selects_and_orders():
    dataset = StrictCsvReader(FIXTURE, columns=["advisor", "case_id"]).read()

    assert dataset.columns == ["advisor", "case_id"]
    assert len(dataset) == 3


def test_unknown_projection_column_raises_located_error():
    with pytest.raises(StrictCsvParseError, match="not in header"):
        StrictCsvReader(FIXTURE, columns=["nope"]).read()


def test_crlf_line_endings_parse(tmp_path):
    src = tmp_path / "crlf.csv"
    src.write_bytes(b"a,b\r\n1,2\r\n3,4\r\n")

    rows = _rows(StrictCsvReader(src).read())

    assert rows == [{"a": "1", "b": "2"}, {"a": "3", "b": "4"}]


def test_crlf_inside_quoted_field_is_preserved(tmp_path):
    src = tmp_path / "embedded_crlf.csv"
    src.write_bytes(b'a,b\r\n1,"x\r\ny"\r\n')

    rows = _rows(StrictCsvReader(src).read())

    assert rows == [{"a": "1", "b": "x\r\ny"}]


def test_lone_cr_terminates_records(tmp_path):
    src = tmp_path / "cr.csv"
    src.write_bytes(b"a,b\r1,2\r3,4")

    rows = _rows(StrictCsvReader(src).read())

    assert rows == [{"a": "1", "b": "2"}, {"a": "3", "b": "4"}]


def test_trailing_empty_field_and_no_final_newline(tmp_path):
    src = tmp_path / "trailing.csv"
    src.write_text("a,b,c\n1,2,", encoding="utf-8")

    rows = _rows(StrictCsvReader(src).read())

    assert rows == [{"a": "1", "b": "2", "c": ""}]


def test_quoted_empty_field_is_empty_string(tmp_path):
    src = tmp_path / "quoted_empty.csv"
    src.write_text('a,b\n"",x\n', encoding="utf-8")

    rows = _rows(StrictCsvReader(src).read())

    assert rows == [{"a": "", "b": "x"}]


def test_bom_is_tolerated(tmp_path):
    src = tmp_path / "bom.csv"
    src.write_bytes(b"\xef\xbb\xbfa,b\n1,2\n")

    dataset = StrictCsvReader(src).read()

    # The BOM does not bleed into the first header name.
    assert dataset.columns == ["a", "b"]


def test_ragged_row_raises_located_error(tmp_path):
    src = tmp_path / "ragged.csv"
    src.write_text("a,b,c\n1,2,3\n4,5\n", encoding="utf-8")

    with pytest.raises(StrictCsvParseError, match="record 3 has 2 fields"):
        StrictCsvReader(src).read()


def test_unterminated_quote_raises(tmp_path):
    src = tmp_path / "unterminated.csv"
    src.write_text('a,b\n1,"open\n', encoding="utf-8")

    with pytest.raises(StrictCsvParseError, match="unterminated quoted field"):
        StrictCsvReader(src).read()


def test_empty_file_yields_empty_dataset(tmp_path):
    src = tmp_path / "empty.csv"
    src.write_text("", encoding="utf-8")

    dataset = StrictCsvReader(src).read()

    assert dataset.columns == []
    assert len(dataset) == 0


def test_custom_delimiter(tmp_path):
    src = tmp_path / "semi.csv"
    src.write_text('a;b\n1;"x;y"\n', encoding="utf-8")

    rows = _rows(StrictCsvReader(src, delimiter=";").read())

    assert rows == [{"a": "1", "b": "x;y"}]


def test_describe_reports_config():
    summary = StrictCsvReader(FIXTURE, columns=["case_id"]).describe()

    assert summary.startswith("StrictCsvReader(")
    assert "case_id" in summary
