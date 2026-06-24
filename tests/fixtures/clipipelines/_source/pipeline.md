```python
"""A minimal source pipeline for CLI tests: lands one raw table, no upstream.

Stands in for "the real ingest pipeline" wherever a CLI test only needs *a*
pipeline that runs cleanly and leaves landed evidence behind (a `raw.db` under
its subject, a run in the registry). The behaviour is deliberately trivial; what
the CLI tests assert on is the plumbing around it, not what this computes.
"""

from __future__ import annotations

import pandas as pd

from framework.core import RAW, Dataset
from framework.io import AccumulateByRun, DatasetReader, StoreCatalog
from framework.run import Pipeline, RunContext

# Neutral subject so the fixture owns its own medallion tree, distinct from the
# real demo's "cases".
SUBJECT = "fixture"

# This pipeline is the source of its own data -- nothing upstream to gate on.
UPSTREAMS = ()


def run(context: RunContext) -> Dataset:
    """Land two rows into `<base_dir>/fixture/raw.db`, accumulated by run."""
    store = StoreCatalog(context.base_dir).store(SUBJECT)
    strategy = AccumulateByRun.from_context(context)
    source = Dataset.from_pandas(pd.DataFrame({"case_ref": ["c1", "c2"]}))

    p = Pipeline(SUBJECT)
    r = p.read(DatasetReader(source), name="read")
    p.write(store.writer(RAW, "cases", strategy), r, name="write")
    result = p.run()

    print(f"FixtureSource: landed {len(result)} rows into {SUBJECT}/raw")
    if "source_file" in context.params:
        print(f"source_file={context.params['source_file']}")
    return result

```
