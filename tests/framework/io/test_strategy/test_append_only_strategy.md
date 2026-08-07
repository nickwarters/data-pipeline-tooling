```python
"""Integration tests for AppendOnly via Store.writer.

The contract under test is immutability of what has already landed: an unseen
key appends, a re-presented unchanged key is a no-op, a changed key is a visible
failure, and no existing row is ever updated or deleted.
"""

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.core.errors import ErrorCategory, PipelineError
from framework.io import AppendOnly, AppendOnlyConflictError
from tools.store import Store


def _ds(*rows: dict) -> Dataset:
    return Dataset.from_pandas(pd.DataFrame(list(rows)))


def _rows(store: Store, table: str) -> list[dict]:
    frame = store.reader(table).read().to_pandas()
    return frame.to_dict("records")


def test_first_write_creates_the_table_and_lands_every_row(tmp_path):
    store = Store(tmp_path / "raw.db")
    writer = store.writer("observations", AppendOnly("observation_id"))

    writer.write(_ds({"observation_id": "v1", "status": "open"}))

    assert _rows(store, "observations") == [{"observation_id": "v1", "status": "open"}]


def test_a_disjoint_batch_appends_and_preserves_existing_rows(tmp_path):
    store = Store(tmp_path / "raw.db")
    writer = store.writer("observations", AppendOnly("observation_id"))
    writer.write(_ds({"observation_id": "v1", "status": "open"}))

    writer.write(_ds({"observation_id": "v2", "status": "closed"}))

    assert _rows(store, "observations") == [
        {"observation_id": "v1", "status": "open"},
        {"observation_id": "v2", "status": "closed"},
    ]


def test_rewriting_an_identical_row_is_a_noop(tmp_path):
    # The overlapping-poll-window case: the same observation is read again and
    # must not double.
    store = Store(tmp_path / "raw.db")
    writer = store.writer("observations", AppendOnly("observation_id"))
    batch = _ds(
        {"observation_id": "v1", "status": "open"},
        {"observation_id": "v2", "status": "closed"},
    )
    writer.write(batch)

    writer.write(batch)

    assert _rows(store, "observations") == [
        {"observation_id": "v1", "status": "open"},
        {"observation_id": "v2", "status": "closed"},
    ]


def test_a_partly_overlapping_batch_appends_only_the_unseen_keys(tmp_path):
    store = Store(tmp_path / "raw.db")
    writer = store.writer("observations", AppendOnly("observation_id"))
    writer.write(_ds({"observation_id": "v1", "status": "open"}))

    writer.write(
        _ds(
            {"observation_id": "v1", "status": "open"},  # seen, unchanged
            {"observation_id": "v2", "status": "closed"},  # unseen
        )
    )

    assert _rows(store, "observations") == [
        {"observation_id": "v1", "status": "open"},
        {"observation_id": "v2", "status": "closed"},
    ]


def test_identical_duplicates_within_one_batch_land_once(tmp_path):
    store = Store(tmp_path / "raw.db")
    writer = store.writer("observations", AppendOnly("observation_id"))

    writer.write(
        _ds(
            {"observation_id": "v1", "status": "open"},
            {"observation_id": "v1", "status": "open"},
            {"observation_id": "v2", "status": "closed"},
        )
    )

    assert _rows(store, "observations") == [
        {"observation_id": "v1", "status": "open"},
        {"observation_id": "v2", "status": "closed"},
    ]


def test_conflicting_duplicates_within_one_batch_fail_and_land_nothing(tmp_path):
    store = Store(tmp_path / "raw.db")
    writer = store.writer("observations", AppendOnly("observation_id"))

    with pytest.raises(AppendOnlyConflictError, match="v1"):
        writer.write(
            _ds(
                {"observation_id": "v1", "status": "open"},
                {"observation_id": "v1", "status": "closed"},
                {"observation_id": "v2", "status": "closed"},
            )
        )

    # Not even the unambiguous row landed: the batch is refused before staging,
    # so the target was never created.
    assert not (tmp_path / "raw.db").exists()


def test_existing_key_with_different_payload_is_an_integrity_error(tmp_path):
    store = Store(tmp_path / "raw.db")
    writer = store.writer("observations", AppendOnly("observation_id"))
    writer.write(_ds({"observation_id": "v1", "status": "open"}))

    with pytest.raises(AppendOnlyConflictError):
        writer.write(_ds({"observation_id": "v1", "status": "closed"}))

    assert _rows(store, "observations") == [{"observation_id": "v1", "status": "open"}]


def test_a_conflict_leaves_the_whole_batch_unlanded(tmp_path):
    # The conflicting key aborts the merge, so the innocent rows beside it do
    # not land either — the operator fixes the feed and re-drives.
    store = Store(tmp_path / "raw.db")
    writer = store.writer("observations", AppendOnly("observation_id"))
    writer.write(_ds({"observation_id": "v1", "status": "open"}))

    with pytest.raises(AppendOnlyConflictError):
        writer.write(
            _ds(
                {"observation_id": "v1", "status": "closed"},
                {"observation_id": "v2", "status": "open"},
            )
        )

    assert _rows(store, "observations") == [{"observation_id": "v1", "status": "open"}]


def test_a_null_that_appears_or_disappears_counts_as_a_difference(tmp_path):
    # Null-safe comparison: SQL's ``=`` would answer "unknown" and quietly let
    # the changed row through as unseen-but-matching.
    store = Store(tmp_path / "raw.db")
    writer = store.writer("observations", AppendOnly("observation_id"))
    writer.write(_ds({"observation_id": "v1", "note": None}))

    with pytest.raises(AppendOnlyConflictError):
        writer.write(_ds({"observation_id": "v1", "note": "amended"}))

    assert _rows(store, "observations") == [{"observation_id": "v1", "note": None}]


def test_a_null_value_that_is_unchanged_is_still_a_noop(tmp_path):
    store = Store(tmp_path / "raw.db")
    writer = store.writer("observations", AppendOnly("observation_id"))
    batch = _ds({"observation_id": "v1", "note": None})
    writer.write(batch)

    writer.write(batch)

    assert _rows(store, "observations") == [{"observation_id": "v1", "note": None}]


def test_a_change_in_any_column_is_a_conflict(tmp_path):
    # Column-complete: the comparison is not limited to one payload column.
    store = Store(tmp_path / "raw.db")
    writer = store.writer("observations", AppendOnly("observation_id"))
    writer.write(_ds({"observation_id": "v1", "status": "open", "owner": "ana"}))

    with pytest.raises(AppendOnlyConflictError):
        writer.write(_ds({"observation_id": "v1", "status": "open", "owner": "raj"}))


def test_missing_key_column_fails_before_staging(tmp_path):
    store = Store(tmp_path / "raw.db")
    writer = store.writer("observations", AppendOnly("observation_id"))

    with pytest.raises(ValueError, match="observation_id"):
        writer.write(_ds({"status": "open"}))

    assert not (tmp_path / "raw.db").exists()


def test_null_key_fails_before_staging(tmp_path):
    store = Store(tmp_path / "raw.db")
    writer = store.writer("observations", AppendOnly("observation_id"))

    with pytest.raises(ValueError, match="observation_id"):
        writer.write(
            _ds(
                {"observation_id": "v1", "status": "open"},
                {"observation_id": None, "status": "open"},
            )
        )

    assert not (tmp_path / "raw.db").exists()


def test_composite_keys(tmp_path):
    store = Store(tmp_path / "raw.db")
    writer = store.writer("observations", AppendOnly(("list_guid", "item_id")))
    writer.write(
        _ds(
            {"list_guid": "L1", "item_id": 1, "status": "open"},
            {"list_guid": "L2", "item_id": 1, "status": "open"},
        )
    )

    # Same item_id under a different list is a different observation.
    writer.write(
        _ds(
            {"list_guid": "L1", "item_id": 1, "status": "open"},  # seen
            {"list_guid": "L1", "item_id": 2, "status": "closed"},  # unseen
        )
    )

    assert _rows(store, "observations") == [
        {"list_guid": "L1", "item_id": 1, "status": "open"},
        {"list_guid": "L2", "item_id": 1, "status": "open"},
        {"list_guid": "L1", "item_id": 2, "status": "closed"},
    ]

    with pytest.raises(AppendOnlyConflictError):
        writer.write(_ds({"list_guid": "L2", "item_id": 1, "status": "closed"}))


def test_key_only_rows_have_nothing_to_contradict(tmp_path):
    store = Store(tmp_path / "raw.db")
    writer = store.writer("observations", AppendOnly("observation_id"))
    writer.write(_ds({"observation_id": "v1"}, {"observation_id": "v2"}))

    writer.write(_ds({"observation_id": "v2"}, {"observation_id": "v3"}))

    assert _rows(store, "observations") == [
        {"observation_id": "v1"},
        {"observation_id": "v2"},
        {"observation_id": "v3"},
    ]


def test_an_empty_batch_is_a_noop(tmp_path):
    store = Store(tmp_path / "raw.db")
    writer = store.writer("observations", AppendOnly("observation_id"))
    writer.write(_ds({"observation_id": "v1", "status": "open"}))

    writer.write(
        Dataset.from_pandas(pd.DataFrame(columns=["observation_id", "status"]))
    )

    assert _rows(store, "observations") == [{"observation_id": "v1", "status": "open"}]


def test_a_batch_carrying_a_column_the_target_lacks_fails_visibly(tmp_path):
    # The staged-merge behaviour every merge Writer shares: a batch whose shape
    # no longer matches the target is a loud failure, not a silent partial load.
    store = Store(tmp_path / "raw.db")
    writer = store.writer("observations", AppendOnly("observation_id"))
    writer.write(_ds({"observation_id": "v1", "status": "open"}))

    with pytest.raises(Exception) as excinfo:
        writer.write(_ds({"observation_id": "v2", "status": "open", "assignee": "ana"}))
    assert "assignee" in str(excinfo.value)

    assert _rows(store, "observations") == [{"observation_id": "v1", "status": "open"}]


def test_a_batch_missing_a_column_the_target_holds_fails_visibly(tmp_path):
    # The other drift direction, and the dangerous one: the comparison spans the
    # batch's columns, so a narrower batch would read a changed row as unchanged
    # and land a new key with the dropped column NULL — which would then look
    # like a source mutation the next time that key arrived complete.
    store = Store(tmp_path / "raw.db")
    writer = store.writer("observations", AppendOnly("observation_id"))
    writer.write(_ds({"observation_id": "v1", "status": "open", "note": "first"}))

    with pytest.raises(ValueError, match="note"):
        writer.write(
            _ds(
                {"observation_id": "v1", "status": "open"},
                {"observation_id": "v2", "status": "closed"},
            )
        )

    assert _rows(store, "observations") == [
        {"observation_id": "v1", "status": "open", "note": "first"}
    ]


def test_an_unchanged_row_re_read_with_a_wider_dtype_is_still_a_noop(tmp_path):
    # Comparison is by SQLite's affinity rules, not by pandas dtype: a re-read
    # that widens int to float carries the same value and must not be read as a
    # mutation of an immutable observation.
    store = Store(tmp_path / "raw.db")
    writer = store.writer("observations", AppendOnly("observation_id"))
    writer.write(_ds({"observation_id": "v1", "count": 1}))

    writer.write(_ds({"observation_id": "v1", "count": 1.0}))

    assert _rows(store, "observations") == [{"observation_id": "v1", "count": 1}]


def test_chunked_writes_see_the_keys_earlier_chunks_appended(tmp_path):
    # The Writer supports the chunk session because each write compares against
    # the live target, so chunk N+1 treats chunk N's keys as seen.
    from framework.io import supports_chunk_writes, writing_chunks

    store = Store(tmp_path / "raw.db")
    writer = store.writer("observations", AppendOnly("observation_id"))
    assert supports_chunk_writes(writer)

    with writing_chunks(writer) as chunk_writer:
        chunk_writer.write(_ds({"observation_id": "v1", "status": "open"}))
        chunk_writer.write(_ds({"observation_id": "v2", "status": "closed"}))
        chunk_writer.write(_ds({"observation_id": "v1", "status": "open"}))

    assert _rows(store, "observations") == [
        {"observation_id": "v1", "status": "open"},
        {"observation_id": "v2", "status": "closed"},
    ]


def test_the_conflict_is_an_operator_readable_pipeline_error():
    # A feed that broke its own immutability is a data failure, so it renders
    # through the run log's category rather than as a raw traceback.
    assert issubclass(AppendOnlyConflictError, PipelineError)
    assert AppendOnlyConflictError.category == ErrorCategory.DATA


def test_append_only_normalises_and_compares_by_key_columns():
    assert AppendOnly("id") == AppendOnly(("id",))
    assert hash(AppendOnly("id")) == hash(AppendOnly(("id",)))
    assert AppendOnly(key_columns=("a", "b")) == AppendOnly(("a", "b"))
    assert AppendOnly("a") != AppendOnly("b")


def test_append_only_requires_at_least_one_key_column():
    with pytest.raises(ValueError, match="at least one key column"):
        AppendOnly(())

```
