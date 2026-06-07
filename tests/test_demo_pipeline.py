from pipelines import demo_csv_to_raw

from framework.store import RAW, StoreCatalog


def test_demo_reads_fixture_csv_and_lands_rows_in_raw(tmp_path):
    # End-to-end through the real components: CSV file -> CsvReader ->
    # Dataset -> Pipeline.write_to(Store.writer(RAW, ...)).run() ->
    # raw.db on disk under the catalog's subject directory.
    dataset = demo_csv_to_raw.run(tmp_path)

    assert len(dataset) > 0
    assert (tmp_path / demo_csv_to_raw.FEED_NAME / "raw.db").exists()

    landed = (
        StoreCatalog(tmp_path)
        .store(demo_csv_to_raw.FEED_NAME)
        .reader(RAW, demo_csv_to_raw.FEED_NAME)
        .read()
    )
    assert len(landed) == len(dataset)
