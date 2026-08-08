"""The deadline-free item every other item is measured against.

It declares no ``due_time`` of its own, yet is ordered under deadline
pressure because ``demo_report`` depends on it and a deadline inherits up the
dependency graph.

Run it on its own with::

    python -m cli run pipelines/demo_steady --base-dir /tmp/ordering-demo
"""

from __future__ import annotations

from framework.core import Dataset
from framework.run import RunContext
from pipelines.ordering_demo._demo import run_demo

ROWS = (
    ("C-100", "hall", 120),
    ("C-101", "nkiru", 340),
)


def run(context: RunContext) -> Dataset:
    return run_demo("demo_steady", ROWS)
