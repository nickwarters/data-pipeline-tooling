```python
"""Declared schemas for the ref_lookup pipeline.

Three silver tables are produced:

- ``ref``: the shared reference lookup — one row per (ref_group, value) pair,
  with a stable MD5-derived id.
- ``cases``: one row per case, carrying only the case/customer refs and the
  ref-table ids for each category field (no raw category strings).
- ``customers``: one distinct row per customer ref.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class RefRow:
    id: str
    ref_group: str
    value: str


@dataclass
class CasesRow:
    case_ref: str
    cust_ref: str
    brand_id: str
    channel_id: str
    case_cat_1_id: str | None
    case_cat_2_id: str | None
    case_cat_3_id: str | None


@dataclass
class CustomerRow:
    cust_ref: str

```
