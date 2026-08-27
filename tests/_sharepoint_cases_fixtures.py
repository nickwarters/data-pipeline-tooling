"""Shared ``sharepoint_cases`` test scaffolding: the feed's test vocabulary.

The suites for this feed live in ``tests/pipelines/test_sharepoint_cases/`` and
``tests/integration/test_sharepoint_cases_whole_feed.py``. What both trees need
is declared here once, in four groups:

- **The lists and the clock** — the two ``CaseList``s the tests poll, their
  checkpoint sources, and the instants a poll is judged against.
- **The source** — ``FakeListClient`` replays frames per list with an advancing
  clock, and ``item()`` / ``later_item()`` fill in every ``RAW_FEED_COLUMNS``
  entry a real ``$select=*`` read carries.
- **The hops** — ``run()`` drives the feed with an ambient context, and
  ``landed()`` / ``version()`` hand back one hop's rows in the next hop's
  vocabulary.
- **Gold** — ``current()`` / ``details()`` / ``aggregate()`` drive one gold
  build in memory, composed from the real transforms rather than hand-built.

Nothing here reaches a tenant: the organisational SharePoint client is a seam,
so every test hands the Reader a fake that replays frames.
"""

from __future__ import annotations

import datetime as dt
import sqlite3
from functools import partial
from uuid import UUID

import pandas as pd

from framework.core import Dataset, Reader
from framework.io import DatasetReader
from framework.run import RunContext, active_context, read, transform, write
from framework.transform import Stamp
from pipelines.sharepoint_cases.gold import (
    DETAIL_GRAIN,
    to_gold_case_current,
    to_gold_detail,
)
from pipelines.sharepoint_cases.pipeline import (
    EXPAND_FIELDS,
    FEED_NAME,
    PERSON_SUBFIELDS,
    RAW_FEED_COLUMNS,
    RENAME,
    SAFETY_LAG,
    SOURCE_COLUMNS,
    to_raw,
)
from pipelines.sharepoint_cases.pipeline import run as _run
from pipelines.sharepoint_cases.schema import CASE_LISTS, SITE, CaseList
from tests.framework_testing import (
    RecordingRunLog,
    RecordingWriter,
    given_rows,
    rows_of,
)
from tools.integrations.sharepoint_checkpoint import SharePointSource
from tools.integrations.sharepoint_rest import ModifiedWindow, SharePointModifiedReader

# --- the lists and the clock -------------------------------------------------

COMPLAINTS = CASE_LISTS[0]
# A second list, declared here rather than in CASE_LISTS: only one Case Type is
# provisioned today, and multi-list behaviour still has to be proven.
OTHER = CaseList("other", "Cases-Other", SITE, UUID(int=7))
TWO_LISTS = (COMPLAINTS, OTHER)

SOURCE = SharePointSource(COMPLAINTS.site, COMPLAINTS.list_id)
OTHER_SOURCE = SharePointSource(OTHER.site, OTHER.list_id)

SERVER_NOW = dt.datetime(2026, 8, 5, 9, tzinfo=dt.timezone.utc)
WINDOW = ModifiedWindow(start=None, end=SERVER_NOW - SAFETY_LAG)

# How far a multi-run client's clock moves between polls. A successful run now
# commits the watermark, and `window()` answers `None` when the safe upper bound
# has not advanced past it — so a second `run()` against a *frozen* clock returns
# before it reaches the list, and a test meaning to poll twice must let time pass.
NEXT_POLL = dt.timedelta(minutes=10)

# The instant gold is published as of: the candidate window end of a first poll.
AS_OF = SERVER_NOW - SAFETY_LAG

# Every column silver holds, in the order it holds them — which is exactly the
# feed's rename map read the other way round.
SILVER_COLUMNS = tuple(RENAME.values())


# --- the source --------------------------------------------------------------


class FakeListClient:
    """A ``CaseListClient`` replaying frames per list, with a clock.

    Positional frames are served in call order to whichever list asks;
    ``by_list`` gives a named list its own. ``advance`` moves the clock on
    after each ``server_time()`` call.
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
    """One list item in the shape SharePoint returns it: every column present
    (a real read leads with ``$select=*``), an expanded Person as a nested
    object or ``null``, and unmentioned columns null.
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


def later_item(**overrides: object) -> dict[str, object]:
    """The same list item, re-observed: a later ``Modified`` and the next etag.

    A second poll's item has to move both, or it is the *same* observation and
    silver no-ops it — so the pair is one idea and lives in one place.
    """
    row = item(**overrides)
    row.update({"Modified": "2026-08-05T08:45:00Z", "odata.etag": '"4"'})
    return row


def items(*rows: dict[str, object]) -> pd.DataFrame:
    return pd.DataFrame(list(rows) or [item()])


# --- the hops ----------------------------------------------------------------


def run(context: RunContext, **kwargs):
    """Drive the pipeline with ``context`` ambient, exactly as ``run_pipeline`` does.

    The eager steps read the *ambient* run context, not one passed as an
    argument -- so a ``RunContext(dry_run=True)`` handed straight to ``run``
    would be unseen and the writes it is meant to hold back would land.
    """
    with active_context(context):
        return _run(context, **kwargs)


def source_reader(
    client: FakeListClient, case_list: CaseList = COMPLAINTS
) -> SharePointModifiedReader:
    """The feed's real Reader over a fake client."""
    return SharePointModifiedReader(
        case_list.site,
        case_list.list_name,
        SOURCE_COLUMNS,
        WINDOW,
        expand_fields=EXPAND_FIELDS,
        client=client,
    )


def landed(client: FakeListClient, case_list: CaseList = COMPLAINTS) -> list[dict]:
    """The rows ``to_raw`` would store for ``client``'s response."""
    writer = RecordingWriter()
    to_raw(source_reader(client, case_list), writer, case_list)
    return rows_of(writer)


def version(**overrides: object) -> dict[str, object]:
    """One silver row — one observation of a Case — in gold's own vocabulary.

    Every silver column is present, because gold reads a landed table and not a
    tidy projection of one. The observation id is derived from the item and the
    version, as the Reader derives it, unless a test names its own.
    """
    row: dict[str, object] = dict.fromkeys(SILVER_COLUMNS)
    row.update(
        {
            "id": 101,
            "status": "In-progress",
            "assigned_reviewer_name": "i:0#.w|CONTOSO\\p.shah",
            "assigned_reviewer_manager_name": "i:0#.w|CONTOSO\\d.reid",
            "case_type": COMPLAINTS.case_type,
            "created": "2026-07-01 09:14:00+00:00",
            "source_list_name": COMPLAINTS.list_name,
            "source_item_id": "101",
            "source_version": '"3"',
            "source_modified_at": "2026-08-05 08:10:00+00:00",
        }
    )
    row.update(overrides)
    if row["source_observation_id"] is None:
        row["source_observation_id"] = (
            f"{row['source_item_id']}@{row['source_version']}"
        )
    return row


def two_observations(item_id: str = "101", prefix: str = "obs") -> tuple[dict, dict]:
    """An early and a winning observation of one Case, ids prefixed for a test."""
    early = version(
        id=int(item_id),
        source_item_id=item_id,
        source_observation_id=f"{prefix}-1",
        source_version='"3"',
        source_modified_at="2026-08-05 08:10:00+00:00",
    )
    late = version(
        id=int(item_id),
        source_item_id=item_id,
        source_observation_id=f"{prefix}-2",
        source_version='"4"',
        source_modified_at="2026-08-05 08:45:00+00:00",
        status="Completed",
    )
    return early, late


def appeal(**overrides: object) -> dict[str, object]:
    """One Appeal element in the shape the app writes it: raised, no
    citations, no resolution -- overridden per test."""
    row: dict[str, object] = {
        "id": "appeal-1754040000000",
        "appellant": "e.novak",
        "at": "2026-08-01T09:00:00Z",
        "rationale": "The redress figure had already been paid directly.",
        "state": "raised",
    }
    row.update(overrides)
    return row


# --- gold --------------------------------------------------------------------


def gold_rows(builder, rows: list[dict], *, as_of: dt.datetime = AS_OF) -> list[dict]:
    """Drive one gold build in memory and hand back what it would have written."""
    writer = RecordingWriter()
    builder(given_rows(rows), writer, as_of=as_of)
    return rows_of(writer)


def current(*rows: dict) -> list[dict]:
    """The ``case_current`` rows for a silver history."""
    return gold_rows(to_gold_case_current, list(rows))


def winning_reader(*rows: dict) -> Reader:
    """The gold ``case_current`` a parent observation history would produce.

    Composes the real ``to_gold_case_current`` rather than hand-building the
    winning pairs: the invariant worth testing is that a Detail row agrees with
    whichever observation the parent's own reduction picked, not that an inner
    join drops non-matching rows.
    """
    return given_rows(current(*rows))


def details(
    children: list[dict], winners: Reader, *, table: str = "answer"
) -> list[dict]:
    """Drive ``to_gold_detail`` over a child history, in memory.

    ``table`` names which declared grain to reduce on; the builder is generic
    over ``DETAIL_GRAIN``, so ``answer`` stands for all of them unless a test
    is about a particular table's own key.
    """
    return gold_rows(
        partial(
            to_gold_detail,
            grain=DETAIL_GRAIN[table],
            observations=winners,
            name=f"{FEED_NAME}:gold:detail:{table}",
        ),
        children,
    )


def given_columns(*names: str) -> Reader:
    """A zero-**row**, declared-column source -- what a quiet poll really hands
    an aggregate transform, unlike ``given_rows([])``'s zero-**column** frame,
    which no production path emits.
    """
    return DatasetReader(Dataset.from_pandas(pd.DataFrame(columns=list(names))))


def to_gold_aggregate(reader, writer, *, table: str, reduce, step: str) -> Dataset:
    """Drive one aggregate exactly as ``publish_gold``'s loop does."""
    at = f"gold:{table}"
    data = read(reader, name=f"{at}:read")
    data = transform(reduce, data, name=f"{at}:{step}")
    data = transform(
        Stamp("as_of_utc", AS_OF.isoformat()), data, name=f"{at}:stamp-as-of"
    )
    return write(writer, data, name=f"{at}:write")


def aggregate(reduce, step: str, rows: list[dict]) -> list[dict]:
    """Drive one aggregate, as ``publish_gold`` wires it, over ``rows``."""
    writer = RecordingWriter()
    to_gold_aggregate(
        given_rows(rows),
        writer,
        table="table",
        reduce=reduce,
        step=step,
    )
    return rows_of(writer)


# --- reading what a real run left behind -------------------------------------


def nothing_landed(base_dir) -> bool:
    """Whether the subject's databases are all still empty.

    "The run wrote nothing" used to be "the subject's directory does not exist":
    nothing created it because nothing wrote. Under migration control the
    databases exist before the run does anything, so the claim has to be made
    about their contents instead — which is the thing those tests meant all
    along.
    """
    for db_path in sorted((base_dir / FEED_NAME).glob("*.db")):
        connection = sqlite3.connect(db_path)
        try:
            tables = [
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' "
                    "AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'"
                )
            ]
            for table in tables:
                if connection.execute(f'SELECT 1 FROM "{table}" LIMIT 1').fetchone():
                    return False
        finally:
            connection.close()
    return True


def published_gold(run_log: RecordingRunLog) -> set[str]:
    """Which gold tables a run actually published into, per its own record.

    This used to read ``sqlite_master``: a gold table existed exactly when a
    run had created it by writing, so presence answered "was gold published?".
    Under migration control every gold table exists before the run does
    anything — the migration created it — so presence answers nothing, and the
    question has to be put to the run instead. A committed write record naming
    a gold location is the publication, whether it carried rows or not, which
    also makes the quiet-window case say what it means rather than relying on
    an empty table having been created as a side effect.
    """
    return {
        location["name"]
        for record in run_log.records
        if record.get("committed") and record["step"].startswith("gold:")
        for location in record.get("data_locations") or []
    }


def quarantine_rows(base_dir) -> dict[str, list[dict]]:
    """Every non-empty reject table of this feed's quarantine database.

    Read with sqlite3 rather than a Store Reader: the quarantine file is a
    sibling of the layer that writes to it, not a namespace the registry mints.
    """
    con = sqlite3.connect(base_dir / FEED_NAME / "quarantine.db")
    con.row_factory = sqlite3.Row
    try:
        tables = [
            name
            for (name,) in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name <> 'schema_migrations' ORDER BY name"
            )
        ]
        landed = {
            table: [dict(row) for row in con.execute(f'SELECT * FROM "{table}"')]
            for table in tables
        }
    finally:
        con.close()
    return {table: rows for table, rows in landed.items() if rows}
