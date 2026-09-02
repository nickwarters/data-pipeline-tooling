"""Shared Reader for the bundled users reference CSV.

It normalizes account names and emails, rejects duplicate logins, and has no
producer pipeline.
"""

from __future__ import annotations

import os
from pathlib import Path

from framework.core import Dataset, ValidationError
from framework.io import CsvReader
from shared.account_names import to_bare_account

COLUMNS = ("login", "email", "manager_login", "manager_email")
LOGIN_COLUMNS = ("login", "manager_login")
EMAIL_COLUMNS = ("email", "manager_email")

#: Bundled source CSV.
_BUNDLED_FEED = Path(__file__).resolve().parent / "sample_data" / "users.csv"


class UsersReader:
    """Read the bundled users feed, normalised to bare account names.

    Duplicate logins raise ``ValidationError``. ``base_dir`` satisfies the
    Shared Reader contract; the keyword-only ``path`` is a test and spike seam.
    """

    def __init__(
        self,
        base_dir: str | os.PathLike[str] | None = None,
        *,
        path: str | os.PathLike[str] | None = None,
    ) -> None:
        self._reader = CsvReader(path or _BUNDLED_FEED)

    @property
    def data_locations(self) -> list[dict[str, str]]:
        return self._reader.data_locations

    def read(self) -> Dataset:
        frame = self._reader.read().to_pandas()
        missing = [column for column in COLUMNS if column not in frame.columns]
        if missing:
            raise ValidationError(
                f"users feed is missing column(s) {', '.join(missing)}; "
                f"it must carry {', '.join(COLUMNS)}"
            )

        frame = frame.loc[:, list(COLUMNS)].copy()
        for column in LOGIN_COLUMNS:
            frame[column] = frame[column].map(to_bare_account)
        for column in EMAIL_COLUMNS:
            frame[column] = frame[column].fillna("").astype(str).str.strip().str.lower()

        frame = frame[(frame["login"] != "") & (frame["email"] != "")]

        duplicated = sorted(set(frame.loc[frame["login"].duplicated(), "login"]))
        if duplicated:
            raise ValidationError(
                "users feed has more than one row for login(s) "
                f"{', '.join(duplicated)}; each login must appear once"
            )
        return Dataset.from_pandas(frame.reset_index(drop=True))

    def describe(self) -> str:
        return self._reader.describe()
