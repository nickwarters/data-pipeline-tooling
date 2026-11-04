```python
"""CLI-test downstream gated on ``_source`` freshness."""

from __future__ import annotations

import pandas as pd

from framework.core import Dataset
from framework.io import AccumulateByRun, DatasetReader
from framework.run import FreshnessRequirement, Pipeline, RunContext
from tools.medallion import medallion
from tools.store import StoreRegistry

SUBJECT = "fixture"

# Gated on the source pipeline above; with only stale `_source` history the run
# must abort before the handler does any work.
UPSTREAMS = (FreshnessRequirement(upstream_pipeline="_source"),)


def run(context: RunContext) -> Dataset:
    """Land two rows into `<base_dir>/fixture/gold.db`, accumulated by run."""
    med = medallion(StoreRegistry(context.base_dir), SUBJECT)
    strategy = AccumulateByRun.from_context(context)
    source = Dataset.from_pandas(pd.DataFrame({"case_ref": ["c1", "c2"]}))

    p = Pipeline(SUBJECT)
    r = p.read(DatasetReader(source), name="read")
    p.write(med.gold.writer("pool", strategy), r, name="write")
    result = p.run()

    print(f"FixturePool: {len(result)} rows")
    return result

```
