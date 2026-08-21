```python
"""The one read -> validate -> print body every item in the demo runs.

Near-identical pipelines would each be a copy of the same four lines, so the
body lives here and each ``pipeline.py`` supplies only its name and its rows.
The source is an in-memory :class:`~framework.core.Dataset` and the sink is
:class:`~framework.io.StdoutWriter`, so a demo run touches no data file at all —
the only thing that reaches disk is the run metadata the framework itself keeps.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from framework.core import Dataset, SchemaValidator
from framework.io import DatasetReader, StdoutWriter
from framework.run import Pipeline

DemoRows = tuple[tuple[str, str, int], ...]


@dataclass
class DemoCase:
    """The throwaway schema the demo rows are validated against."""

    case_ref: str
    adviser: str
    amount: int


def build(name: str, rows: DemoRows) -> Pipeline:
    """Wire the demo pipeline for one scheduled item."""
    dataset = Dataset.from_pandas(
        pd.DataFrame(list(rows), columns=["case_ref", "adviser", "amount"])
    )
    p = Pipeline(name)
    r = p.read(DatasetReader(dataset), name="read")
    v = p.validate(SchemaValidator(DemoCase), r, name="validate")
    p.write(StdoutWriter(label=f"[{name}]"), v, name="write")
    return p


def run_demo(name: str, rows: DemoRows) -> Dataset:
    """Run the demo body under the ambient run context the runner made active."""
    return build(name, rows).run()

```
