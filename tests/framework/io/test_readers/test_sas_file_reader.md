```python
"""Tests for the chunked SAS-format streaming reader.

The streamed fixtures are real SAS-format (XPORT v5) files under
``tests/fixtures/`` — pandas parses XPORT and sas7bdat through the *same*
chunked code path, so streaming/projection/edge behaviour proven here holds for
both. sas7bdat (and the real ``extract.sas7bdat.gz`` feed) can't be minted
without SAS itself, so its format selection is covered by the inference and
wiring tests below; see ``tests/fixtures/generate_chunked_sas_fixtures.py``.
"""

from pathlib import Path

import pytest

from framework.core.dataset import Dataset
from framework.io.readers import DEFAULT_CHUNK_SIZE, SasFileReader, _infer_sas_format

FIXTURES = Path(__file__).parent.parent.parent.parent / "fixtures"
SAMPLE = FIXTURES / "chunked_sample.xpt"  # 5 rows: id, val, name
SAMPLE_GZ = FIXTURES / "chunked_sample.xpt.gz"
EMPTY = FIXTURES / "chunked_empty.xpt"  # header only, zero rows


def _rows(dataset: Dataset):
    return dataset.to_pandas().to_dict(orient="records")


def test_streams_multiple_bounded_chunks():
    sizes = [len(chunk) for chunk in SasFileReader(SAMPLE).chunks(2)]

    assert sizes == [2, 2, 1]
    assert max(sizes) <= 2


def test_chunks_returns_a_lazy_iterator():
    stream = SasFileReader(SAMPLE).chunks(2)
    first = next(stream)

    assert isinstance(first, Dataset)
    assert len(first) == 2
    assert iter(stream) is stream


def test_default_chunk_size_lands_small_source_as_one_chunk():
    chunks = list(SasFileReader(SAMPLE).chunks())

    assert DEFAULT_CHUNK_SIZE == 10_000
    assert [len(c) for c in chunks] == [5]


def test_gzipped_source_is_read_on_the_fly():
    # The real feed lands as a gzipped extract; compression is inferred from the
    # extension and decompressed transparently while streaming.
    chunks = list(SasFileReader(SAMPLE_GZ).chunks(2))

    assert [len(c) for c in chunks] == [2, 2, 1]
    assert chunks[0].columns == ["id", "val", "name"]


def _as_text(value):
    # pandas' XPORT reader hands character columns back as bytes (sas7bdat
    # yields str); normalise so the test asserts the projected value, not the
    # fixture-format quirk.
    return value.decode() if isinstance(value, bytes) else value


def test_column_projection_keeps_each_chunk_narrow_and_in_order():
    chunks = list(SasFileReader(SAMPLE, columns=["name", "id"]).chunks(2))

    assert [c.columns for c in chunks] == [["name", "id"]] * 3
    first = _rows(chunks[0])
    assert [r["id"] for r in first] == [1.0, 2.0]
    assert [_as_text(r["name"]) for r in first] == ["a", "b"]


def test_unknown_projection_column_raises():
    with pytest.raises(ValueError, match="not in source"):
        list(SasFileReader(SAMPLE, columns=["nope"]).chunks(2))


def test_empty_source_streams_zero_chunks():
    assert list(SasFileReader(EMPTY).chunks(2)) == []


def test_non_positive_chunk_size_raises():
    with pytest.raises(ValueError, match="positive"):
        list(SasFileReader(SAMPLE).chunks(0))


def test_total_rows_across_chunks_equal_the_source():
    total = sum(len(chunk) for chunk in SasFileReader(SAMPLE).chunks(2))

    assert total == 5


# --- format selection (sas7bdat vs xport) -----------------------------------


@pytest.mark.parametrize(
    "name, expected",
    [
        ("extract.sas7bdat", "sas7bdat"),
        ("extract.sas7bdat.gz", "sas7bdat"),
        ("extract.xpt", "xport"),
        ("extract.xpt.gz", "xport"),
        ("EXTRACT.SAS7BDAT", "sas7bdat"),
    ],
)
def test_format_inferred_from_extension_ignoring_compression(name, expected):
    assert _infer_sas_format(Path(name)) == expected


def test_unrecognised_extension_raises_asking_for_explicit_format():
    with pytest.raises(ValueError, match="cannot infer SAS format"):
        _infer_sas_format(Path("mystery.dat"))


def test_explicit_format_overrides_inference():
    reader = SasFileReader(Path("mystery.dat"), format="sas7bdat")

    assert reader._format == "sas7bdat"


def test_sas7bdat_format_is_passed_through_to_the_engine(monkeypatch):
    # sas7bdat binaries can't be minted without SAS, so prove the sas7bdat path
    # is wired: the reader selects format='sas7bdat' from the extension and hands
    # it (plus the chunk size) to pandas' SAS reader unchanged.
    import framework.io.readers as readers

    captured = {}

    class _FakeReader:
        def __enter__(self):
            return iter(())

        def __exit__(self, *exc):
            return False

    def fake_read_sas(path, **kwargs):
        captured["path"] = path
        captured.update(kwargs)
        return _FakeReader()

    monkeypatch.setattr(readers.pd, "read_sas", fake_read_sas)

    list(SasFileReader(Path("extract.sas7bdat.gz")).chunks(500))

    assert captured["format"] == "sas7bdat"
    assert captured["chunksize"] == 500

```
