"""High ``priority`` and no deadline.

It sorts ahead of the other deadline-free due work, and behind every overdue
item: priority never outranks a deadline.

Run it on its own with::

    python -m cli run pipelines/demo_urgent --base-dir /tmp/ordering-demo
"""

from __future__ import annotations

from framework.core import Dataset
from framework.run import RunContext
from pipelines.ordering_demo._demo import run_demo

ROWS = (
    ("C-400", "ferreira", 610),
    ("C-401", "andersson", 42),
)


def run(context: RunContext) -> Dataset:
    return run_demo("demo_urgent", ROWS)
