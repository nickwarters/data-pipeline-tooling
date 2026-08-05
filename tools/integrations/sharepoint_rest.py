"""Reading one SharePoint list by a ``Modified`` window.

The snapshot seam next door in :mod:`tools.integrations.remote` answers "give me
the whole list". This module answers a narrower question — "give me the items
whose ``Modified`` falls in *this* window" — which is what an incremental feed
needs and what a snapshot cannot express.

Three lines are drawn deliberately:

*The window is the caller's.* The Reader is handed an explicit
:class:`ModifiedWindow` and never computes one. Where the previous window ended,
how much overlap to re-read, and where that is persisted are a checkpoint's
concerns; keeping them out means this class has no state and one read is
reproducible from its constructor arguments alone.

*Fetching is somebody else's.* The organisational SharePoint client already
handles authentication, transport and server paging, so it stays behind the
:class:`SharePointListClient` seam and this module only *configures* the query it
runs — the projection and the ``Modified`` predicates. Nothing here builds a URL,
follows a paging link, or holds a credential.

*What is observed is stamped immutably.* Rows come back carrying which list they
came from, which item they are, the version observed, and when it was observed
(:data:`METADATA_COLUMNS`). Downstream can then tell "this item changed again"
from "we read the same item twice" without asking SharePoint a second time.

The window is **half-open** — ``Modified ge start and Modified lt end`` — so
consecutive windows tile without dropping or double-counting an item whose
``Modified`` lands exactly on a boundary, and both bounds are converted to UTC
once, at construction, so a Windows box and a macOS box send the same predicate.

Retry is not implemented here: a transient client failure is
``tools.retry.RetryingReader``'s business, and one policy then covers every
source rather than each Reader growing its own.

Not in scope, and deliberately so: checkpoints, overlap, hard deletes (an item
deleted in SharePoint has no ``Modified`` and so cannot appear in any window —
reconciliation is a separate mechanism), and any knowledge of raw/silver/gold.
"""

from __future__ import annotations

import datetime as dt
import hashlib
from dataclasses import dataclass
from typing import Callable, Protocol, Sequence, runtime_checkable

import pandas as pd

from framework._internal.describe import redact_url, render
from framework.core.dataset import Dataset
from framework.core.errors import ErrorCategory, PipelineError
from tools.observability.timestamps import utc_now_iso

__all__ = [
    "METADATA_COLUMNS",
    "ModifiedWindow",
    "SharePointFeedError",
    "SharePointListClient",
    "SharePointModifiedReader",
    "StubbedSharePointListClient",
]

# The observation metadata every row carries, in the order it is stamped. Fixed
# and additive: a downstream table reads these by name, so append, never reorder.
METADATA_COLUMNS = (
    "source_list_name",
    "source_item_id",
    "source_modified_at",
    "source_version",
    "source_observation_id",
    "observed_at",
)

# The OData literal shape a Modified predicate compares against: UTC, seconds
# precision, one encoding decided in one place.
_ODATA_INSTANT = "%Y-%m-%dT%H:%M:%SZ"

# The columns a list item is identified by, whatever else the caller projects.
_ITEM_ID = "Id"
_MODIFIED = "Modified"

# Where the list's own version stamp shows up, in the order preferred. Absent
# them, the version is a digest of the item's values.
_VERSION_COLUMNS = ("odata.etag", "ETag", "OData__UIVersionString", "Version")

# Field and record separators for the canonical digest input. Control characters
# so a value containing a comma, quote or newline cannot forge a boundary.
_FIELD = "\x1f"
_RECORD = "\x1e"


class SharePointFeedError(PipelineError):
    """A SharePoint list broke the identity contract this Reader depends on.

    Categorised as ``DATA``: the fix is in the list (a missing ``Id``, an
    unparseable ``Modified``), not in the wiring or the run conditions.
    """

    category = ErrorCategory.DATA


@dataclass(frozen=True)
class ModifiedWindow:
    """The half-open ``[start, end)`` ``Modified`` window to retrieve.

    ``start=None`` is the first-load shape: every current item strictly before
    ``end``, with no lower bound. Both bounds must be timezone-aware — a naive
    datetime has no single UTC meaning, and silently reading it as the local zone
    would shift the window by whatever offset the reading machine happens to be
    in.
    """

    start: dt.datetime | None
    end: dt.datetime

    def __post_init__(self) -> None:
        for name, bound in (("start", self.start), ("end", self.end)):
            if bound is not None and bound.tzinfo is None:
                raise ValueError(
                    f"ModifiedWindow.{name} must be timezone-aware; "
                    f"got a naive datetime ({bound.isoformat()})"
                )
        if self.start is not None and self.start >= self.end:
            raise ValueError(
                f"ModifiedWindow.start ({self.start.isoformat()}) must be before "
                f"end ({self.end.isoformat()})"
            )

    def filters(self) -> list[str]:
        """The ``Modified`` predicates for this window, UTC-encoded once."""
        predicates = []
        if self.start is not None:
            predicates.append(f"{_MODIFIED} ge datetime'{_odata(self.start)}'")
        predicates.append(f"{_MODIFIED} lt datetime'{_odata(self.end)}'")
        return predicates


def _odata(moment: dt.datetime) -> str:
    return moment.astimezone(dt.timezone.utc).strftime(_ODATA_INSTANT)


@runtime_checkable
class SharePointListClient(Protocol):
    """The organisational SharePoint client seam: fetch one list's items.

    The client owns authentication, transport and server paging; this module
    only supplies the query. ``fetch_items`` returns every matching item as a
    frame — paging is already followed by the time it returns.
    """

    def fetch_items(
        self,
        list_name: str,
        expand_fields: Sequence[str],
        select_fields: Sequence[str],
        filters: Sequence[str],
    ) -> pd.DataFrame:
        """Return the items of ``list_name`` matching ``filters``."""
        ...


class StubbedSharePointListClient:
    """The default client: refuses rather than pretending to reach a tenant."""

    def fetch_items(
        self,
        list_name: str,
        expand_fields: Sequence[str],
        select_fields: Sequence[str],
        filters: Sequence[str],
    ) -> pd.DataFrame:
        raise NotImplementedError(
            "No SharePoint client was supplied: pass client=<the organisational "
            "client> (anything with a fetch_items(list_name, expand_fields, "
            "select_fields, filters) method returning a frame), or a test double."
        )


class SharePointModifiedReader:
    """Read the items of one SharePoint list whose ``Modified`` falls in a window.

    Conforms to the ``Reader`` port (``read() -> Dataset``) and records the list
    it touched in ``data_locations``, with any credentials embedded in the site
    URL redacted.
    """

    def __init__(
        self,
        site: str,
        list_name: str,
        columns: Sequence[str],
        window: ModifiedWindow,
        *,
        expand_fields: Sequence[str] = (),
        client: SharePointListClient | None = None,
        observed_at: Callable[[], str] = utc_now_iso,
    ) -> None:
        self._site = site
        self._list_name = list_name
        self._columns = tuple(columns)
        self._window = window
        self._expand_fields = tuple(expand_fields)
        self._client = client or StubbedSharePointListClient()
        self._observed_at = observed_at
        self.data_locations: list[dict[str, str]] = []

    @property
    def _select_fields(self) -> tuple[str, ...]:
        # Id and Modified are the identity contract, so they are projected
        # whether or not the caller asked for them — and never twice.
        extra = tuple(c for c in self._columns if c not in (_ITEM_ID, _MODIFIED))
        return (_ITEM_ID, _MODIFIED, *extra)

    @property
    def _rendered_start(self) -> str:
        start = self._window.start
        return _odata(start) if start is not None else "(first load)"

    def read(self) -> Dataset:
        self.data_locations = [
            {"namespace": redact_url(self._site), "name": self._list_name}
        ]
        frame = self._client.fetch_items(
            self._list_name,
            list(self._expand_fields),
            list(self._select_fields),
            self._window.filters(),
        )
        if frame.empty:
            return Dataset.from_pandas(
                pd.DataFrame(columns=[*self._select_fields, *METADATA_COLUMNS])
            )
        self._check_identity_columns(frame)
        return Dataset.from_pandas(self._stamp(frame.reset_index(drop=True)))

    def _check_identity_columns(self, frame: pd.DataFrame) -> None:
        missing = [c for c in (_ITEM_ID, _MODIFIED) if c not in frame.columns]
        if missing:
            raise SharePointFeedError(
                f"SharePoint list {self._list_name!r} at "
                f"{redact_url(self._site)} returned items without "
                f"{', '.join(missing)}: the item identity contract needs "
                f"{_ITEM_ID} and {_MODIFIED} in every response."
            )

    def _stamp(self, frame: pd.DataFrame) -> pd.DataFrame:
        stamped = frame.copy()
        item_ids = [
            _require_item_id(value, row, self._list_name)
            for row, value in enumerate(frame[_ITEM_ID])
        ]
        modified = [
            _require_modified(value, row, self._list_name)
            for row, value in enumerate(frame[_MODIFIED])
        ]
        versions = _versions(frame)
        stamped["source_list_name"] = self._list_name
        stamped["source_item_id"] = item_ids
        stamped["source_modified_at"] = modified
        stamped["source_version"] = versions
        stamped["source_observation_id"] = [
            _observation_id(self._list_name, item_id, version)
            for item_id, version in zip(item_ids, versions)
        ]
        stamped["observed_at"] = self._observed_at()
        return stamped

    def describe(self) -> str:
        # The site with any embedded credentials stripped; the window rendered
        # in the exact shape it is sent, so a plan preview shows what will be
        # asked of the list. No client config is surfaced — it holds the auth.
        return render(
            self,
            site=redact_url(self._site),
            list_name=self._list_name,
            columns=", ".join(self._columns) or None,
            window=" .. ".join((self._rendered_start, _odata(self._window.end))),
        )


def _require_item_id(value: object, row: int, list_name: str) -> str:
    text = _canonical(value)
    if not text:
        raise SharePointFeedError(
            f"SharePoint list {list_name!r}, row {row}: {_ITEM_ID} is empty. "
            "Every list item must carry an id to be observable."
        )
    return text


def _require_modified(value: object, row: int, list_name: str) -> str:
    text = _canonical(value)
    try:
        moment = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        raise SharePointFeedError(
            f"SharePoint list {list_name!r}, row {row}: {_MODIFIED} is not a "
            f"readable timestamp ({value!r})."
        ) from None
    # A SharePoint Modified is UTC; one without an offset is read as such rather
    # than as the reading machine's zone.
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=dt.timezone.utc)
    return moment.astimezone(dt.timezone.utc).isoformat()


def _versions(frame: pd.DataFrame) -> list[str]:
    """The version observed per row: the list's own stamp, else a payload digest."""
    for column in _VERSION_COLUMNS:
        if column in frame.columns:
            supplied = [_canonical(value) for value in frame[column]]
            if all(supplied):
                return supplied
    return [_digest(row) for _, row in frame.iterrows()]


def _digest(row: "pd.Series") -> str:
    """A stable digest of one item's values.

    ``sha256`` over an explicitly delimited, column-sorted rendering — not
    Python's ``hash()``, which is salted per process and would give the same item
    a different identity on every run and on every machine.
    """
    payload = _FIELD.join(
        f"{column}={_canonical(row[column])}" for column in sorted(row.index)
    )
    return hashlib.sha256((payload + _RECORD).encode("utf-8")).hexdigest()


def _observation_id(list_name: str, item_id: str, version: str) -> str:
    """The identity of "this item, at this version, in this list"."""
    payload = _FIELD.join((list_name, item_id, version)) + _RECORD
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _canonical(value: object) -> str:
    """One value as the text the digests and identity columns are built from."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    if value is pd.NaT:
        return ""
    if isinstance(value, dt.datetime):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        # A frame column holding item ids may arrive as float64 once a null is
        # present; 7.0 and 7 must not be two different items.
        return str(int(value))
    return str(value)
