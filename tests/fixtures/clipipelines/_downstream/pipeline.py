"""A minimal downstream pipeline for CLI tests: gated on `_source` freshness.

Stands in for "the real selection pipeline" wherever a CLI test needs a pipeline
that (a) declares a freshness upstream so the stale-upstream abort path runs, and
(b) writes an accumulated gold table so a re-drive under one `--logical-run-id`
can be read back and asserted on. As with `_source`, the computation is trivial;
the CLI tests assert on the plumbing.
"""

from __future__ import annotations

import pandas as pd

from framework.core import GOLD, Dataset
from framework.io import AccumulateByRun, DatasetReader, StoreCatalog
from framework.run import FreshnessRequirement, Pipeline, RunContext

SUBJECT = "fixture"

# Gated on the source pipeline above; with only stale `_source` history the run
# must abort before the handler does any work.
UPSTREAMS = (FreshnessRequirement(upstream_pipeline="_source"),)


def run(context: RunContext) -> Dataset:
    """Land two rows into `<base_dir>/fixture/gold.db`, accumulated by run."""
    store = StoreCatalog(context.base_dir).store(SUBJECT)
    strategy = AccumulateByRun.from_context(context)
    source = Dataset.from_pandas(pd.DataFrame({"case_ref": ["c1", "c2"]}))

    p = Pipeline(SUBJECT)
    r = p.read(DatasetReader(source), name="read")
    p.write(store.writer(GOLD, "pool", strategy), r, name="write")
    result = p.run()

    print(f"FixturePool: {len(result)} rows")
    return result
