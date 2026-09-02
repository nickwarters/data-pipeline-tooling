"""Not due today at all.

Run it on its own with::

    python -m cli run pipelines/demo_tomorrow --base-dir /tmp/ordering-demo
"""

from __future__ import annotations

from framework.core import Dataset
from framework.run import RunContext
from pipelines.ordering_demo._demo import run_demo

ROWS = (
    ("C-600", "kowalski", 77),
    ("C-601", "haddad", 158),
)


def run(context: RunContext) -> Dataset:
    return run_demo("demo_tomorrow", ROWS)
