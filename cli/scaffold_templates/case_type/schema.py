"""Declared schema for the ``myfeed`` Case Type.

A Case Type's schema is an ordinary dataclass: its field names are the columns
the feed must carry, and its annotations are the column/dtype contract enforced
when the feed is refined raw -> silver. One of these fields (or a tuple of them)
is the Case Type's ``natural_key``: the stable column(s) that identify a Case.
Edit the fields to match your source, rename the class, and add value-level
rules as the feed needs them.

``TABLES`` declares raw and silver (both land via ``AccumulateByRun``, so they
share ``MyfeedRow``'s columns) and, since ``silver_builder`` always wires a
``reject_writer``, its quarantine landing site too -- this variant stops at
silver, so there is no gold table to declare yet (see ``pipeline.py``).
``python -m cli scaffold --case-type`` generates this feed's first migrations
from this tuple, so ``migrate`` then ``run`` works before you change a thing.
"""

from __future__ import annotations

from dataclasses import dataclass

from tools.schema import (
    ACCUMULATE_BY_RUN_CONTEXT_COLUMNS,
    Table,
    columns_of,
    quarantine_table,
)


@dataclass
class MyfeedRow:
    record_id: str
    label: str
    amount: int


TABLES = (
    Table(
        "raw",
        "myfeed",
        columns=columns_of(MyfeedRow) + ACCUMULATE_BY_RUN_CONTEXT_COLUMNS,
    ),
    Table(
        "silver",
        "myfeed",
        columns=columns_of(MyfeedRow) + ACCUMULATE_BY_RUN_CONTEXT_COLUMNS,
    ),
    quarantine_table("myfeed", row=MyfeedRow),
)
