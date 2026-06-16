```python
"""Public facade: cross-cutting utilities shared across the pipeline.

The stable import surface for the small, cross-cutting helpers that carry a
public name but don't belong to a single task facade: targeted I/O-edge
``retry`` (``RetryPolicy`` / ``RetryingReader`` / ``RetryingWriter``) and
``WorkingDayCalendar`` availability arithmetic.

Import from here rather than the underlying modules::

    from framework.shared import RetryPolicy, WorkingDayCalendar

The modules behind this facade (``framework.shared.retry``,
``framework.shared.calendar``) are internal layout: re-exports here are the
public contract, the submodule paths are not. Purely-internal cross-cutting
helpers with no public name (``connect``, ``render``) live in
``framework._internal`` instead. See ``docs/public-api.md``.
"""

from framework.shared.calendar import WorkingDayCalendar
from framework.shared.retry import RetryingReader, RetryingWriter, RetryPolicy

__all__ = [
    "RetryPolicy",
    "RetryingReader",
    "RetryingWriter",
    "WorkingDayCalendar",
]

```
