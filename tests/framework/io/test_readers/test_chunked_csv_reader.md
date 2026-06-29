```python
import pytest

from framework.core.dataset import Dataset
from framework.io.readers import DEFAULT_CHUNK_SIZE, ChunkedCsvReader


def _write_csv(path, rows, header="id,val,name"):
    lines = [header, *rows]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def _rows(dataset: Dataset):
    return dataset.to_pandas().to_dict(orient="records")


def test_streams_multiple_bounded_chunks(tmp_path):
    src = _write_csv(tmp_path / "feed.csv", [f"{i},{i * 10},n{i}" for i in range(5)])

    sizes = [len(chunk) for chunk in ChunkedCsvReader(src).chunks(2)]

    # 5 rows at size 2 -> three bounded chunks; none exceeds the requested size.
    assert sizes == [2, 2, 1]
    assert max(sizes) <= 2


def test_chunks_returns_a_lazy_iterator_not_a_materialised_list(tmp_path):
    # The whole source is never held at once: chunks() is a one-at-a-time
    # iterator, so pulling a single chunk does not realise the rest.
    src = _write_csv(tmp_path / "feed.csv", [f"{i},{i},n{i}" for i in range(5)])

    stream = ChunkedCsvReader(src).chunks(2)
    first = next(stream)

    assert isinstance(first, Dataset)
    assert len(first) == 2
    assert not isinstance(stream, list)
    assert iter(stream) is stream  # an iterator, consumed lazily


def test_default_chunk_size_is_ten_thousand(tmp_path):
    src = _write_csv(tmp_path / "feed.csv", [f"{i},{i},n{i}" for i in range(3)])

    chunks = list(ChunkedCsvReader(src).chunks())

    assert DEFAULT_CHUNK_SIZE == 10_000
    # A small source well under the default lands as a single chunk.
    assert [len(c) for c in chunks] == [3]


def test_column_projection_keeps_each_chunk_narrow_and_in_order(tmp_path):
    src = _write_csv(tmp_path / "feed.csv", [f"{i},{i * 10},n{i}" for i in range(4)])

    chunks = list(ChunkedCsvReader(src, columns=["name", "id"]).chunks(2))

    assert [c.columns for c in chunks] == [["name", "id"], ["name", "id"]]
    assert _rows(chunks[0]) == [
        {"name": "n0", "id": 0},
        {"name": "n1", "id": 1},
    ]


def test_single_chunk_source_yields_one_chunk(tmp_path):
    src = _write_csv(tmp_path / "feed.csv", ["1,10,a", "2,20,b"])

    chunks = list(ChunkedCsvReader(src).chunks(100))

    assert [len(c) for c in chunks] == [2]


def test_header_only_source_streams_zero_chunks(tmp_path):
    src = _write_csv(tmp_path / "feed.csv", [])

    assert list(ChunkedCsvReader(src).chunks(2)) == []


def test_empty_file_streams_zero_chunks(tmp_path):
    src = tmp_path / "empty.csv"
    src.write_text("", encoding="utf-8")

    assert list(ChunkedCsvReader(src).chunks(2)) == []


def test_total_rows_across_chunks_equal_the_source(tmp_path):
    src = _write_csv(tmp_path / "feed.csv", [f"{i},{i},n{i}" for i in range(7)])

    total = sum(len(chunk) for chunk in ChunkedCsvReader(src).chunks(3))

    assert total == 7


def test_non_positive_chunk_size_raises(tmp_path):
    src = _write_csv(tmp_path / "feed.csv", ["1,10,a"])

    with pytest.raises(ValueError, match="positive"):
        list(ChunkedCsvReader(src).chunks(0))


def test_describe_summarises_path_and_projection(tmp_path):
    src = _write_csv(tmp_path / "feed.csv", ["1,10,a"])

    summary = ChunkedCsvReader(src, columns=["id"]).describe()

    assert "ChunkedCsvReader(" in summary
    assert "feed.csv" in summary
    assert "columns=['id']" in summary


def test_reads_only_requested_columns_when_source_is_wide(tmp_path):
    # Regression guard for the projection use case: a wide source streamed for
    # just a couple of columns never widens a chunk beyond what was asked.
    src = _write_csv(tmp_path / "feed.csv", ["1,10,a", "2,20,b"])

    chunks = list(ChunkedCsvReader(src, columns=["id"]).chunks(1))

    assert all(c.columns == ["id"] for c in chunks)
    assert [len(c) for c in chunks] == [1, 1]

```
