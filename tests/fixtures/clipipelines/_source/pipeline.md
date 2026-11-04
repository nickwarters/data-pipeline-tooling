```python
"""CLI-test source that lands fixture rows."""

from __future__ import annotations

import pandas as pd

from framework.core import Dataset
from framework.io import AccumulateByRun, DatasetReader
from framework.run import Pipeline, RunContext
from tools.medallion import medallion
from tools.store import StoreRegistry

# Neutral subject so the fixture owns its own medallion tree, distinct from the
# real demo's "cases".
SUBJECT = "fixture"

# This pipeline is the source of its own data -- nothing upstream to gate on.
UPSTREAMS = ()


def run(context: RunContext) -> Dataset:
    """Land two rows into `<base_dir>/fixture/raw.db`, accumulated by run."""
    med = medallion(StoreRegistry(context.base_dir), SUBJECT)
    strategy = AccumulateByRun.from_context(context)
    source = Dataset.from_pandas(pd.DataFrame({"case_ref": ["c1", "c2"]}))

    p = Pipeline(SUBJECT)
    r = p.read(DatasetReader(source), name="read")
    p.write(med.raw.writer("cases", strategy), r, name="write")
    result = p.run()

    print(f"FixtureSource: landed {len(result)} rows into {SUBJECT}/raw")
    if "source_file" in context.params:
        print(f"source_file={context.params['source_file']}")
    return result

```
