"""Past its own deadline by two hours.

Run it on its own with::

    python -m cli run pipelines/demo_very_overdue --base-dir /tmp/ordering-demo
"""

from __future__ import annotations

from framework.core import Dataset
from framework.run import RunContext
from pipelines.ordering_demo._demo import run_demo

ROWS = (
    ("C-600", "delacroix", 915),
    ("C-601", "obi", 77),
)


def run(context: RunContext) -> Dataset:
    return run_demo("demo_very_overdue", ROWS)
