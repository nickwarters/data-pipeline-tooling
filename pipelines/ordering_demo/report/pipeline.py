"""Overdue, and dependent on ``steady``.

Dependency order dominates deadline pressure, so ``steady`` is attempted
first however tight this deadline is.

Run it on its own with::

    python -m cli run pipelines/ordering_demo/report --base-dir /tmp/ordering-demo
"""

from __future__ import annotations

from framework.core import Dataset
from framework.run import RunContext

from .._demo import run_demo

ROWS = (
    ("C-500", "yamamoto", 205),
    ("C-501", "moreau", 33),
)


def run(context: RunContext) -> Dataset:
    return run_demo("report", ROWS)
