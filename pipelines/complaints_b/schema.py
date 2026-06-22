"""Declared schema for the ``complaints_b`` Case Type.

A Case Type's schema is an ordinary dataclass: its field names are the columns
the feed must carry, and its annotations are the column/dtype contract enforced
when the feed is refined raw -> silver. One of these fields (or a tuple of them)
is the Case Type's ``natural_key``: the stable column(s) that identify a Case.
Edit the fields to match your source, rename the class, and add value-level
rules as the feed needs them.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from framework.core.value_rules import OneOf


@dataclass
class ComplaintsBRow:
    record_id: str
    category: str
    priority: Annotated[str, OneOf("low", "medium", "high")]
