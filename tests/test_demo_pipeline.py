from pipelines import demo_csv_to_raw

from framework.store import Store


def test_demo_reads_fixture_csv_and_lands_rows_in_raw(tmp_path):
    # End-to-end through the real components: CSV file -> CsvReader ->
    # DataHandle -> Pipeline.to('raw') -> Store -> raw.db on disk.
    handle = demo_csv_to_raw.run(tmp_path)

    assert len(handle) > 0
    assert (tmp_path / "raw.db").exists()

    landed = Store(tmp_path).read("raw", demo_csv_to_raw.FEED_NAME)
    assert len(landed) == len(handle)
