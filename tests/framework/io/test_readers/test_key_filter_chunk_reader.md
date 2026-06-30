```python
"""Tests for the chunk-level row filters (issue #287).

``KeyFilterChunkReader`` is the headline id-allow-list (semi-join) filter and
``PredicateChunkReader`` the general per-chunk filter it is built on. Both wrap
any ``ChunkReader``; a tiny in-memory ``ChunkReader`` stands in for a real source
so the streaming/filtering contract is exercised without minting a 100M-row file.
"""

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.io.readers import (
    KeyFilterChunkReader,
    PredicateChunkReader,
    _normalize_key,
)


class _ListChunkReader:
    """A ChunkReader over an in-memory list of row dicts, for tests.

    Splits its rows into bounded chunks of ``size`` so the wrappers see a real
    multi-chunk stream; a chunk with no rows is never emitted, matching the
    concrete readers' zero-row-chunk skip.
    """

    def __init__(self, rows, *, columns=None):
        self._rows = rows
        self._columns = columns

    def chunks(self, size=10_000):
        for start in range(0, len(self._rows), size):
            window = self._rows[start : start + size]
            frame = pd.DataFrame(window, columns=self._columns)
            if len(frame) == 0:
                continue
            yield Dataset.from_pandas(frame)


def _column(chunks, name):
    return [r[name] for chunk in chunks for r in chunk.to_pandas().to_dict("records")]


def _ids(chunks):
    return _column(chunks, "id")


# --- id-membership (semi-join) ----------------------------------------------


def test_keeps_only_rows_whose_key_is_in_the_allow_list():
    rows = [{"id": i, "val": i * 10} for i in range(10)]
    inner = _ListChunkReader(rows)

    reader = KeyFilterChunkReader(inner, "id", allowed_keys={2, 5, 7})

    assert _ids(reader.chunks(3)) == [2, 5, 7]


def test_filters_before_accumulation_so_the_landed_total_is_bounded():
    # 1000 source rows, an allow-list of 3 -> only 3 rows ever land, and no
    # single chunk exceeds the requested size (memory stays bounded per chunk).
    rows = [{"id": i, "val": i} for i in range(1000)]
    reader = KeyFilterChunkReader(_ListChunkReader(rows), "id", {10, 500, 999})

    chunks = list(reader.chunks(50))

    assert _ids(chunks) == [10, 500, 999]
    assert all(len(c) <= 50 for c in chunks)
    assert reader.rows_scanned == 1000
    assert reader.rows_kept == 3


def test_chunk_with_zero_matches_yields_nothing():
    # The first chunk (ids 0,1,2) holds no allowed id; it is skipped entirely
    # rather than yielding an empty Dataset, consistent with zero-row chunks.
    rows = [{"id": i, "val": i} for i in range(6)]
    reader = KeyFilterChunkReader(_ListChunkReader(rows), "id", {4, 5})

    chunks = list(reader.chunks(3))

    assert [len(c) for c in chunks] == [2]  # only the second chunk survives
    assert _ids(chunks) == [4, 5]


def test_growing_allow_list_keeps_more_rows_run_over_run():
    # The allow-list grows between runs (bounded, in-memory set); a wider set on
    # a later run lands the newly-tracked ids too, the same source unchanged.
    rows = [{"id": i, "val": i} for i in range(10)]

    first = KeyFilterChunkReader(_ListChunkReader(rows), "id", {1, 2})
    assert _ids(first.chunks(4)) == [1, 2]

    grown = KeyFilterChunkReader(_ListChunkReader(rows), "id", {1, 2, 8})
    assert _ids(grown.chunks(4)) == [1, 2, 8]


def test_empty_allow_list_keeps_nothing():
    rows = [{"id": i, "val": i} for i in range(5)]
    reader = KeyFilterChunkReader(_ListChunkReader(rows), "id", set())

    chunks = list(reader.chunks(2))

    assert chunks == []
    assert reader.rows_scanned == 5
    assert reader.rows_kept == 0


# --- type alignment ----------------------------------------------------------


def test_float_source_ids_match_int_allow_list():
    # SAS numeric ids stream in as floats; the allow-list holds ints. Without
    # normalisation a float-vs-int mismatch would drop everything.
    rows = [{"id": float(i), "val": i} for i in range(5)]
    reader = KeyFilterChunkReader(_ListChunkReader(rows), "id", {1, 3})

    assert _ids(reader.chunks(2)) == [1.0, 3.0]


def test_bytes_source_ids_match_str_allow_list():
    # SAS character ids stream in as space-padded bytes; the allow-list holds
    # plain strings. Both normalise (decode + strip) before the membership test.
    rows = [
        {"id": b"A  ", "val": 1},
        {"id": b"B  ", "val": 2},
        {"id": b"C  ", "val": 3},
    ]
    reader = KeyFilterChunkReader(_ListChunkReader(rows), "id", {"A", "C"})

    assert _column(reader.chunks(2), "val") == [1, 3]


def test_missing_key_in_chunk_raises():
    rows = [{"id": 1, "val": 1}]
    reader = KeyFilterChunkReader(_ListChunkReader(rows), "key", {1})

    with pytest.raises(ValueError, match="key column 'key' not in chunk columns"):
        list(reader.chunks(2))


@pytest.mark.parametrize(
    "value, expected",
    [
        (3, "3"),
        (3.0, "3"),  # integral float collapses to the int form
        (3.5, "3.5"),
        (b"A  ", "A"),  # bytes decode + strip
        (" A ", "A"),  # str strips
        (None, None),
        (float("nan"), None),
        (True, "True"),
    ],
)
def test_normalize_key_aligns_types(value, expected):
    assert _normalize_key(value) == expected


# --- general predicate form --------------------------------------------------


def test_predicate_chunk_reader_applies_an_arbitrary_filter():
    rows = [{"id": i, "val": i} for i in range(10)]

    def keep_even(chunk: Dataset) -> Dataset:
        frame = chunk.to_pandas()
        return Dataset.from_pandas(frame[frame["id"] % 2 == 0])

    reader = PredicateChunkReader(_ListChunkReader(rows), keep_even)

    assert _ids(reader.chunks(4)) == [0, 2, 4, 6, 8]
    assert reader.rows_scanned == 10
    assert reader.rows_kept == 5


def test_chunks_is_a_lazy_iterator():
    rows = [{"id": i, "val": i} for i in range(10)]
    reader = KeyFilterChunkReader(_ListChunkReader(rows), "id", set(range(10)))

    stream = reader.chunks(2)
    first = next(stream)

    assert isinstance(first, Dataset)
    assert iter(stream) is stream


def test_counters_reset_each_pass():
    rows = [{"id": i, "val": i} for i in range(5)]
    reader = KeyFilterChunkReader(_ListChunkReader(rows), "id", {1, 2})

    list(reader.chunks(2))
    assert (reader.rows_scanned, reader.rows_kept) == (5, 2)

    # A second pass re-tallies from zero rather than accumulating across passes.
    list(reader.chunks(2))
    assert (reader.rows_scanned, reader.rows_kept) == (5, 2)


def test_describe_summarises_inner_key_and_allow_list_size():
    rows = [{"id": 1}]
    reader = KeyFilterChunkReader(_ListChunkReader(rows), "id", {1, 2, 3})

    summary = reader.describe()

    assert "KeyFilterChunkReader(" in summary
    assert "key_column='id'" in summary
    assert "allowed_keys=3" in summary  # a count, never the keys themselves

```
