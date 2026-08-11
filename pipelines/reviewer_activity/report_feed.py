"""Publish the reviewer activity Report Feed to the local deliverables outbox."""

from __future__ import annotations

import datetime as dt
import functools
import json
import numbers
import os
import shutil
import tempfile
from pathlib import Path, PureWindowsPath

import pandas as pd

from framework.core import Dataset, Reader, ValidationError
from framework.run import Pipeline, RunLog
from tools.deliverables import REPORT_FEEDS_DESTINATION, get_deliverable_path
from tools.observability import timestamps

REPORT_FEED_SCHEMA_VERSION = 1
REPORT_FEED_RETENTION_MONTHS = 13
REPORT_FEED_DESTINATION = "my-stats"

_AGGREGATE_COLUMNS = {
    "reviewer_account",
    "reportable_date",
    "case_type",
    "count",
    "as_of_utc",
}
_PREPARED_COLUMNS = {"reviewer_account", "date", "case_type", "count"}
_WINDOWS_DEVICE_NAMES = {
    "con",
    "prn",
    "aux",
    "nul",
    *(f"com{number}" for number in range(1, 10)),
    *(f"lpt{number}" for number in range(1, 10)),
}


def _shift_month(day: dt.date, months: int) -> dt.date:
    month_index = day.year * 12 + day.month - 1 + months
    year, month_zero_based = divmod(month_index, 12)
    return dt.date(year, month_zero_based + 1, 1)


def report_window(complete_through: dt.date) -> tuple[dt.date, dt.date]:
    """Return the inclusive 13-month Report Feed window."""
    start = _shift_month(complete_through, -(REPORT_FEED_RETENTION_MONTHS - 1))
    return start, complete_through


def complete_through_from(dataset: Dataset) -> dt.date | None:
    """Return the aggregate snapshot's local calendar date."""
    frame = dataset.to_pandas()
    _require_columns(frame)
    values = frame["as_of_utc"].dropna().astype(str).unique()
    if len(values) == 0:
        return None
    if len(values) != 1:
        raise ValueError("reviewer activity aggregate has multiple as_of_utc values")
    return timestamps.local_date(values[0])


class ReviewerActivityAggregateValidator:
    """Validate the committed aggregate before publication reshapes it."""

    def validate(self, dataset: Dataset) -> None:
        frame = dataset.to_pandas()
        try:
            _require_columns(frame)
        except ValueError as exc:
            raise ValidationError(str(exc)) from exc
        if frame.empty:
            return
        if frame[list(_AGGREGATE_COLUMNS)].isna().any().any():
            raise ValidationError("reviewer activity aggregate contains null values")
        if frame["case_type"].astype(str).str.strip().eq("").any():
            raise ValidationError(
                "reviewer activity aggregate contains a blank case type"
            )
        for account in frame["reviewer_account"]:
            try:
                _safe_account(account)
            except ValueError as exc:
                raise ValidationError(str(exc)) from exc
        dates = pd.to_datetime(frame["reportable_date"], errors="coerce")
        if dates.isna().any():
            raise ValidationError(
                "reviewer activity aggregate contains an invalid date"
            )
        counts = pd.to_numeric(frame["count"], errors="coerce")
        if counts.isna().any() or counts.mod(1).ne(0).any() or counts.le(0).any():
            raise ValidationError(
                "reviewer activity aggregate contains an invalid count"
            )
        try:
            complete_through_from(dataset)
        except ValueError as exc:
            raise ValidationError(str(exc)) from exc


def prepare_report_rows(
    dataset: Dataset,
    complete_through: dt.date | None = None,
) -> Dataset:
    """Select sparse aggregate rows covered by the Report Feed contract."""
    ReviewerActivityAggregateValidator().validate(dataset)
    frame = dataset.to_pandas().copy()
    if frame.empty:
        return Dataset.from_pandas(
            pd.DataFrame(columns=["reviewer_account", "date", "case_type", "count"])
        )

    complete_through = complete_through or complete_through_from(dataset)
    if complete_through is None:
        return Dataset.from_pandas(
            pd.DataFrame(columns=["reviewer_account", "date", "case_type", "count"])
        )
    start, end = report_window(complete_through)
    frame["reviewer_account"] = (
        frame["reviewer_account"].astype("string").str.strip().str.lower()
    )
    dates = pd.to_datetime(frame["reportable_date"]).dt.date
    keep = dates.ge(start) & dates.le(end)
    selected = pd.DataFrame(
        {
            "reviewer_account": frame.loc[keep, "reviewer_account"].astype(str),
            "date": dates.loc[keep].map(dt.date.isoformat),
            "case_type": frame.loc[keep, "case_type"].astype(str),
            "count": frame.loc[keep, "count"].astype("int64"),
        }
    )
    selected = selected.sort_values(
        ["reviewer_account", "date", "case_type"], kind="stable"
    )
    return Dataset.from_pandas(selected.reset_index(drop=True))


class ReportFeedWriter:
    """Write every Reviewer's sparse Report Feed through one Writer."""

    def __init__(
        self,
        base_dir: str | os.PathLike[str],
        *,
        generated_at: str,
        complete_through: dt.date | None = None,
    ) -> None:
        self._base_dir = Path(base_dir)
        self._generated_at = generated_at
        self._complete_through = complete_through
        self._reviewer_accounts: tuple[str, ...] | None = None
        self.data_locations: list[dict[str, str]] = []

    def configure(
        self,
        reviewer_accounts: tuple[str, ...],
        complete_through: dt.date | None,
    ) -> None:
        self._reviewer_accounts = reviewer_accounts
        self._complete_through = complete_through

    def write(self, dataset: Dataset) -> None:
        frame = dataset.to_pandas()
        _validate_prepared_rows(frame)
        self.data_locations = []
        if self._reviewer_accounts is None:
            raise ValueError(
                "ReportFeedWriter must be configured by its preparation step"
            )
        if not self._reviewer_accounts:
            return
        if self._complete_through is None:
            raise ValueError("Report Feed has no complete_through date")

        staged: list[tuple[Path, Path]] = []
        try:
            for account in self._reviewer_accounts:
                rows = frame.loc[frame["reviewer_account"].eq(account)]
                payload = {
                    "schema_version": REPORT_FEED_SCHEMA_VERSION,
                    "reviewer_account": account,
                    "generated_at": self._generated_at,
                    "complete_through": self._complete_through.isoformat(),
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
                staged.append((path, _stage_payload(path, payload)))
            _publish_staged(staged)
        finally:
            for _, temporary in staged:
                temporary.unlink(missing_ok=True)
        self.data_locations = [
            {"namespace": "file", "name": str(path)} for path, _ in staged
        ]


ReviewerReportFeedWriter = ReportFeedWriter


def prepare_report_feed_rows(
    dataset: Dataset,
    *,
    writer: ReportFeedWriter,
) -> Dataset:
    """Prepare rows and configure the one Writer with the reviewer universe."""
    ReviewerActivityAggregateValidator().validate(dataset)
    frame = dataset.to_pandas()
    accounts = tuple(
        sorted({_safe_account(value) for value in frame["reviewer_account"].tolist()})
    )
    complete_through = complete_through_from(dataset)
    writer.configure(accounts, complete_through)
    return prepare_report_rows(dataset, complete_through)


def reviewer_report_feed_builder(
    reader: Reader,
    writer: ReportFeedWriter,
    *,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the one-read, validate, prepare, one-Writer publication pipeline."""
    pipeline = Pipeline("reviewer_activity:report-feed", run_log=run_log)
    source = pipeline.read(reader, name="read-gold")
    validated = pipeline.validate(
        ReviewerActivityAggregateValidator(), source, name="validate-gold"
    )
    prepared = pipeline.transform(
        functools.partial(prepare_report_feed_rows, writer=writer),
        validated,
        name="prepare-report-feeds",
    )
    pipeline.write(writer, prepared, name="write-report-feeds")
    return pipeline


def _require_columns(frame: pd.DataFrame) -> None:
    missing = _AGGREGATE_COLUMNS.difference(frame.columns)
    if missing:
        raise ValueError(
            "reviewer activity aggregate is missing columns: "
            + ", ".join(sorted(missing))
        )


def _validate_prepared_rows(frame: pd.DataFrame) -> None:
    if set(frame.columns) != _PREPARED_COLUMNS:
        raise ValueError("Report Feed preparation produced an unexpected shape")
    if frame.empty:
        return
    if frame.isna().any().any():
        raise ValueError("Report Feed preparation produced null values")
    for account in frame["reviewer_account"]:
        _safe_account(account)
    for value in frame["date"]:
        if (
            not isinstance(value, str)
            or dt.date.fromisoformat(value).isoformat() != value
        ):
            raise ValueError("Report Feed preparation produced an invalid date")
    if not frame["case_type"].map(lambda value: isinstance(value, str)).all():
        raise ValueError("Report Feed preparation produced a non-string case type")
    if not frame["count"].map(lambda value: isinstance(value, numbers.Integral)).all():
        raise ValueError("Report Feed preparation produced a non-integer count")
    if frame["count"].le(0).any():
        raise ValueError("Report Feed preparation produced a non-positive count")


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


def _publish_staged(staged: list[tuple[Path, Path]]) -> None:
    backups: dict[Path, Path | None] = {}
    replaced: list[Path] = []
    try:
        for path, _ in staged:
            if path.exists():
                descriptor, backup_name = tempfile.mkstemp(
                    dir=path.parent, prefix=f".{path.name}.", suffix=".bak"
                )
                os.close(descriptor)
                backup = Path(backup_name)
                backups[path] = backup
                shutil.copy2(path, backup)
            else:
                backups[path] = None
        for path, temporary in staged:
            os.replace(temporary, path)
            replaced.append(path)
    except Exception:
        for path in reversed(replaced):
            backup = backups[path]
            if backup is None:
                path.unlink(missing_ok=True)
            else:
                os.replace(backup, path)
                backups[path] = None
        raise
    finally:
        for backup in backups.values():
            if backup is not None:
                backup.unlink(missing_ok=True)


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
