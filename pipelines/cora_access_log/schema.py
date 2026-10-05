"""Declarations and the silver row schema for the ``cora_access_log`` feed.

See ``docs/data-dictionary-cora-access-log.md`` for the field-level contract.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Annotated
from uuid import UUID

from framework.core import NonNull, OneOf

FEED_NAME = "cora_access_log"

# PLACEHOLDER -- the tenant's site, as for sharepoint_cases.
SITE = "https://sharepoint.invalid/sites/REPLACE-ME"

# One site-wide list, never prefixed: the groups it records span every environment.
LIST_NAME = "CoraAccessLog"

# PLACEHOLDER -- from the list's settings page; the watermark is keyed on it.
LIST_ID = UUID(int=0)

# What a change did, and what became of it, exactly as the platform writes them.
ACTIONS = ("grant", "revoke")
OUTCOMES = ("recorded", "not-applied", "partly-applied")


@dataclass
class AccessLogEntry:
    """One Access Log entry: a Maintainer giving or removing one person's CORA role."""

    source_observation_id: Annotated[str, NonNull()]
    source_list_name: Annotated[str, NonNull()]
    source_item_id: Annotated[str, NonNull()]
    source_version: Annotated[str, NonNull()]
    source_modified_at: Annotated[datetime, NonNull()]

    id: Annotated[int, NonNull()]
    # The claims login of the person whose access changed (identity).
    target_login: Annotated[str, NonNull()]
    # Their display name when the change was made, for reading only.
    target_name: str
    access_action: Annotated[str, NonNull(), OneOf(*ACTIONS)]
    # Not a OneOf: the platform grows roles, and an unknown one is still a real entry.
    access_role: Annotated[str, NonNull()]
    # The Case Type slug for a per-Case-Type role; null for a site-wide one.
    case_type: str
    reason: Annotated[str, NonNull()]
    # The JSON list of ``{field, before, after}`` naming each group, kept as text.
    changes: str
    outcome: Annotated[str, NonNull(), OneOf(*OUTCOMES)]
    # The id of the entry a not-applied or partly-applied one follows; null otherwise.
    relates_to: str
    created: Annotated[datetime, NonNull()]
    # The author as a claims login (identity) and a display name (for reading only).
    author_name: str
    author_title: str
