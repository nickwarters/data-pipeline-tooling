"""Declared schema for the ``complaints_c`` Case Type.

``TABLES`` declares the two tables this feed actually writes -- raw and silver,
both the validated ``ComplaintsCRow`` shape (``CsvReader`` infers dtypes on
read, so raw already lands typed, not text) -- for ``python -m cli schema
diff`` and the cross-check in
``tests/integration/test_declared_tables_match_pipelines.py``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from framework.core import Range
from tools.schema import (
    ACCUMULATE_BY_RUN_CONTEXT_COLUMNS,
    Table,
    columns_of,
    quarantine_table,
)

# The columns the raw hop gates on, in the source's own vocabulary.
SOURCE_COLUMNS = ["record_id", "department", "resolution_days"]


@dataclass
class ComplaintsCRow:
    record_id: str
    department: str
    resolution_days: Annotated[int, Range(minimum=0, maximum=365)]


# Both raw and silver land via AccumulateByRun.from_context(context) (see
# pipeline.py), so every row carries the stamped run columns too.
TABLES = (
    Table(
        "raw",
        "complaints_c",
        columns=columns_of(ComplaintsCRow) + ACCUMULATE_BY_RUN_CONTEXT_COLUMNS,
    ),
    Table(
        "silver",
        "complaints_c",
        columns=columns_of(ComplaintsCRow) + ACCUMULATE_BY_RUN_CONTEXT_COLUMNS,
        primary_key=("record_id",),
    ),
    # silver's reject_writer (pipeline.py) quarantines against this same
    # schema, so its landing site's shape is ComplaintsCRow's columns plus the
    # framework-owned quarantine columns (see quarantine_table).
    quarantine_table("complaints_c", row=ComplaintsCRow),
)
