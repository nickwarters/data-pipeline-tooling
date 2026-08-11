"""Publish the reviewer activity Report Feed to the local deliverables outbox."""

from __future__ import annotations

import datetime as dt
import json
import os
import tempfile
from pathlib import Path, PureWindowsPath

import pandas as pd

from framework.core import Dataset, Reader, SchemaValidator, ValidationError
from framework.run import Pipeline, RunLog
from framework.transform import SchemaCoercion
from tools.deliverables import REPORT_FEEDS_DESTINATION, get_deliverable_path
from tools.observability import timestamps

from .schema import ReviewerActivityDaily

REPORT_FEED_SCHEMA_VERSION = 1
REPORT_FEED_RETENTION_MONTHS = 13
REPORT_FEED_DESTINATION = "my-stats"

_PREPARED_COLUMNS = {"reviewer_account", "date", "case_type", "count", "as_of_utc"}
_WINDOWS_DEVICE_NAMES = {
    "con",
    "prn",
    "aux",
    "nul",
    *(f"com{number}" for number in range(1, 10)),
    *(f"lpt{number}" for number in range(1, 10)),
}


def empty_report_dataset() -> Dataset:
    """Return the no-op result for a dry-run publication request."""
    return Dataset.from_pandas(pd.DataFrame())


def _shift_month(day: dt.date, months: int) -> dt.date:
    month_index = day.year * 12 + day.month - 1 + months
    year, month_zero_based = divmod(month_index, 12)
    return dt.date(year, month_zero_based + 1, 1)


def _report_window(complete_through: dt.date) -> tuple[dt.date, dt.date]:
    """Return the inclusive 13-month Report Feed window."""
    start = _shift_month(complete_through, -(REPORT_FEED_RETENTION_MONTHS - 1))
    return start, complete_through


def _complete_through_from(dataset: Dataset) -> dt.date | None:
    """Return the last complete local calendar day in the aggregate snapshot."""
    frame = dataset.to_pandas()
    if "as_of_utc" not in frame.columns:
        raise ValidationError("reviewer activity aggregate is missing 'as_of_utc'")
    values = frame["as_of_utc"].dropna().astype(str).unique()
    if len(values) == 0:
        return None
    if len(values) != 1:
        raise ValidationError(
            "reviewer activity aggregate has multiple as_of_utc values"
        )
    try:
        return timestamps.local_date(values[0]) - dt.timedelta(days=1)
    except ValueError as exc:
        raise ValidationError(
            "reviewer activity aggregate has an invalid as_of_utc value"
        ) from exc


class ReportFeedContractValidator:
    """Validate publication-specific constraints beyond the declared schema."""

    def validate(self, dataset: Dataset) -> None:
        frame = dataset.to_pandas()
        if frame["case_type"].astype("string").str.strip().eq("").any():
            raise ValidationError(
                "reviewer activity aggregate contains a blank case type"
            )
        for account in frame["reviewer_account"]:
            try:
                _safe_account(account)
            except ValueError as exc:
                raise ValidationError(str(exc)) from exc
        _complete_through_from(dataset)


def _prepare_report_rows(dataset: Dataset) -> Dataset:
    """Normalize the committed aggregate for the file Writer."""
    frame = dataset.to_pandas().copy()
    frame["reviewer_account"] = (
        frame["reviewer_account"].astype("string").str.strip().str.lower()
    )
    frame["date"] = pd.to_datetime(frame["reportable_date"]).dt.date.map(
        dt.date.isoformat
    )
    return Dataset.from_pandas(
        frame[
            ["reviewer_account", "date", "case_type", "count", "as_of_utc"]
        ].reset_index(drop=True)
    )


class ReportFeedWriter:
    """Write every Reviewer's sparse Report Feed through one Writer."""

    def __init__(
        self,
        base_dir: str | os.PathLike[str],
        *,
        generated_at: str,
    ) -> None:
        self._base_dir = Path(base_dir)
        self._generated_at = generated_at
        self.data_locations: list[dict[str, str]] = []

    def write(self, dataset: Dataset) -> None:
        frame = dataset.to_pandas()
        missing = _PREPARED_COLUMNS.difference(frame.columns)
        if missing:
            raise ValueError(
                "Report Feed preparation is missing columns: "
                + ", ".join(sorted(missing))
            )
        self.data_locations = []
        complete_through = _complete_through_from(dataset)
        if complete_through is None:
            return

        try:
            accounts = sorted(
                {_safe_account(value) for value in frame["reviewer_account"]}
            )
        except ValueError as exc:
            raise ValidationError(str(exc)) from exc
        start, end = _report_window(complete_through)
        dates = pd.to_datetime(frame["date"], errors="raise").dt.date
        for account in accounts:
            rows = frame.loc[
                frame["reviewer_account"].eq(account) & dates.ge(start) & dates.le(end)
            ].sort_values(["date", "case_type"], kind="stable")
            payload = {
                "schema_version": REPORT_FEED_SCHEMA_VERSION,
                "reviewer_account": account,
                "generated_at": self._generated_at,
                "complete_through": complete_through.isoformat(),
                "rows": [
                    {
                        "date": row["date"],
                        "case_type": row["case_type"],
                        "count": row["count"].item()
                        if hasattr(row["count"], "item")
                        else row["count"],
                    }
                    for row in rows.to_dict(orient="records")
                ],
            }
            path = get_deliverable_path(
                self._base_dir,
                REPORT_FEEDS_DESTINATION,
                REPORT_FEED_DESTINATION,
                f"{account}.txt",
            )
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = _stage_payload(path, payload)
            try:
                os.replace(temporary, path)
            finally:
                temporary.unlink(missing_ok=True)
            self.data_locations.append({"namespace": "file", "name": str(path)})


def reviewer_report_feed_builder(
    reader: Reader,
    writer: ReportFeedWriter,
    *,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the one-read, validate, prepare, one-Writer publication pipeline."""
    pipeline = Pipeline("reviewer_activity:report-feed", run_log=run_log)
    source = pipeline.read(reader, name="read-gold")
    coerced = pipeline.transform(
        SchemaCoercion(ReviewerActivityDaily), source, name="coerce-gold"
    )
    schema_validated = pipeline.validate(
        SchemaValidator(ReviewerActivityDaily), coerced, name="validate-gold"
    )
    contract_validated = pipeline.validate(
        ReportFeedContractValidator(), schema_validated, name="validate-report-feed"
    )
    prepared = pipeline.transform(
        _prepare_report_rows, contract_validated, name="prepare"
    )
    pipeline.write(writer, prepared, name="write-report-feeds")
    return pipeline


def _stage_payload(path: Path, payload: dict) -> Path:
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            temporary.write(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
            temporary.flush()
            os.fsync(temporary.fileno())
        return temporary_path
    except Exception:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
        raise


def _safe_account(value: object) -> str:
    account = str(value).strip().lower()
    windows_path = PureWindowsPath(account)
    device_name = account.split(".", 1)[0]
    unsafe_characters = '<>:"/\\|?*\x00'
    if (
        not account
        or account in {".", ".."}
        or len(windows_path.parts) != 1
        or windows_path.drive
        or windows_path.root
        or device_name in _WINDOWS_DEVICE_NAMES
        or any(character in account for character in unsafe_characters)
        or account.endswith((".", " "))
    ):
        raise ValueError(f"unsafe reviewer account for a Report Feed: {value!r}")
    return account
