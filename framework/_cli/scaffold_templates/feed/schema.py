"""Declared schema for the ``myfeed`` feed.

A feed's schema is an ordinary dataclass: its field names are the columns the
feed must carry, and its annotations are the column/dtype contract enforced when
the feed is refined raw -> silver. Edit the fields to match your source, rename
the class, and add value-level rules as the feed needs them.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class MyfeedRow:
    record_id: str
    label: str
    amount: int
