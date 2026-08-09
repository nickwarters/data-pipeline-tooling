"""Declared schema and identity for the ``myfeed`` Case Type.

A Case Type's schema is an ordinary dataclass: its field names are the columns
the feed must carry, and its annotations are the column/dtype contract enforced
when the feed is refined raw -> silver. One of these fields (or a tuple of them)
is named in ``NATURAL_KEY``: the stable column(s) that identify a Case. The
``NAMESPACE`` separates those identities from every other Case Type. Edit the
fields and identity declarations to match your source, rename the class, and
add value-level rules as the feed needs them.
"""

from __future__ import annotations

from dataclasses import dataclass

NAMESPACE = "myfeed"
NATURAL_KEY = ("record_id",)


@dataclass
class MyfeedRow:
    record_id: str
    label: str
    amount: int
