"""Declared schemas for the comprehensive pipeline example.

The scaffold pattern keeps schemas separate from the pipeline wiring. These
dataclasses are the silver contracts for the reference data, detail table, and
enriched case snapshot assembled by ``pipeline.py``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Annotated

from framework.core import OneOf
from tools.schema import ACCUMULATE_BY_RUN_COLUMNS, Column, Table, columns_of, retype


@dataclass
class AdviserReference:
    adviser_id: str
    region: str
    team: str
    active_flag: bool


@dataclass
class OpenContact:
    case_ref: str
    contact_date: date
    contact_type: Annotated[str, OneOf("call", "email", "letter")]
    contact_status: Annotated[str, OneOf("open")]


@dataclass
class CaseSnapshot:
    case_ref: str
    customer_id: str
    adviser_id: str
    opened_date: date
    risk_band: Annotated[str, OneOf("low", "medium", "high")]
    vulnerable_flag: bool
    exposure_amount: int
    account_status: Annotated[str, OneOf("open", "restricted")]
    last_review_date: date
    region: str
    team: str
    open_contact_count: int


# The bundled sources' raw columns -- gate nothing today (``_land_raw`` lands
# each faithfully with no ColumnValidator), but declared here so
# ``python -m cli schema diff`` can see raw drift too. Each is a *subset* of
# its silver dataclass's fields (the silver hop joins/derives the rest), so
# there is no row dataclass to derive them from; ``CsvReader`` infers dtypes on
# read, so a bool/int source column already lands typed, not text -- only the
# date columns stay text (unparsed) until silver's SchemaCoercion.
_CASES_RAW_COLUMNS = (
    Column("case_ref", "TEXT"),
    Column("customer_id", "TEXT"),
    Column("adviser_id", "TEXT"),
    Column("opened_date", "TEXT"),
    Column("risk_band", "TEXT"),
    Column("vulnerable_flag", "INTEGER"),
    Column("exposure_amount", "INTEGER"),
)
_ACCOUNTS_RAW_COLUMNS = (
    Column("customer_id", "TEXT"),
    Column("account_status", "TEXT"),
    Column("last_review_date", "TEXT"),
)
_CONTACTS_RAW_COLUMNS = (
    Column("case_ref", "TEXT"),
    Column("contact_date", "TEXT"),
    Column("contact_type", "TEXT"),
    Column("contact_status", "TEXT"),
)
_ADVISERS_RAW_COLUMNS = (
    Column("adviser_id", "TEXT"),
    Column("region", "TEXT"),
    Column("team", "TEXT"),
    Column("active_flag", "INTEGER"),
)

# This example spans three subjects (case_med / adviser_med / reporting_med in
# ``pipeline.py``), none of which is this package's own directory name, so
# every Table below names its full "<subject>/<layer>" namespace explicitly --
# the "platform namespace" form -- rather than the bare layer name a
# single-subject feed uses.
TABLES = (
    Table("complex_cases/raw", "cases", columns=_CASES_RAW_COLUMNS),
    Table("complex_cases/raw", "accounts", columns=_ACCOUNTS_RAW_COLUMNS),
    Table("complex_cases/raw", "contacts", columns=_CONTACTS_RAW_COLUMNS),
    Table("adviser_reference/raw", "advisers", columns=_ADVISERS_RAW_COLUMNS),
    Table(
        "adviser_reference/silver",
        "advisers",
        row=AdviserReference,
        primary_key=("adviser_id",),
    ),
    # Both silver joins coerce their date column to a real ``date`` right
    # before this write (SchemaCoercion), which pandas' to_sql types
    # TIMESTAMP. ``case_snapshot``'s adviser join also brings in
    # ``active_flag`` (AdviserReference's own field), which CaseSnapshot never
    # declares -- a genuine extra column, so it is declared explicitly here
    # rather than silently left undeclared.
    Table(
        "complex_cases/silver",
        "open_contacts",
        columns=retype(columns_of(OpenContact), contact_date="TIMESTAMP"),
    ),
    Table(
        "complex_cases/silver",
        "case_snapshot",
        columns=retype(
            columns_of(CaseSnapshot),
            opened_date="TIMESTAMP",
            last_review_date="TIMESTAMP",
        )
        + (Column("active_flag", "INTEGER"),),
        primary_key=("case_ref",),
    ),
    # The two gold reporting tables have no row dataclass of their own -- each
    # is an ad hoc aggregation (``rules.review_priority`` / ``AdviserSummary``
    # in ``processors.py``) -- so their columns are spelled out explicitly.
    # Both land via a bare AccumulateByRun(logical_run_id=..., load_date=...)
    # (see ``silver_to_gold`` in pipeline.py) with no pipeline_run_id, so only
    # ACCUMULATE_BY_RUN_COLUMNS is stamped -- not a pipeline_run_id column.
    # review_queue reads case_snapshot back through a plain SqliteReader with
    # no re-parse, so (unlike case_snapshot itself) its dates revert to text,
    # and it carries the same extra ``active_flag`` case_snapshot does.
    Table(
        "complex_reporting/gold",
        "review_queue",
        columns=columns_of(CaseSnapshot)
        + (
            Column("active_flag", "INTEGER"),
            Column("review_priority", "INTEGER", nullable=False),
        )
        + ACCUMULATE_BY_RUN_COLUMNS,
        primary_key=("case_ref",),
    ),
    Table(
        "complex_reporting/gold",
        "adviser_summary",
        columns=(
            Column("adviser_id", "TEXT", nullable=False),
            Column("region", "TEXT", nullable=False),
            Column("selected_cases", "INTEGER", nullable=False),
            Column("total_exposure", "INTEGER", nullable=False),
            Column("total_open_contacts", "INTEGER", nullable=False),
        )
        + ACCUMULATE_BY_RUN_COLUMNS,
        primary_key=("adviser_id", "region"),
    ),
)
