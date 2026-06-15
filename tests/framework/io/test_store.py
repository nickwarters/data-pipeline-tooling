from pathlib import Path

import pandas as pd
import pytest

from framework.io.dataset import Dataset
from framework.io.readers import CsvReader
from framework.io.store import GOLD, RAW, SILVER, Store, StoreCatalog
from framework.io.strategy import AccumulateByRun, Refresh

FIXTURE = Path(__file__).parent.parent.parent / "fixtures" / "cases.csv"


def test_store_writer_with_refresh_strategy_round_trips_a_dataset(tmp_path):
    # Store.writer accepts an explicit Refresh strategy; the minted Writer
    # truncates + reloads (full-refresh) on each run — strategy is now the
    # caller's declaration, not an implicit layer rule.
    dataset = CsvReader(FIXTURE).read()
    store = Store(tmp_path)

    store.writer("raw", "cases", Refresh()).write(dataset)
    landed = store.reader("raw", "cases").read()

    assert landed.columns == dataset.columns
    assert len(landed) == len(dataset)


def test_layer_constants_can_be_used_instead_of_bare_strings(tmp_path):
    dataset = CsvReader(FIXTURE).read()
    store = Store(tmp_path)

    store.writer(RAW, "cases", Refresh()).write(dataset)
    raw = store.reader(RAW, "cases").read()

    store.writer(SILVER, "cases", Refresh()).write(raw)
    store.writer(GOLD, "cases", AccumulateByRun("r1", "2026-05-29")).write(raw)

    assert (tmp_path / "raw.db").exists()
    assert (tmp_path / "silver.db").exists()
    assert (tmp_path / "gold.db").exists()


def test_refresh_strategy_full_refreshes_rather_than_accumulates(tmp_path):
    # A Refresh strategy truncates + reloads: a second write replaces the
    # first rather than appending.
    dataset = CsvReader(FIXTURE).read()
    store = Store(tmp_path)

    store.writer("raw", "cases", Refresh()).write(dataset)
    store.writer("raw", "cases", Refresh()).write(dataset)

    landed = store.reader("raw", "cases").read()
    assert len(landed) == len(dataset)


def test_store_writer_with_accumulate_by_run_strategy_accumulates(tmp_path):
    # Store.writer accepts an explicit AccumulateByRun strategy; the minted
    # Writer stamps rows by run and accumulates across runs.
    dataset = CsvReader(FIXTURE).read()
    store = Store(tmp_path)

    store.writer("gold", "casepool", AccumulateByRun("r1", "2026-05-29")).write(dataset)
    store.writer("gold", "casepool", AccumulateByRun("r2", "2026-05-30")).write(dataset)

    landed = store.reader("gold", "casepool").read()
    assert len(landed) == 2 * len(dataset)
    assert "run_id" in landed.columns
    assert "load_date" in landed.columns


def test_silver_table_can_be_configured_to_accumulate(tmp_path):
    # Strategy is no longer layer-bound: a silver feed can declare AccumulateByRun
    # instead of Refresh, letting two distinct runs land in silver.db side-by-side.
    # This is of  — the proof that the Store makes no load decision.
    dataset = CsvReader(FIXTURE).read()
    store = Store(tmp_path)

    store.writer("silver", "events", AccumulateByRun("r1", "2026-01-01")).write(dataset)
    store.writer("silver", "events", AccumulateByRun("r2", "2026-01-02")).write(dataset)

    landed = store.reader("silver", "events").read()
    assert len(landed) == 2 * len(dataset)
    assert "run_id" in landed.columns


def test_unknown_layer_is_rejected(tmp_path):
    # The medallion has exactly three layers; minting over anything else is a
    # programming error, caught on both the write and read sides.
    store = Store(tmp_path)

    with pytest.raises(ValueError):
        store.writer("bronze", "cases", Refresh())
    with pytest.raises(ValueError):
        store.reader("bronze", "cases")


def test_subjects_are_isolated_same_table_name_no_collision(tmp_path):
    # Each subject owns its own medallion files: two
    # subjects can land a same-named table with different contents, each under
    # its own directory, with no collision.
    dataset = CsvReader(FIXTURE).read()
    type_a = Store(tmp_path / "case_type_a")
    type_b = Store(tmp_path / "case_type_b")

    type_a.writer("raw", "cases", Refresh()).write(dataset)

    # type_b's "cases" table does not exist yet — type_a's write did not leak.
    assert (tmp_path / "case_type_a" / "raw.db").exists()
    assert not (tmp_path / "case_type_b" / "raw.db").exists()

    type_b.writer("raw", "cases", Refresh()).write(dataset)
    assert (tmp_path / "case_type_b" / "raw.db").exists()
    assert len(type_a.reader("raw", "cases").read()) == len(dataset)
    assert len(type_b.reader("raw", "cases").read()) == len(dataset)


def test_store_columns_of_reads_the_prior_landing_and_labels_the_table(tmp_path):
    # The PriorColumns seam the raw drift check reads: after a landing,
    # columns_of reports that table's columns (order preserved) and a label that
    # names the layer + table for the warning message.
    dataset = CsvReader(FIXTURE).read()
    store = Store(tmp_path)
    store.writer(RAW, "cases", Refresh()).write(dataset)

    prior = store.columns_of(RAW, "cases")

    assert prior.columns() == tuple(dataset.columns)
    assert prior.label == "raw.cases"


def test_store_columns_of_returns_none_when_the_table_does_not_exist(tmp_path):
    # First-ever run: nothing has landed, so there is no prior column set — the
    # seam returns None (a clean no-op for the drift check, ), not an error.
    store = Store(tmp_path)

    assert store.columns_of(RAW, "cases").columns() is None


def test_store_catalog_mints_subject_stores_from_a_shared_root(tmp_path):
    dataset = CsvReader(FIXTURE).read()
    catalog = StoreCatalog(tmp_path)

    cases = catalog.store("cases")
    advisers = catalog.store("advisers")

    cases.writer(RAW, "shared_table", Refresh()).write(dataset)
    advisers.writer(RAW, "shared_table", Refresh()).write(dataset)

    assert (tmp_path / "cases" / "raw.db").exists()
    assert (tmp_path / "advisers" / "raw.db").exists()
    assert len(cases.reader(RAW, "shared_table").read()) == len(dataset)
    assert len(advisers.reader(RAW, "shared_table").read()) == len(dataset)


def test_reference_data_medallion_is_read_and_joined_by_another_subject(tmp_path):
    # Reference Data is its own subject's medallion, read-only to Case Types: a
    # Case Type's Selection reads it through a Reader and joins it in Python.
    # Split files cost nothing on the join path.
    advisers = Store(tmp_path / "advisers")  # a Reference Data subject
    cases = Store(tmp_path / "activity")  # a Case Type subject

    advisers.writer("silver", "advisers", Refresh()).write(
        Dataset.from_pandas(
            pd.DataFrame({"adviser_id": [1, 2], "region": ["North", "South"]})
        )
    )
    cases.writer("silver", "cases", Refresh()).write(
        Dataset.from_pandas(pd.DataFrame({"case_id": [10, 11], "adviser_id": [1, 2]}))
    )

    # The Case Type subject reaches across to the Reference Data medallion via a
    # Reader, then joins in Python (behind the Dataset seam, as a processor
    # would).
    case_frame = cases.reader("silver", "cases").read().to_pandas()
    adviser_frame = advisers.reader("silver", "advisers").read().to_pandas()
    joined = case_frame.merge(adviser_frame, on="adviser_id")

    assert list(joined["region"]) == ["North", "South"]
    assert len(joined) == 2
