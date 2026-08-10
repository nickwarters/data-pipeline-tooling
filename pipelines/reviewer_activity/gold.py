"""Gold builder for the reviewer activity aggregate."""

from __future__ import annotations

import pandas as pd

from framework.core import ColumnValidator, Dataset, Reader, SchemaValidator, Writer
from framework.run import Pipeline, RunLog
from pipelines.sharepoint_cases.schema import FEED_NAME
from tools.observability.timestamps import local_date

from .schema import ReviewerActivityDaily

SUBJECT = "reviewer_activity"
TABLE = "reviewer_activity_daily"
SYNC_SUBJECT = FEED_NAME
SYNC_TABLE = "case_current"

SOURCE_COLUMNS = (
    "assigned_reviewer_name",
    "case_type",
    "status",
    "reportable_at",
    "as_of_utc",
)


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


def _empty_result() -> pd.DataFrame:
    """Return the declared shape for a source with no reportable work."""
    return pd.DataFrame(
        {
            "reviewer_account": pd.Series([], dtype="string"),
            "reportable_date": pd.Series([], dtype="datetime64[ns]"),
            "case_type": pd.Series([], dtype="string"),
            "count": pd.Series([], dtype="int64"),
            "as_of_utc": pd.Series([], dtype="string"),
        }
    )


def aggregate_reviewer_activity(dataset: Dataset) -> Dataset:
    """Count non-void current Cases by reviewer, local date, and Case Type."""
    frame = dataset.to_pandas().copy()

    eligible = frame.loc[frame["status"].ne("Void")].copy()
    eligible["reviewer_account"] = eligible["assigned_reviewer_name"].map(
        normalize_reviewer_account
    )
    reportable = pd.to_datetime(eligible["reportable_at"], utc=True, errors="coerce")
    eligible["reportable_date"] = reportable.map(
        lambda value: pd.NaT if pd.isna(value) else pd.Timestamp(local_date(value))
    )
    case_types = eligible["case_type"].astype("string")
    eligible = eligible.loc[
        eligible["reviewer_account"].notna()
        & eligible["reportable_date"].notna()
        & case_types.notna()
        & case_types.str.strip().ne("")
    ]

    if eligible.empty:
        return Dataset.from_pandas(_empty_result())

    grouped = (
        eligible.groupby(
            ["reviewer_account", "reportable_date", "case_type"],
            sort=True,
            dropna=False,
        )
        .size()
        .reset_index(name="count")
    )
    grouped["count"] = grouped["count"].astype("int64")
    # Sync's Refresh-built current table stamps one literal as_of_utc on every
    # row. Carry that contract through the reduction, stamping after the
    # group-by like the sibling gold aggregates do.
    as_of = eligible["as_of_utc"].iloc[0]
    grouped["as_of_utc"] = pd.Series(
        [as_of] * len(grouped), index=grouped.index, dtype="string"
    )
    result = grouped[
        ["reviewer_account", "reportable_date", "case_type", "count", "as_of_utc"]
    ]
    return Dataset.from_pandas(result.reset_index(drop=True))


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
