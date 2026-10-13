```python
"""Plain-Python business rules for the comprehensive example."""

from __future__ import annotations

from typing import Any, Mapping


def high_risk_or_vulnerable(row: Mapping[str, Any]) -> bool:
    """Return whether a case belongs in the gold review queue."""
    return row["risk_band"] == "high" or bool(row["vulnerable_flag"])


def review_priority(row: Mapping[str, Any]) -> int:
    """Rank higher exposure, higher risk, and unresolved contact load first."""
    risk_weight = {"high": 100, "medium": 50, "low": 25}[row["risk_band"]]
    vulnerability_weight = 20 if row["vulnerable_flag"] else 0
    contact_weight = int(row["open_contact_count"]) * 25
    return (
        int(row["exposure_amount"] // 10)
        + risk_weight
        + vulnerability_weight
        + contact_weight
    )

```
