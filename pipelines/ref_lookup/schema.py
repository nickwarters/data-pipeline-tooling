"""Declared schemas for the ref_lookup pipeline.

Three silver tables are produced:

- ``ref``: the shared reference lookup — one row per (ref_group, value) pair,
  with a stable MD5-derived id.
- ``cases``: one row per case, carrying only the case/customer refs and the
  ref-table ids for each category field (no raw category strings).
- ``customers``: one distinct row per customer ref.
"""

from __future__ import annotations

from dataclasses import dataclass

from tools.schema import ACCUMULATE_BY_RUN_CONTEXT_COLUMNS, Table, text_columns

from .processors import SOURCE_COLUMNS


@dataclass
class RefRow:
    id: str
    ref_group: str
    value: str


@dataclass
class CasesRow:
    case_ref: str
    cust_ref: str
    brand_id: str
    channel_id: str
    case_cat_1_id: str | None
    case_cat_2_id: str | None
    case_cat_3_id: str | None


@dataclass
class CustomerRow:
    cust_ref: str


# raw lands via AccumulateByRun.from_context(context) (see pipeline.py), so
# every row carries the stamped run columns too; silver's three tables land via
# Refresh() instead, so they carry no such stamps.
TABLES = (
    Table(
        "raw",
        "source",
        columns=text_columns(SOURCE_COLUMNS) + ACCUMULATE_BY_RUN_CONTEXT_COLUMNS,
    ),
    Table("silver", "ref", row=RefRow, primary_key=("id",)),
    Table("silver", "cases", row=CasesRow, primary_key=("case_ref",)),
    Table("silver", "customers", row=CustomerRow, primary_key=("cust_ref",)),
)
