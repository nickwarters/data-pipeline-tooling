```python
"""Data pipeline framework.

Use the public facade modules:

- ``framework.core`` for Dataset and the schema/validation contracts — the
  foundational vocabulary the other facades build on.
- ``framework.io`` for Readers, Writers, the namespace Store, and strategies.
- ``framework.transform`` for the reshaping processors and SchemaCoercion.
- ``framework.run`` for Pipeline, orchestration, RunLog, and RunRegistry.

(The ``validate(dataset)`` checks and the declared-schema contract live on
``framework.core`` — the ``validate`` facade was folded into ``core``.)

(``tests.framework_testing`` is a separate test-only surface; ``framework._internal``
is private layout.)
"""

from framework import core, io, run, transform

__all__ = ["core", "io", "transform", "run"]

```
