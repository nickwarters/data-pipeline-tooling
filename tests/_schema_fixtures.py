"""Schema fixtures defined under ``from __future__ import annotations``.

The framework uses postponed annotations throughout, so a real Case Type schema
hands ``dataclasses.fields(...).type`` back as *strings* ("str", "date", ...),
not type objects. This module reproduces that condition so the validator is
tested the way it is actually used.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass
class DeferredCase:
    case_ref: str
    opened: date
    active: bool


@dataclass
class LandedCase:
    # A schema whose declared types survive a SQLite round-trip unchanged (text
    # -> str, integer -> int), so a raw->silver run with no coercion processor
    # is a fair test of *schema enforcement* rather than of type coercion.
    case_ref: str
    score: int
