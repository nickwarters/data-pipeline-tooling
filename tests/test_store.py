from pathlib import Path

import pandas as pd
import pytest

from framework.data_handle import DataHandle
from framework.readers import CsvReader
from framework.store import Store

FIXTURE = Path(__file__).parent / "fixtures" / "cases.csv"


def test_store_mints_a_writer_and_reader_that_round_trip_a_handle(tmp_path):
    # A per-subject Store mints the layer's Writer and Reader over the subject's
    # own file; writing a handle through the minted Writer and reading it back
    # through the minted Reader returns the same shape (ADR-0001 amendment).
    handle = CsvReader(FIXTURE).read()
    store = Store(tmp_path)

    store.writer("raw", "cases").write(handle)
    landed = store.reader("raw", "cases").read()

    assert landed.columns == handle.columns
    assert len(landed) == len(handle)


def test_minted_raw_writer_full_refreshes_rather_than_accumulates(tmp_path):
    # raw mirrors a current-state source snapshot, so the Store mints a
    # truncate+reload Writer there (ADR-0006): a second write replaces the
    # first rather than appending.
    handle = CsvReader(FIXTURE).read()
    store = Store(tmp_path)

    store.writer("raw", "cases").write(handle)
    store.writer("raw", "cases").write(handle)

    landed = store.reader("raw", "cases").read()
    assert len(landed) == len(handle)


def test_minted_gold_writer_accumulates_each_run_stamped_by_run(tmp_path):
    # gold accumulates (ADR-0006): the Store mints an accumulate-by-run Writer
    # there, stamped with the run identity passed at mint time. Two distinct
    # runs land both sets, each row carrying its run_id / load_date.
    handle = CsvReader(FIXTURE).read()
    store = Store(tmp_path)

    store.writer("gold", "casepool", run_id="r1", load_date="2026-05-29").write(handle)
    store.writer("gold", "casepool", run_id="r2", load_date="2026-05-30").write(handle)

    landed = store.reader("gold", "casepool").read()
    assert len(landed) == 2 * len(handle)
    assert "run_id" in landed.columns
    assert "load_date" in landed.columns


def test_minting_gold_writer_requires_run_identity(tmp_path):
    # gold's accumulate-by-run strategy stamps each row by run, so minting a
    # gold Writer without a run identity is a programming error, not a silent
    # unstamped write.
    store = Store(tmp_path)

    with pytest.raises(ValueError):
        store.writer("gold", "casepool")


def test_unknown_layer_is_rejected(tmp_path):
    # The medallion has exactly three layers; minting over anything else is a
    # programming error, caught on both the write and read sides.
    store = Store(tmp_path)

    with pytest.raises(ValueError):
        store.writer("bronze", "cases")
    with pytest.raises(ValueError):
        store.reader("bronze", "cases")


def test_subjects_are_isolated_same_table_name_no_collision(tmp_path):
    # Each subject owns its own medallion files (ADR-0001 amendment): two
    # subjects can land a same-named table with different contents, each under
    # its own directory, with no collision.
    handle = CsvReader(FIXTURE).read()
    type_a = Store(tmp_path / "case_type_a")
    type_b = Store(tmp_path / "case_type_b")

    type_a.writer("raw", "cases").write(handle)

    # type_b's "cases" table does not exist yet — type_a's write did not leak.
    assert (tmp_path / "case_type_a" / "raw.db").exists()
    assert not (tmp_path / "case_type_b" / "raw.db").exists()

    type_b.writer("raw", "cases").write(handle)
    assert (tmp_path / "case_type_b" / "raw.db").exists()
    assert len(type_a.reader("raw", "cases").read()) == len(handle)
    assert len(type_b.reader("raw", "cases").read()) == len(handle)


def test_reference_data_medallion_is_read_and_joined_by_another_subject(tmp_path):
    # Reference Data is its own subject's medallion, read-only to Case Types: a
    # Case Type's Selection reads it through a Reader and joins it in Python
    # (ADR-0001 amendment, ADR-0002). Split files cost nothing on the join path.
    advisers = Store(tmp_path / "advisers")  # a Reference Data subject
    cases = Store(tmp_path / "activity")  # a Case Type subject

    advisers.writer("silver", "advisers").write(
        DataHandle.from_pandas(
            pd.DataFrame({"adviser_id": [1, 2], "region": ["North", "South"]})
        )
    )
    cases.writer("silver", "cases").write(
        DataHandle.from_pandas(
            pd.DataFrame({"case_id": [10, 11], "adviser_id": [1, 2]})
        )
    )

    # The Case Type subject reaches across to the Reference Data medallion via a
    # Reader, then joins in Python (behind the DataHandle seam, as a processor
    # would).
    case_frame = cases.reader("silver", "cases").read().to_pandas()
    adviser_frame = advisers.reader("silver", "advisers").read().to_pandas()
    joined = case_frame.merge(adviser_frame, on="adviser_id")

    assert list(joined["region"]) == ["North", "South"]
    assert len(joined) == 2
