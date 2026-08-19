"""Declared schema for the ``complaint_selection`` SelectionPool.

The Selection group's row contract, plus its one declared Variation, the
frozen shape a ``SELECTION_GROUP`` member takes, and a pending void as
``pending_voids`` resolves it against the pool.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Mapping

from case_review.variation import Variation
from framework.io import Reader

VARIATIONS = (Variation(id="v1", question_bank_id="qb-complaints"),)


@dataclass
class SelectedComplaint:
    case_ref: str
    case_type: str
    priority_score: int
    # Nullable (plain str, not Optional -- the repo's convention): populated
    # only once a feed carries the real attribute, and only for a Case chosen
    # as a void's replacement, respectively.
    attribute_a: str
    related_date: str
    replaces_case_ref: str
    void_match_rung: str
    question_bank_id: str


@dataclass(frozen=True)
class SelectionGroupMember:
    """One Case Type's contribution to the group: its reader, key, and rule."""

    case_type: str
    reader: Callable[..., Reader]
    case_ref_column: str
    priority: Callable[[Mapping[str, Any]], int]


@dataclass(frozen=True)
class PendingVoid:
    """A void since the previous run, joined to what the pool selected it as.

    ``attributes`` holds the void's recorded pool values for every field
    ``MATCH_LADDER`` names -- what ``assign_replacements`` compares a
    candidate row against, rung by rung.
    """

    case_ref: str
    voided_at: datetime
    attributes: Mapping[str, Any]
