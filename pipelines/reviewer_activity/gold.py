"""Gold builder for the reviewer activity aggregate."""

from __future__ import annotations

import pandas as pd

from framework.core import ColumnValidator, Dataset, Reader, SchemaValidator, Writer
from framework.run import Pipeline, RunLog
from framework.transform import count_by, shaped
from shared.reporting import UNKNOWN_BRAND
from tools.observability.timestamps import local_dates

from .schema import ReviewerActivityDaily

# What this pipeline owns and writes. Where its *source* lives is not declared
# here at all: it is read through readers.sharepoint_cases.CurrentCasesReader,
# which is the one place the Sync subject's layer and table are named.
SUBJECT = "reviewer_activity"
TABLE = "reviewer_activity_daily"

# The columns this aggregate needs from whatever it is given. They stay here
# rather than moving to the reader: a column tuple on a shared reader becomes
# the union of every consumer's needs, and this validator's failure message is
# most useful beside the code that depends on these five.
SOURCE_COLUMNS = (
    "assigned_reviewer_name",
    "case_type",
    "status",
    "reportable_at",
    "as_of_utc",
)

# ``UNKNOWN_BRAND`` is the shared reporting fill, imported above for the same
# reason the Sync aggregates carry it.


def normalize_reviewer_account(value: object) -> str | None:
    """Return the lower-cased bare account represented by a claims login."""
    if value is None:
        return None
    try:
        if bool(pd.isna(value)):
            return None
    except (TypeError, ValueError):
        pass

    account = str(value).strip()
    if not account:
        return None
    claims_prefix = "i:0#.w|"
    if account.lower().startswith(claims_prefix):
        account = account[len(claims_prefix) :]
    slash = account.rfind("\\")
    if slash >= 0:
        account = account[slash + 1 :]
    account = account.strip().lower()
    return account or None


def aggregate_reviewer_activity(dataset: Dataset) -> Dataset:
    """Count non-void current Cases by reviewer, local date, Case Type, and
    brand."""
    frame = dataset.to_pandas().copy()

    eligible = frame.loc[frame["status"].ne("Void")].copy()
    eligible["reviewer_account"] = eligible["assigned_reviewer_name"].map(
        normalize_reviewer_account
    )
    eligible["reportable_date"] = local_dates(eligible["reportable_at"]).map(
        lambda day: pd.NaT if day is None else pd.Timestamp(day)
    )
    case_types = eligible["case_type"].astype("string")
    eligible = eligible.loc[
        eligible["reviewer_account"].notna()
        & eligible["reportable_date"].notna()
        & case_types.notna()
        & case_types.str.strip().ne("")
    ]

    if eligible.empty:
        # The declared shape, for a source with no reportable work.
        return shaped([], ReviewerActivityDaily)

    eligible["brand"] = UNKNOWN_BRAND
    grouped = count_by(
        eligible,
        ("reviewer_account", "reportable_date", "case_type", "brand"),
        measure="count",
    )
    # Sync's Refresh-built current table stamps one literal as_of_utc on every
    # row. Carry that contract through the reduction, stamping after the
    # group-by like the sibling gold aggregates do.
    as_of = eligible["as_of_utc"].iloc[0]
    return shaped(grouped, ReviewerActivityDaily, stamp={"as_of_utc": as_of})


def _serialize_reportable_date(dataset: Dataset) -> Dataset:
    """Give SQLite a date-only value after the declared schema has passed."""
    frame = dataset.to_pandas().copy()
    frame["reportable_date"] = frame["reportable_date"].map(
        lambda value: value.date() if pd.notna(value) else None
    )
    return Dataset.from_pandas(frame)


def reviewer_activity_daily_builder(
    reader: Reader,
    writer: Writer,
    *,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the sparse reviewer activity gold table.

    Grain: ``reviewer_account`` x ``reportable_date`` x ``case_type``.
    """
    p = Pipeline(f"{SUBJECT}:gold:{TABLE}", run_log=run_log)
    source = p.read(reader, name="read")
    source_validated = p.validate(
        ColumnValidator(SOURCE_COLUMNS), source, name="validate-source"
    )
    aggregated = p.transform(
        aggregate_reviewer_activity, source_validated, name="aggregate"
    )
    validated = p.validate(
        SchemaValidator(ReviewerActivityDaily),
        aggregated,
        name="validate-gold",
    )
    serialised = p.transform(
        _serialize_reportable_date, validated, name="serialize-date"
    )
    p.write(writer, serialised, name="write")
    return p
