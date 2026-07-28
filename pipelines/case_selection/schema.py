"""Declared schemas for the case-selection example.

Following the scaffold layout, schemas live apart from the pipeline wiring. Three
dataclasses: the two source feeds (``SalesRow`` / ``CaseReviewRow``, the silver
contracts) and the deliverable (``SelectedCase``, the ``selection_pool`` row).

``sale category`` (A/B) is the *product* category used only to tie-break two
equal-risk sales; ``case_type`` (A/B/C) is the *check* classification derived from
the risk score (and the rolling-year type-C quota). They are deliberately
distinct fields.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Annotated

from framework.core import OneOf, Range
from tools.schema import (
    ACCUMULATE_BY_RUN_CONTEXT_COLUMNS,
    Table,
    columns_of,
    retype,
    text_columns,
)


@dataclass
class SalesRow:
    """One sale. The selection picks the highest-risk recent sale per adviser."""

    sale_id: str
    adviser: str
    sale_date: date
    risk_score: Annotated[int, Range(minimum=0)]
    category: Annotated[str, OneOf("A", "B")]
    product: str


@dataclass
class CaseReviewRow:
    """One historical (or in-progress) case review for an adviser.

    ``completed_date`` is nullable: an ``in_progress`` review has none yet (blank
    in the source), and ``outcome`` is ``"none"`` until the review completes.
    """

    case_id: str
    adviser: str
    case_type: Annotated[str, OneOf("A", "B", "C")]
    status: Annotated[str, OneOf("in_progress", "completed")]
    outcome: Annotated[str, OneOf("pass", "fail", "none")]
    selected_date: date
    completed_date: date


@dataclass
class SelectedCase:
    """One chosen Case in the ``selection_pool`` deliverable — one per adviser."""

    adviser: str
    sale_id: str
    sale_date: date
    risk_score: int
    category: Annotated[str, OneOf("A", "B")]
    case_type: Annotated[str, OneOf("A", "B", "C")]
    selected_date: date


# The sibling trace's columns (one row per *considered* adviser, with the
# verdict + reason) -- declared here, the one source both the trace's assembly
# in ``selection.py`` and its ``Table`` below read, since it has no row
# dataclass of its own.
TRACE_COLUMNS = ["adviser", "verdict", "reason", "sale_id", "risk_score", "case_type"]


# This pipeline is self-contained: it lands ``sales``/``case_reviews`` itself
# (see ``pipeline.py`` -- it declares no UPSTREAMS), so it owns those two
# tables' raw/silver shape as well as the gold deliverable and its trace. A
# feed that instead *reads* another feed's silver table would declare that
# table's row dataclass for typing only, and leave it out of TABLES -- see
# ``pipelines/retail_analytics/schema.py`` for a feed that does exactly that.
#
# Gold lands via AccumulateByRun.from_context(context) (see pipeline.py), so
# every selection_pool/selection_trace row carries the stamped run columns too.
#
# raw and silver share the same declared column *types* here (CsvReader infers
# dtypes on read, so raw isn't pure text) -- but not the same date type: raw's
# date columns land untouched (TEXT), while ``raw_to_silver`` coerces them into
# real ``date`` objects before writing silver, which pandas' ``to_sql`` types
# as ``TIMESTAMP``. selection_builder re-parses ``sale_date`` explicitly
# (``SelectCasesToCheck._parsed_rows``) before writing the pool, so it lands
# TIMESTAMP there too.
TABLES = (
    Table("raw", "sales", columns=columns_of(SalesRow)),
    Table(
        "silver",
        "sales",
        columns=retype(columns_of(SalesRow), sale_date="TIMESTAMP"),
        primary_key=("sale_id",),
    ),
    Table("raw", "case_reviews", columns=columns_of(CaseReviewRow)),
    Table(
        "silver",
        "case_reviews",
        columns=retype(
            columns_of(CaseReviewRow),
            selected_date="TIMESTAMP",
            completed_date="TIMESTAMP",
        ),
        primary_key=("case_id",),
    ),
    Table(
        "gold",
        "selection_pool",
        columns=retype(
            columns_of(SelectedCase), sale_date="TIMESTAMP", selected_date="TIMESTAMP"
        )
        + ACCUMULATE_BY_RUN_CONTEXT_COLUMNS,
        primary_key=("adviser",),
    ),
    Table(
        "gold",
        "selection_trace",
        # rules.py's trace rows always carry int(risk_score), never text.
        columns=retype(text_columns(TRACE_COLUMNS), risk_score="INTEGER")
        + ACCUMULATE_BY_RUN_CONTEXT_COLUMNS,
        primary_key=("adviser",),
    ),
)
