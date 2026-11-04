```python
import pandas as pd

from framework.core.dataset import Dataset
from framework.io.readers import DatasetReader


def test_dataset_reader_returns_the_dataset_it_holds():
    # In-memory data enters the same builder without a SQL round trip.
    dataset = Dataset.from_pandas(pd.DataFrame({"case_ref": ["c1", "c2"]}))

    assert DatasetReader(dataset).read() is dataset


def test_dataset_reader_reports_no_data_location():
    reader = DatasetReader(Dataset.from_pandas(pd.DataFrame({"case_ref": ["c1"]})))
    reader.read()

    # It holds an in-memory dataset and touches nothing, so it names nothing.
    assert not hasattr(reader, "data_locations")

```
