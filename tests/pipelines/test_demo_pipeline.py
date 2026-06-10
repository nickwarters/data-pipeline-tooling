from pipelines import demo_csv_to_raw

from framework.io import RAW, StoreCatalog
from framework.testing import read_rows, read_run_log


def test_demo_reads_fixture_csv_and_lands_rows_in_raw(tmp_path):
    # End-to-end through the real components: CSV file -> CsvReader ->
    # Dataset -> Pipeline.write_to(Store.writer(RAW, ...)).run() ->
    # raw.db on disk under the catalog's subject directory.
    dataset = demo_csv_to_raw.run(tmp_path)

    assert len(dataset) > 0
    assert (tmp_path / demo_csv_to_raw.FEED_NAME / "raw.db").exists()

    store = StoreCatalog(tmp_path).store(demo_csv_to_raw.FEED_NAME)
    landed = read_rows(store, RAW, demo_csv_to_raw.FEED_NAME)
    assert len(landed) == len(dataset)


def test_demo_warns_on_raw_schema_drift_between_runs(tmp_path):
    # First run lands a baseline shape (no prior → drift check is a clean no-op);
    # a second run from a drifted source warns (does not abort) and the warning
    # is recorded in the run log, where the run registry can flag it (#51).
    demo_csv_to_raw.run(tmp_path)  # baseline landing, no prior

    drifted = tmp_path / "drifted.csv"
    # Drop `amount`, add `region` vs the sample feed's columns.
    drifted.write_text("case_id,advisor,activity_date,region\n1,a,2026-01-01,North\n")
    dataset = demo_csv_to_raw.run(tmp_path, csv_path=drifted)

    # The run still completes (warn, not abort) and lands the drifted shape.
    assert "region" in dataset.columns

    records = read_run_log(tmp_path / demo_csv_to_raw.RUN_LOG_NAME)
    warns = [w for r in records for w in r["warn_hits"]]
    assert any("schema drift" in w and "added [region]" in w and "dropped [amount]" in w for w in warns)
