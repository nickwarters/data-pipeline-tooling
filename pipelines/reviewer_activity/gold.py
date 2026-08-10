"""Gold builder for the reviewer activity aggregate."""

from __future__ import annotations

import datetime as dt
from collections.abc import Iterable

import pandas as pd

from framework.core import ColumnValidator, Dataset, Reader, SchemaValidator, Writer
from framework.run import Pipeline, RunLog
from tools.observability.timestamps import local_date

from .schema import ReviewerActivityDaily

SUBJECT = "reviewer_activity"
TABLE = "reviewer_activity_daily"
SYNC_SUBJECT = "cora_cases"
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


def _source_as_of(values: Iterable[object]) -> str | None:
    """Validate and return the one snapshot instant carried by the source."""
    values = list(values)
    if not values:
        return None
    present = []
    for value in values:
        if value is None:
            continue
        try:
            if bool(pd.isna(value)):
                continue
        except (TypeError, ValueError):
            pass
        present.append(value)
    if not present:
        raise ValueError("case_current has no usable as_of_utc value")

    normalized: list[str] = []
    for value in present:
        if isinstance(value, dt.datetime):
            if value.tzinfo is None:
                raise ValueError("case_current as_of_utc must be timezone-aware")
            text = value.isoformat()
        else:
            text = str(value).strip()
        parsed = pd.to_datetime(text, utc=True, errors="coerce")
        if pd.isna(parsed):
            raise ValueError(f"invalid case_current as_of_utc value: {value!r}")
        normalized.append(text)

    distinct = tuple(dict.fromkeys(normalized))
    if len(distinct) != 1:
        raise ValueError("case_current carries conflicting as_of_utc values")
    return distinct[0]


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
    as_of = _source_as_of(frame["as_of_utc"])

    eligible = frame.loc[frame["status"].ne("Void")].copy()
    eligible["reviewer_account"] = eligible["assigned_reviewer_name"].map(
        normalize_reviewer_account
    )
    reportable = pd.to_datetime(eligible["reportable_at"], utc=True, errors="coerce")
    eligible["reportable_date"] = reportable.map(
        lambda value: pd.NaT if pd.isna(value) else pd.Timestamp(local_date(value))
    )
    eligible = eligible.dropna(
        subset=["reviewer_account", "reportable_date", "case_type"]
    )

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
    grouped["as_of_utc"] = pd.Series(
        [as_of] * len(grouped), index=grouped.index, dtype="string"
    )
    result = grouped[
        ["reviewer_account", "reportable_date", "case_type", "count", "as_of_utc"]
    ]
    return Dataset.from_pandas(result.reset_index(drop=True))


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
    p.write(writer, validated, name="write")
    return p
