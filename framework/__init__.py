"""Data pipeline framework.

Use the public facade modules:

- ``framework.io`` for Dataset, Readers, Writers, Store, and strategies.
- ``framework.transform`` for processors and the schema adapter.
- ``framework.validate`` for the ``validate(dataset)`` checks.
- ``framework.run`` for Pipeline, orchestration, RunLog, and RunRegistry.
- ``framework.shared`` for cross-cutting utilities (retry, WorkingDayCalendar).

(``framework.testing`` is a separate test-only surface; ``framework._internal``
is private layout.)
"""

from framework import io, run, shared, transform, validate

__all__ = ["io", "transform", "validate", "run", "shared"]
