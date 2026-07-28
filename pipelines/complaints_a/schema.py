"""Declared schema for the ``complaints_a`` Case Type.

A Case Type's schema is an ordinary dataclass: its field names are the columns
the feed must carry, and its annotations are the column/dtype contract enforced
when the feed is refined raw -> silver. One of these fields (or a tuple of them)
is the Case Type's ``natural_key``: the stable column(s) that identify a Case.
Edit the fields to match your source, rename the class, and add value-level
rules as the feed needs them.

``TABLES`` declares the two tables this feed actually writes -- raw and silver,
both the validated ``ComplaintsARow`` shape (``CsvReader`` infers dtypes on
read, so raw already lands typed, not text) -- for ``python -m cli schema
diff`` and the cross-check in
``tests/integration/test_declared_tables_match_pipelines.py``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from framework.core import Range
from tools.schema import ACCUMULATE_BY_RUN_CONTEXT_COLUMNS, Table, columns_of

# The columns the raw hop gates on, in the source's own vocabulary.
SOURCE_COLUMNS = ["record_id", "label", "amount"]


@dataclass
class ComplaintsARow:
    record_id: str
    label: str
    amount: Annotated[int, Range(minimum=0, maximum=100)]


# Both raw and silver land via AccumulateByRun.from_context(context) (see
# pipeline.py), so every row carries the stamped run columns too.
TABLES = (
    # CsvReader infers dtypes on read (unlike StrictCsvReader's pure text), so
    # raw's ``amount`` already lands INTEGER -- the same shape as silver here,
    # since this feed has no date field for coercion to diverge on.
    Table(
        "raw",
        "complaints_a",
        columns=columns_of(ComplaintsARow) + ACCUMULATE_BY_RUN_CONTEXT_COLUMNS,
    ),
    Table(
        "silver",
        "complaints_a",
        columns=columns_of(ComplaintsARow) + ACCUMULATE_BY_RUN_CONTEXT_COLUMNS,
        primary_key=("record_id",),
    ),
)
