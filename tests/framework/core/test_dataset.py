import pandas as pd

from framework.core.dataset import Dataset


def _make() -> Dataset:
    return Dataset.from_pandas(pd.DataFrame({"x": [1, 2, 3]}))


class TestToPandasCopy:
    def test_default_returns_copy(self):
        ds = _make()
        frame = ds.to_pandas()
        frame["x"] = 99
        assert ds.to_pandas()["x"].tolist() == [1, 2, 3]

    def test_copy_false_returns_live_frame(self):
        ds = _make()
        frame = ds.to_pandas(copy=False)
        frame["x"] = 99
        assert ds.to_pandas(copy=False)["x"].tolist() == [99, 99, 99]
