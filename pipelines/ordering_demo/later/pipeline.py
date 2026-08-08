"""Due today, but gated by an ``earliest_run`` an hour away.

It is not attempted this pass at all, and is recorded ``skipped`` with the
window that held it back named in its reason.

Run it on its own with::

    python -m cli run pipelines/ordering_demo/later --base-dir /tmp/ordering-demo
"""

from __future__ import annotations

from framework.core import Dataset
from framework.run import RunContext

from .._demo import run_demo

ROWS = (
    ("C-300", "novak", 15),
    ("C-301", "dubois", 96),
)


def run(context: RunContext) -> Dataset:
    return run_demo("later", ROWS)
