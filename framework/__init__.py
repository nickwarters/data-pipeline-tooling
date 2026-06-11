"""Data pipeline framework.

Use the public facade modules:

- ``framework.io`` for Dataset, Readers, Writers, Store, and strategies.
- ``framework.transform`` for processors, validators, schemas, and calendar helpers.
- ``framework.run`` for Pipeline, orchestration, RunLog, and RunRegistry.
"""

from framework import io, run, transform

__all__ = ["io", "run", "transform"]
