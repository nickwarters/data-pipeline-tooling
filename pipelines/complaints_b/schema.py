"""Declared schema for the ``complaints_b`` Case Type.

A Case Type's schema is an ordinary dataclass: its field names are the columns
the feed must carry, and its annotations are the column/dtype contract enforced
when the feed is refined raw -> silver. One of these fields (or a tuple of them)
is the Case Type's ``natural_key``: the stable column(s) that identify a Case.
Edit the fields to match your source, rename the class, and add value-level
rules as the feed needs them.

``TABLES`` declares the two tables this feed actually writes -- raw (schema-
light) and silver (the validated ``ComplaintsBRow`` shape) -- for
``python -m cli schema diff`` and the cross-check in
``tests/integration/test_declared_tables_match_pipelines.py``. ``SOURCE_COLUMNS``
is the one list both the raw hop's column gate (``pipeline.py``) and the raw
``Table`` read, so it is declared once here.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from framework.core import OneOf
from tools.schema import (
    ACCUMULATE_BY_RUN_CONTEXT_COLUMNS,
    Table,
    columns_of,
    text_columns,
)

# The columns the raw hop gates on, in the source's own vocabulary.
SOURCE_COLUMNS = ["record_id", "category", "priority"]


@dataclass
class ComplaintsBRow:
    record_id: str
    category: str
    priority: Annotated[str, OneOf("low", "medium", "high")]


# Both raw and silver land via AccumulateByRun.from_context(context) (see
# pipeline.py), so every row carries the stamped run columns too.
TABLES = (
    Table(
        "raw",
        "complaints_b",
        columns=text_columns(SOURCE_COLUMNS) + ACCUMULATE_BY_RUN_CONTEXT_COLUMNS,
    ),
    Table(
        "silver",
        "complaints_b",
        columns=columns_of(ComplaintsBRow) + ACCUMULATE_BY_RUN_CONTEXT_COLUMNS,
        primary_key=("record_id",),
    ),
)
