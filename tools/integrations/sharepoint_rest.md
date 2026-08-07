```python
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

That last promise is only as good as the version is stable, so two things follow.
The version is decided **per row** — one row's missing ETag must not re-identify
its neighbours — and where the list supplies no stamp the fallback digest covers
the item's *projected* values, which means **widening ``columns`` re-identifies
every item** on the next read. Keep the projection stable, or accept one
re-observation of the whole list when it changes.

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
from dataclasses import dataclass
from typing import Callable, Protocol, Sequence, runtime_checkable

import pandas as pd

from framework._internal.describe import redact_url, render
from framework._internal.identity import canonical_text, sha256_json
from framework.core.dataset import Dataset
from framework.core.errors import ErrorCategory, PipelineError
from tools.integrations.locations import sharepoint_location
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
# one — for that *row*, not for the response — the version is a digest of the
# item's values.
_VERSION_COLUMNS = ("odata.etag", "ETag", "OData__UIVersionString", "Version")


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
        self.data_locations = [sharepoint_location(self._site, self._list_name)]
        frame = self._client.fetch_items(
            self._list_name,
            list(self._expand_fields),
            list(self._select_fields),
            self._window.filters(),
        )
        if frame.empty:
            # A window with no changes is not a failure, so it returns the
            # declared shape rather than nothing: the projection plus the
            # metadata. Note the limit — a column the *client* adds that was
            # never projected (an expanded lookup such as ``Owner/Title``) cannot
            # be invented here, so it is absent from a quiet window. Hold a
            # downstream schema check to the declared columns, not to whatever a
            # populated read happened to carry.
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
        self._check_columns_are_unique(frame)

    def _check_columns_are_unique(self, frame: pd.DataFrame) -> None:
        """Refuse a response carrying the same column label twice.

        A duplicate label makes ``frame[label]`` a *frame* rather than a series,
        and iterating a frame yields its column labels — so a list returning two
        ``ETag`` columns stamped every row with the literal string ``"ETag"``,
        silently, giving every item the same wrong version. Reading a column by
        name is the whole basis of the identity contract, so an ambiguous name
        is a contract breach and fails here rather than corrupting the metadata.
        """
        labels = [str(label) for label in frame.columns]
        duplicated = sorted({label for label in labels if labels.count(label) > 1})
        if duplicated:
            raise SharePointFeedError(
                f"SharePoint list {self._list_name!r} at "
                f"{redact_url(self._site)} returned duplicate column "
                f"{'names' if len(duplicated) > 1 else 'name'} "
                f"{', '.join(duplicated)}: a column read by name must be "
                "unambiguous."
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
    """The version observed **per row**: the list's own stamp, else a digest.

    Decided row by row, not for the response as a whole. Deciding it per response
    — "use the ETag column only if every row has one" — makes one row's blank
    stamp change the identity of every *other* row in that read, so an item that
    did not change comes back with a new ``source_observation_id`` and downstream
    reads it as "changed again".

    The digest deliberately excludes the version columns themselves: a partially
    populated ETag column would otherwise feed the fallback it triggered.
    """
    supplied = _supplied_versions(frame)
    payload = frame.drop(columns=[c for c in _VERSION_COLUMNS if c in frame.columns])
    return [
        stamp or _digest(payload.iloc[position])
        for position, stamp in enumerate(supplied)
    ]


def _supplied_versions(frame: pd.DataFrame) -> list[str]:
    """Each row's own version stamp, or ``""`` where the list supplied none."""
    stamps = [""] * len(frame)
    for column in _VERSION_COLUMNS:
        if column not in frame.columns:
            continue
        for position, value in enumerate(frame[column]):
            stamps[position] = stamps[position] or _canonical(value)
    return stamps


def _digest(row: "pd.Series") -> str:
    """A stable digest of one item's values.

    Covers the item's *projected* values, through the repository's one canonical
    identity encoding.
    """
    return sha256_json({str(column): _canonical(row[column]) for column in row.index})


def _observation_id(list_name: str, item_id: str, version: str) -> str:
    """The identity of "this item, at this version, in this list"."""
    return sha256_json({"list_name": list_name, "item_id": item_id, "version": version})


def _canonical(value: object) -> str:
    """One value as the text the digests and identity columns are built from.

    The shared rendering rule, plus this module's own null policy: a null
    becomes ``""``, the blank the ``Id``/``Modified`` guards reject. A key
    derivation refuses a null outright instead, which is why the rule itself
    returns ``None`` and leaves the choice here.
    """
    text = canonical_text(value)
    return "" if text is None else text

```
