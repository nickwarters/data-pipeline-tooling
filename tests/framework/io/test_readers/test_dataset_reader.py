import pandas as pd

from framework.io.dataset import Dataset
from framework.io.readers import DatasetReader


def test_dataset_reader_returns_the_dataset_it_holds():
    # The bridge that lets an already-in-memory Dataset feed the Pipeline builder
    # — Selection reads "available cases" from the CasePool (a Dataset) rather
    # than re-reading a layer, so the Selection pipeline reuses the same builder
    # (read -> process -> write) as ingest without a SQL round-trip.
    dataset = Dataset.from_pandas(pd.DataFrame({"case_ref": ["c1", "c2"]}))

    assert DatasetReader(dataset).read() is dataset
