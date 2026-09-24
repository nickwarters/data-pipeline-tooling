```python
"""Data pipeline framework.

Use the public facade modules:

- ``framework.core`` for Dataset and the schema/validation contracts — the
  foundational vocabulary the other facades build on.
- ``framework.io`` for Readers, Writers, and load strategies.
- ``framework.transform`` for the reshaping processors and SchemaCoercion.
- ``framework.run`` for Pipeline composition/execution and run observability
  (RunLog and RunRegistry).

(``tests.framework_testing`` is a separate test-only surface; ``framework._internal``
is private layout.)
"""

from framework import core, io, run, transform

__all__ = ["core", "io", "transform", "run"]

```
