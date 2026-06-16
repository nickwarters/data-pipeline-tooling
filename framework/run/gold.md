```python
"""Compatibility imports for medallion recipes.

The implementation lives in :mod:`framework.recipes.medallion`; this module
keeps the original import path stable while recipes move out of the run engine.
"""

from framework.recipes.medallion import (
    current_silver_to_gold,
    detail_current_silver_to_gold,
    silver_to_gold,
)

__all__ = [
    "silver_to_gold",
    "current_silver_to_gold",
    "detail_current_silver_to_gold",
]

```
