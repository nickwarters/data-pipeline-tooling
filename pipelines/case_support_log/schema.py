"""Declarations and the silver row schema for the ``case_support_log`` feed.

See ``docs/data-dictionary-case-support-log.md`` for the field-level contract.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Annotated
from uuid import UUID

from framework.core import NonNull, OneOf

FEED_NAME = "case_support_log"

# PLACEHOLDER -- the tenant's site, as for sharepoint_cases.
SITE = "https://sharepoint.invalid/sites/REPLACE-ME"

# The per-environment list the Case Support page appends to; UAT prefixes it ``uat_``.
LIST_NAME = "CaseSupportLog"

# PLACEHOLDER -- from the list's settings page; the watermark is keyed on it.
LIST_ID = UUID(int=0)

# What became of a support action, exactly as the platform writes it.
OUTCOMES = ("recorded", "not-applied")


@dataclass
class SupportLogEntry:
    """One Support Log entry: a Maintainer's support action on one Case."""

    source_observation_id: Annotated[str, NonNull()]
    source_list_name: Annotated[str, NonNull()]
    source_item_id: Annotated[str, NonNull()]
    source_version: Annotated[str, NonNull()]
    source_modified_at: Annotated[datetime, NonNull()]

    id: Annotated[int, NonNull()]
    case_reference: Annotated[str, NonNull()]
    case_type: Annotated[str, NonNull()]
    case_id: Annotated[str, NonNull()]
    # Not a OneOf: the platform grows actions, and an unknown one is still a real entry.
    support_action: Annotated[str, NonNull()]
    reason: Annotated[str, NonNull()]
    # The JSON list of ``{field, before, after}`` the platform wrote, kept as text.
    changes: str
    outcome: Annotated[str, NonNull(), OneOf(*OUTCOMES)]
    # The id of the entry a ``not-applied`` entry follows; null on every other entry.
    relates_to: str
    created: Annotated[datetime, NonNull()]
    # The author as a claims login (identity) and a display name (for reading only).
    author_name: str
    author_title: str
