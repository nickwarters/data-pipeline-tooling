"""Past its own deadline by an hour.

It competes with the inherited pressure on ``steady`` and ``report`` by how
overdue each one is.

Run it on its own with::

    python -m cli run pipelines/ordering_demo/overdue --base-dir /tmp/ordering-demo
"""

from __future__ import annotations

from framework.core import Dataset
from framework.run import RunContext

from .._demo import run_demo

ROWS = (
    ("C-200", "okafor", 55),
    ("C-201", "bianchi", 780),
)


def run(context: RunContext) -> Dataset:
    return run_demo("overdue", ROWS)
