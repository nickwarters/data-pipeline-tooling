"""High ``priority`` and no deadline.

It sorts ahead of the other deadline-free due work, and behind every overdue
item: priority never outranks a deadline.

Run it on its own with::

    python -m cli run pipelines/ordering_demo/urgent --base-dir /tmp/ordering-demo
"""

from __future__ import annotations

from framework.core import Dataset
from framework.run import RunContext

from .._demo import run_demo

ROWS = (
    ("C-400", "ferreira", 610),
    ("C-401", "andersson", 42),
)


def run(context: RunContext) -> Dataset:
    return run_demo("urgent", ROWS)
