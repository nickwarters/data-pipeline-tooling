"""Declared schemas for the comprehensive pipeline example.

The scaffold pattern keeps schemas separate from the pipeline wiring. These
dataclasses are the silver contracts for the reference data, detail table, and
enriched case snapshot assembled by ``pipeline.py``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Annotated

from framework.transform import OneOf


@dataclass
class AdviserReference:
    adviser_id: str
    region: str
    team: str
    active_flag: bool


@dataclass
class OpenContact:
    case_ref: str
    contact_date: date
    contact_type: Annotated[str, OneOf("call", "email", "letter")]
    contact_status: Annotated[str, OneOf("open")]


@dataclass
class CaseSnapshot:
    case_ref: str
    customer_id: str
    adviser_id: str
    opened_date: date
    risk_band: Annotated[str, OneOf("low", "medium", "high")]
    vulnerable_flag: bool
    exposure_amount: int
    account_status: Annotated[str, OneOf("open", "restricted")]
    last_review_date: date
    region: str
    team: str
    open_contact_count: int
