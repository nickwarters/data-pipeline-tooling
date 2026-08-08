"""Past its own deadline by two hours.

Declared last in the set and still attempted first: nothing in the pool presses
harder, and no dependency holds it back.

Run it on its own with::

    python -m cli run pipelines/ordering_demo/very_overdue --base-dir /tmp/ordering-demo
"""

from __future__ import annotations

from framework.core import Dataset
from framework.run import RunContext

from .._demo import run_demo

ROWS = (
    ("C-600", "delacroix", 915),
    ("C-601", "obi", 77),
)


def run(context: RunContext) -> Dataset:
    return run_demo("very_overdue", ROWS)
