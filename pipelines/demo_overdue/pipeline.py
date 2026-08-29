"""Past its own deadline by an hour.

Run it on its own with::

    python -m cli run pipelines/demo_overdue --base-dir /tmp/ordering-demo
"""

from __future__ import annotations

from framework.core import Dataset
from framework.run import RunContext
from pipelines.ordering_demo._demo import run_demo

ROWS = (
    ("C-200", "okafor", 55),
    ("C-201", "bianchi", 780),
)


def run(context: RunContext) -> Dataset:
    return run_demo("demo_overdue", ROWS)
