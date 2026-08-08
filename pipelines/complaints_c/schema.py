"""Declared schema for the ``complaints_c`` Case Type."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from framework.core import Range

NAMESPACE = "complaints_c"
NATURAL_KEY = ("record_id",)


@dataclass
class ComplaintsCRow:
    record_id: str
    department: str
    resolution_days: Annotated[int, Range(minimum=0, maximum=365)]
