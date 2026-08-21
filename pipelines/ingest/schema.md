```python
"""Schema, identity, and Variation declarations for the demo Case feed."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from case_review.variation import Variation

NAMESPACE = "cases"
NATURAL_KEY = ("case_ref",)
VARIATIONS = (
    Variation(id="v1", question_bank_id="qb-100"),
    Variation(id="v2", question_bank_id="qb-200"),
)


@dataclass
class ActivityCase:
    """The demo Case Type's schema: an activity-dated, advised, valued Case."""

    case_ref: str
    adviser: str
    activity_date: date
    amount: int

```
