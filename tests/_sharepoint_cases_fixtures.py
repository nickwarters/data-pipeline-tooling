"""Shared ``sharepoint_cases`` test scaffolding: a fake list client and a
baseline SharePoint list item.

Both `tests/pipelines/test_sharepoint_cases.py` (one hop, one table at a time)
and `tests/integration/test_sharepoint_cases_whole_feed.py` (the whole feed,
one system) drive the real pipeline against a fake ``CaseListClient`` built
from the same two pieces: ``FakeListClient`` replays frames per list with an
advancing clock, and ``item()`` fills in every ``RAW_FEED_COLUMNS`` entry a
real ``$select=*`` read carries. Kept in one place, per the repo's convention
of shared test helpers living at the `tests/` root (see
`tests/_schema_fixtures.py`), so each test module describes its own fixture
payload rather than this scaffolding, twice.
"""

from __future__ import annotations

import datetime as dt

import pandas as pd

from pipelines.sharepoint_cases.pipeline import PERSON_SUBFIELDS, RAW_FEED_COLUMNS

SERVER_NOW = dt.datetime(2026, 8, 5, 9, tzinfo=dt.timezone.utc)


class FakeListClient:
    """A ``CaseListClient`` replaying frames per list, with a clock.

    The positional frames are served in call order to whichever list asks;
    ``by_list`` gives a named list its own. ``advance`` moves the clock on after
    each ``server_time()`` — one step per poll — so a single client can serve a
    test that runs the feed more than once.
    """

    def __init__(
        self,
        *frames: pd.DataFrame,
        server_now: dt.datetime = SERVER_NOW,
        advance: dt.timedelta = dt.timedelta(0),
        by_list: dict[str, list[pd.DataFrame]] | None = None,
    ):
        self._frames = list(frames) or [items()]
        self._by_list = {name: list(f) for name, f in (by_list or {}).items()}
        self._server_now = server_now
        self._advance = advance
        self.calls: list[dict[str, object]] = []

    def fetch_items(self, list_name, expand_fields, select_fields, filters):
        self.calls.append(
            {
                "list_name": list_name,
                "expand_fields": list(expand_fields),
                "select_fields": list(select_fields),
            }
        )
        frames = self._by_list.get(list_name, self._frames)
        polled = sum(1 for call in self.calls if call["list_name"] == list_name)
        return frames[min(polled - 1, len(frames) - 1)].copy()

    def server_time(self) -> dt.datetime:
        now = self._server_now
        self._server_now = now + self._advance
        return now


def item(**overrides: object) -> dict[str, object]:
    """One list item in the shape SharePoint returns it.

    A real read leads with ``$select=*``, so every column is present; and an
    expanded Person answers as a **nested object** on the property, or ``null``
    where nobody holds the role. The fake must not be tidier than the payload, or
    the tests stop proving anything about the real path. Unmentioned columns are
    null, which is what most of them are on a live row.
    """
    row: dict[str, object] = {
        "Id": 101,
        "Modified": "2026-08-05T08:10:00Z",
        # SharePoint's etag carries its own quotes.
        "odata.etag": '"3"',
        "Title": "CMP-000101",
        "CaseType": "complaints",
        "Status": "In-progress",
        "AssignedReviewer": {"Name": "i:0#.w|CONTOSO\\a.khan"},
        "ResponsibleParty": {
            "Name": "i:0#.w|CONTOSO\\b.okafor",
            "Title": "Bola Okafor",
        },
        "AssignedReviewerManager": {"Name": "i:0#.w|CONTOSO\\d.reid"},
        "ResponsiblePartyManager": {"Name": "i:0#.w|CONTOSO\\e.novak"},
        "VoidedBy": None,
        "DueDate": "2026-08-14T00:00:00Z",
        "Created": "2026-07-01T09:14:00Z",
        "HasOpenAppeal": False,
        "OnHold": False,
        "Notes": "Awaiting the call recording.",
        "Answers": '{"q-outcome":{"value":"Not upheld"}}',
    }
    # Every stored column the fixture did not name, minus the ones the feed
    # derives: the persons arrive nested above, and the provenance is stamped.
    flattened = {
        f"{person}/{sub}" for person, subs in PERSON_SUBFIELDS.items() for sub in subs
    }
    absent = [
        column
        for column in RAW_FEED_COLUMNS
        if column not in row
        and column not in flattened
        and not column.startswith("source_")
    ]
    row.update(dict.fromkeys(absent))
    row.update(overrides)
    return row


def items(*rows: dict[str, object]) -> pd.DataFrame:
    return pd.DataFrame(list(rows) or [item()])
