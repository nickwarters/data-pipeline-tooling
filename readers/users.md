```python
"""The ``users`` reference feed: a login's email address, and its manager's.

The directory is the authority for a Responsible Party's Manager, so this feed
supplies both edges at once — a login's own email, and the login and email of
whoever manages them. Nothing here reads a manager column off a Case row.

A Shared Reader with **no producer pipeline at all**: there is no ``users``
feed, no subject and no medallion, and a consumer cannot tell. That is the point
of the package — the location is this module's business, and the answer today
happens to be a file bundled beside it.

**This makes no claim about the Staff Hierarchy.** The two are expected to
converge and they have not; nothing here decides it either way, and the silence
is deliberate rather than an omission.
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

#: Where this feed lives today. Not a test fixture — it is the source.
_BUNDLED_FEED = Path(__file__).resolve().parent / "sample_data" / "users.csv"


class UsersReader:
    """Read the ``users`` reference feed, normalised to bare account names.

    Wraps a ``CsvReader`` rather than subclassing one: ``Reader`` is a
    structural Protocol, so composition costs one delegated attribute and keeps
    the CSV mechanics where they already are.

    A duplicate ``login`` is refused. It is the one failure worth checking for
    here, because the join fans out on it and every extra row is a person told
    the same thing twice.

    ``base_dir`` is taken and **not used**, and that is deliberate. Resolving a
    location is a Shared Reader's job, and this reader's answer today is "a file
    bundled beside this module" — so there is nothing to resolve *yet*. It is
    not a placeholder: the day this becomes a real feed under the base directory,
    or a table in a database, the answer changes here and the signature does
    not. A consumer handed a *path* instead would have been told the source is a
    file, which is the leak that breaks first.

    ``path`` is a **test and spike seam**, not consumer API — keyword-only so it
    cannot be passed by accident, and no caller in ``pipelines/`` should use it.
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

```
