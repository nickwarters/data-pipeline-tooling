from pipelines import demo_csv_to_raw

from framework.store import Store


def test_demo_reads_fixture_csv_and_lands_rows_in_raw(tmp_path):
    # End-to-end through the real components: CSV file -> CsvReader ->
    # Dataset -> Pipeline.write_to(Store.writer('raw', ...)).run() ->
    # raw.db on disk under the subject directory.
    dataset = demo_csv_to_raw.run(tmp_path)

    assert len(dataset) > 0
    assert (tmp_path / "raw.db").exists()

    landed = Store(tmp_path).reader("raw", demo_csv_to_raw.FEED_NAME).read()
    assert len(landed) == len(dataset)
