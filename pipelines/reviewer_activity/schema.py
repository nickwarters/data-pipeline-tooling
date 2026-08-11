"""Declared schema for the reviewer activity gold aggregate."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Annotated

from framework.core import Length, NonNull, Range


@dataclass
class ReviewerActivityDaily:
    """One sparse reviewer activity count for a local reportable date."""

    reviewer_account: Annotated[str, NonNull()]
    reportable_date: Annotated[date, NonNull()]
    case_type: Annotated[str, NonNull(), Length(minimum=1)]
    count: Annotated[int, NonNull(), Range(minimum=1)]
    as_of_utc: Annotated[str, NonNull()]
