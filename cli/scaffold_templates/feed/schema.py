"""Declared schema for the ``myfeed`` feed.

A feed's schema is an ordinary dataclass: its field names are the columns the
feed must carry, and its annotations are the column/dtype contract enforced when
the feed is refined raw -> silver. Edit the fields to match your source, rename
the class, and add value-level rules as the feed needs them.

``TABLES`` declares every table this feed writes -- raw, silver, gold (all three
land via ``AccumulateByRun``/``Refresh``, so they share ``MyfeedRow``'s columns)
and, since ``silver_builder`` always wires a ``reject_writer``, its quarantine
landing site too -- for ``python -m cli schema diff``/``migrate`` and the
cross-check in ``tests/integration/test_declared_tables_match_pipelines.py``.
``python -m cli scaffold`` generates this feed's first migrations from this
tuple, so ``migrate`` then ``run`` works before you change a thing.
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
    # gold_builder is a passthrough stub today, so its shape matches silver's
    # (run-stamp columns included) until you build out the real assembly.
    Table(
        "gold",
        "myfeed",
        columns=columns_of(MyfeedRow) + ACCUMULATE_BY_RUN_CONTEXT_COLUMNS,
    ),
    quarantine_table("myfeed", row=MyfeedRow),
)
