"""Schema fixtures defined under ``from __future__ import annotations``.

The framework uses postponed annotations throughout, so a real Case Type schema
hands ``dataclasses.fields(...).type`` back as *strings* ("str", "date", ...),
not type objects. This module reproduces that condition so the validator is
tested the way it is actually used.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Annotated

from framework.validate import OneOf, Pattern, Unique


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


@dataclass
class ActivityCase:
    # The Case Type for the domain capstone: an activity-dated Case with an
    # adviser and an amount, so availability (a working-day window on
    # activity_date) and selection (filter/score on amount) both have something
    # to bite on. activity_date round-trips through SQLite as text, so the
    # CasePool re-coerces it on read — exercising the typed-on-demand edge.
    case_ref: str
    adviser: str
    activity_date: date
    amount: int


@dataclass
class CoercedCase:
    # A schema whose declared types do NOT survive a SQLite round-trip: dates
    # land as text and booleans as 1/0 or TRUE/FALSE. Exercises the raw->silver
    # coercion processor end-to-end ahead of the schema post-validator.
    case_ref: str
    opened: date
    active: bool


@dataclass
class RuledCase:
    # Value-level rules attached via Annotated on a module that uses
    # `from __future__ import annotations`, so the rule-bearing hints arrive as
    # strings the validator must resolve with include_extras. The realistic
    # condition for the value-rule contract, mirroring DeferredCase for dtypes.
    case_ref: Annotated[str, Pattern(r"\d{9,10}"), Unique()]
    status: Annotated[str, OneOf("open", "closed")]
