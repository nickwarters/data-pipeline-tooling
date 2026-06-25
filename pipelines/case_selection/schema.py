"""Declared schemas for the case-selection example.

Following the scaffold layout, schemas live apart from the pipeline wiring. Three
dataclasses: the two source feeds (``SalesRow`` / ``CaseReviewRow``, the silver
contracts) and the deliverable (``SelectedCase``, the ``selection_pool`` row).

``sale category`` (A/B) is the *product* category used only to tie-break two
equal-risk sales; ``case_type`` (A/B/C) is the *check* classification derived from
the risk score (and the rolling-year type-C quota). They are deliberately
distinct fields.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Annotated

from framework.core import OneOf, Range


@dataclass
class SalesRow:
    """One sale. The selection picks the highest-risk recent sale per adviser."""

    sale_id: str
    adviser: str
    sale_date: date
    risk_score: Annotated[int, Range(minimum=0)]
    category: Annotated[str, OneOf("A", "B")]
    product: str


@dataclass
class CaseReviewRow:
    """One historical (or in-progress) case review for an adviser.

    ``completed_date`` is nullable: an ``in_progress`` review has none yet (blank
    in the source), and ``outcome`` is ``"none"`` until the review completes.
    """

    case_id: str
    adviser: str
    case_type: Annotated[str, OneOf("A", "B", "C")]
    status: Annotated[str, OneOf("in_progress", "completed")]
    outcome: Annotated[str, OneOf("pass", "fail", "none")]
    selected_date: date
    completed_date: date


@dataclass
class SelectedCase:
    """One chosen Case in the ``selection_pool`` deliverable — one per adviser."""

    adviser: str
    sale_id: str
    sale_date: date
    risk_score: int
    category: Annotated[str, OneOf("A", "B")]
    case_type: Annotated[str, OneOf("A", "B", "C")]
    selected_date: date
