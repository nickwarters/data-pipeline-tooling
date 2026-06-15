"""Data pipeline framework.

Use the public facade modules:

- ``framework.core`` for Dataset and the medallion Layer constants — the
  foundational vocabulary the other facades build on.
- ``framework.io`` for Readers, Writers, Store, and strategies.
- ``framework.transform`` for the reshaping processors and SchemaCoercion.
- ``framework.validate`` for the ``validate(dataset)`` checks and the
  declared-schema contract.
- ``framework.run`` for Pipeline, orchestration, RunLog, and RunRegistry.
- ``framework.shared`` for cross-cutting utilities (retry, WorkingDayCalendar).

(``framework.testing`` is a separate test-only surface; ``framework._internal``
is private layout.)
"""

from framework import core, io, run, shared, transform, validate

__all__ = ["core", "io", "transform", "validate", "run", "shared"]
