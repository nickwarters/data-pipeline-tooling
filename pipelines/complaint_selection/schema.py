"""Declared schema for the ``complaint_selection`` SelectionPool.

The Selection group's row contract, plus its one declared Variation and the
frozen shape a ``SELECTION_GROUP`` member takes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Mapping

from case_review.variation import Variation
from framework.io import Reader

VARIATIONS = (Variation(id="v1", question_bank_id="qb-complaints"),)


@dataclass
class SelectedComplaint:
    case_ref: str
    case_type: str
    priority_score: int
    question_bank_id: str


@dataclass(frozen=True)
class SelectionGroupMember:
    """One Case Type's contribution to the group: its reader, key, and rule."""

    case_type: str
    reader: Callable[..., Reader]
    case_ref_column: str
    priority: Callable[[Mapping[str, Any]], int]
