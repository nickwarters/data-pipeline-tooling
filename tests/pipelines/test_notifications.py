"""Tests for the notification outbox and the two-silent-parties rule."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from framework.io import AppendOnly, Refresh
from framework.run import RunContext
from pipelines.notifications import pipeline as notifications
from pipelines.notifications.pipeline import (
    CASE_LINK_TEMPLATE,
    LEDGER_KEY,
    LEDGER_TABLE,
    SUBJECT,
    SUBJECT_LINE,
    SYNC_SUBJECT,
)
from tests.framework_testing import (
    build_databases,
    given_rows,
    read_rows,
    rows_of,
)
from tools.deliverables import NOTIFICATIONS_DESTINATION, get_deliverable_path
from tools.medallion import medallion
from tools.store import StoreRegistry

REVIEWER = "i:0#.w|CONTOSO\\A.Khan"
PARTY = "i:0#.w|CONTOSO\\B.Okafor"
MANAGER_LOGIN = "e.novak"

REVIEWER_EMAIL = "a.khan@example.invalid"
PARTY_EMAIL = "b.okafor@example.invalid"
MANAGER_EMAIL = "e.novak@example.invalid"

USERS = (
    "login,email,manager_login,manager_email\n"
    "a.khan,a.khan@example.invalid,m.iqbal,m.iqbal@example.invalid\n"
    "b.okafor,b.okafor@example.invalid,e.novak,e.novak@example.invalid\n"
    "e.novak,e.novak@example.invalid,m.iqbal,m.iqbal@example.invalid\n"
)

AS_OF = "2026-08-04T18:00:00+00:00"


# --- fixtures ---------------------------------------------------------------


def _case(
    case_id: str = "case-1",
    *,
    status: str = "In Progress",
    case_type: str = "claims",
    source_item_id: str = "42",
    reviewer: str = REVIEWER,
    party: str = PARTY,
) -> dict[str, object]:
    return {
        "case_id": case_id,
        "case_type": case_type,
        "source_item_id": source_item_id,
        "assigned_reviewer_name": reviewer,
        "responsible_party_name": party,
        "status": status,
        "as_of_utc": AS_OF,
    }


def _message(
    seq: int,
    author: str,
    posted_at: str,
    *,
    case_id: str = "case-1",
    observation: str = "obs-1",
) -> dict[str, object]:
    return {
        "case_id": case_id,
        "case_type": "claims",
        "source_item_id": "42",
        "source_observation_id": observation,
        "seq": seq,
        "author_login": author,
        "author_display_name": author,
        "posted_at": posted_at,
        "body": "hello",
        "as_of_utc": AS_OF,
    }


def _seed(base_dir: Path, cases: list[dict], messages: list[dict]) -> None:
    gold = medallion(StoreRegistry(base_dir), SYNC_SUBJECT).gold
    gold.writer("case_current", Refresh()).write(given_rows(cases).read())
    gold.writer("conversation_message", Refresh()).write(given_rows(messages).read())


@pytest.fixture()
def users_csv(tmp_path, monkeypatch):
    path = tmp_path / "users.csv"
    path.write_text(USERS, encoding="utf-8")
    monkeypatch.setattr(notifications, "users_path", lambda: path)
    return path


@pytest.fixture()
def base_dir(tmp_path):
    """A base directory with the two gold databases this pipeline touches.

    ``notifications`` reads Sync's gold and writes its own ledger subject, and
    both are under migration control — so the seeded Sync rows go into the
    tables Sync's baseline declares, and the ledger lands in the table its own
    baseline declares rather than one the first write invents.

    Gold on both sides is all this pipeline touches, so it is all that gets
    built: naming Sync as a whole subject would build its raw, silver and
    quarantine for nothing.
    """
    return build_databases(tmp_path, f"{SYNC_SUBJECT}/gold", f"{SUBJECT}/gold")


def _run(base_dir: Path, *, dry_run: bool = False):
    context = RunContext(
        base_dir=base_dir, subject=SUBJECT, pipeline="notifications", dry_run=dry_run
    )
    return notifications.run(context)


def _files(base_dir: Path) -> list[Path]:
    outbox = get_deliverable_path(base_dir, NOTIFICATIONS_DESTINATION)
    return sorted(outbox.glob("*.json")) if outbox.exists() else []


def _payload(base_dir: Path) -> list[dict]:
    files = _files(base_dir)
    assert len(files) == 1, f"expected exactly one notification file, got {files}"
    return json.loads(files[0].read_text(encoding="utf-8"))


def _recipients(base_dir: Path) -> list[str]:
    payload = _payload(base_dir)
    assert len(payload) == 1
    return payload[0]["recipients"].split(";")


def _ledger(base_dir: Path) -> list[dict]:
    store = medallion(StoreRegistry(base_dir), SUBJECT).gold
    return read_rows(store, LEDGER_TABLE)


# --- the rule's four worked sequences ---------------------------------------


def test_the_reviewer_posting_notifies_the_party_and_their_manager(base_dir, users_csv):
    _seed(
        base_dir,
        [_case()],
        [_message(0, "a.khan", "2026-08-04T16:02:00.000Z")],
    )

    _run(base_dir)

    assert _recipients(base_dir) == sorted([PARTY_EMAIL, MANAGER_EMAIL])


def test_the_party_replying_notifies_the_reviewer_and_the_manager(base_dir, users_csv):
    _seed(
        base_dir,
        [_case()],
        [
            _message(0, "a.khan", "2026-08-04T16:02:00.000Z"),
            _message(1, "b.okafor", "2026-08-04T18:47:12.000Z"),
        ],
    )

    _run(base_dir)

    assert _recipients(base_dir) == sorted([REVIEWER_EMAIL, MANAGER_EMAIL])


def test_the_manager_replying_still_notifies_the_party_who_never_answered(
    base_dir, users_csv
):
    # The whole point of the rule: an earlier candidate would have treated the
    # Manager's post as the side's reply and left the Responsible Party untold.
    _seed(
        base_dir,
        [_case()],
        [
            _message(0, "a.khan", "2026-08-04T16:02:00.000Z"),
            _message(1, MANAGER_LOGIN, "2026-08-04T18:47:12.000Z"),
        ],
    )

    _run(base_dir)

    assert _recipients(base_dir) == sorted([REVIEWER_EMAIL, PARTY_EMAIL])


def test_two_messages_from_one_party_notify_the_same_two_people_once(
    base_dir, users_csv
):
    _seed(
        base_dir,
        [_case()],
        [
            _message(0, "b.okafor", "2026-08-04T16:02:00.000Z"),
            _message(1, "b.okafor", "2026-08-04T16:09:00.000Z"),
        ],
    )

    _run(base_dir)

    assert _recipients(base_dir) == sorted([REVIEWER_EMAIL, MANAGER_EMAIL])
    assert [row["message_at"] for row in _ledger(base_dir)] == [
        "2026-08-04T16:09:00.000Z"
    ] * 2


# --- dedupe -----------------------------------------------------------------


def test_a_second_pass_over_identical_gold_emits_no_file_at_all(base_dir, users_csv):
    _seed(base_dir, [_case()], [_message(0, "a.khan", "2026-08-04T16:02:00.000Z")])
    _run(base_dir)
    assert len(_files(base_dir)) == 1

    result = _run(base_dir)

    assert len(result) == 0
    assert len(_files(base_dir)) == 1


def test_an_unrelated_edit_giving_a_new_observation_id_notifies_nobody_again(
    base_dir, users_csv
):
    _seed(base_dir, [_case()], [_message(0, "a.khan", "2026-08-04T16:02:00.000Z")])
    _run(base_dir)

    # A Case gets a new observation for any edit; the Message did not move.
    _seed(
        base_dir,
        [_case(status="In Progress")],
        [_message(0, "a.khan", "2026-08-04T16:02:00.000Z", observation="obs-2")],
    )
    result = _run(base_dir)

    assert len(result) == 0
    assert len(_files(base_dir)) == 1


def test_a_newer_message_re_notifies_the_two_who_did_not_post_it(base_dir, users_csv):
    _seed(base_dir, [_case()], [_message(0, "a.khan", "2026-08-04T16:02:00.000Z")])
    _run(base_dir)
    first = _files(base_dir)[0]

    _seed(
        base_dir,
        [_case()],
        [
            _message(0, "a.khan", "2026-08-04T16:02:00.000Z"),
            _message(1, "b.okafor", "2026-08-04T18:47:12.000Z"),
        ],
    )
    _run(base_dir)

    later = [path for path in _files(base_dir) if path != first]
    assert len(later) == 1
    payload = json.loads(later[0].read_text(encoding="utf-8"))
    assert payload[0]["recipients"].split(";") == sorted(
        [REVIEWER_EMAIL, MANAGER_EMAIL]
    )
    assert PARTY_EMAIL not in payload[0]["recipients"]


# --- who is skipped ---------------------------------------------------------


def test_a_terminal_case_notifies_nobody(base_dir, users_csv):
    _seed(
        base_dir,
        [_case(status="Completed")],
        [_message(0, "a.khan", "2026-08-04T16:02:00.000Z")],
    )

    result = _run(base_dir)

    assert len(result) == 0
    assert _files(base_dir) == []


def test_a_party_the_directory_does_not_know_is_skipped_not_substituted(
    base_dir, users_csv
):
    _seed(
        base_dir,
        [_case(party="i:0#.w|CONTOSO\\z.stranger")],
        [_message(0, "a.khan", "2026-08-04T16:02:00.000Z")],
    )

    result = _run(base_dir)

    # No Responsible Party row means no email and no manager edge: nobody is
    # left to tell, and nothing is written claiming they were told.
    assert len(result) == 0
    assert _files(base_dir) == []


def test_a_party_who_is_their_own_manager_collapses_to_one_recipient(
    base_dir, users_csv, monkeypatch
):
    path = base_dir / "self-managed.csv"
    path.write_text(
        "login,email,manager_login,manager_email\n"
        "a.khan,a.khan@example.invalid,m.iqbal,m.iqbal@example.invalid\n"
        "b.okafor,b.okafor@example.invalid,b.okafor,b.okafor@example.invalid\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(notifications, "users_path", lambda: path)
    _seed(base_dir, [_case()], [_message(0, "a.khan", "2026-08-04T16:02:00.000Z")])

    _run(base_dir)

    assert _recipients(base_dir) == [PARTY_EMAIL]


def test_a_manager_the_directory_learns_later_is_told_and_the_party_is_not_again(
    base_dir, monkeypatch
):
    without_manager = base_dir / "no-manager.csv"
    without_manager.write_text(
        "login,email,manager_login,manager_email\n"
        "a.khan,a.khan@example.invalid,m.iqbal,m.iqbal@example.invalid\n"
        "b.okafor,b.okafor@example.invalid,,\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(notifications, "users_path", lambda: without_manager)
    _seed(base_dir, [_case()], [_message(0, "a.khan", "2026-08-04T16:02:00.000Z")])
    _run(base_dir)
    assert _recipients(base_dir) == [PARTY_EMAIL]
    first = _files(base_dir)[0]

    with_manager = base_dir / "with-manager.csv"
    with_manager.write_text(USERS, encoding="utf-8")
    monkeypatch.setattr(notifications, "users_path", lambda: with_manager)
    _run(base_dir)

    later = [path for path in _files(base_dir) if path != first]
    assert len(later) == 1
    payload = json.loads(later[0].read_text(encoding="utf-8"))
    assert payload[0]["recipients"] == MANAGER_EMAIL
    assert sorted(row["recipient"] for row in _ledger(base_dir)) == sorted(
        [PARTY_EMAIL, MANAGER_EMAIL]
    )


# --- the deliverable's contract ---------------------------------------------


def test_the_file_is_an_array_of_objects_carrying_exactly_the_three_keys(
    base_dir, users_csv
):
    _seed(
        base_dir,
        [_case(), _case("case-2", source_item_id="43")],
        [
            _message(0, "a.khan", "2026-08-04T16:02:00.000Z"),
            _message(0, "a.khan", "2026-08-04T16:03:00.000Z", case_id="case-2"),
        ],
    )

    _run(base_dir)
    payload = _payload(base_dir)

    assert isinstance(payload, list)
    assert len(payload) == 2
    assert all(
        list(notification) == ["recipients", "subject", "body"]
        for notification in payload
    )
    for notification in payload:
        assert notification["subject"] == SUBJECT_LINE
        assert "; " not in notification["recipients"]
        assert " ;" not in notification["recipients"]
        assert notification["recipients"].split(";") == sorted(
            notification["recipients"].split(";")
        )


def test_the_body_is_a_paragraph_and_one_link_with_no_styling_at_all(
    base_dir, users_csv
):
    _seed(base_dir, [_case()], [_message(0, "a.khan", "2026-08-04T16:02:00.000Z")])

    _run(base_dir)
    body = _payload(base_dir)[0]["body"]

    assert body.count("<a href=") == 1
    expected = CASE_LINK_TEMPLATE.format(case_type="claims", source_item_id="42")
    assert f'<a href="{expected}"' in body
    assert "<style" not in body
    assert "style=" not in body
    assert "<table" not in body
    assert body.count("<p>") == 2


def test_an_interpolated_value_is_html_escaped_into_the_link(base_dir, users_csv):
    _seed(
        base_dir,
        [_case(source_item_id='42"><script>alert(1)</script>')],
        [_message(0, "a.khan", "2026-08-04T16:02:00.000Z")],
    )

    _run(base_dir)
    body = _payload(base_dir)[0]["body"]

    assert "<script>" not in body
    assert "&quot;&gt;&lt;script&gt;" in body
    assert body.count("<a href=") == 1


# --- run mechanics ----------------------------------------------------------


def test_a_dry_run_writes_no_file_and_records_nobody_as_told(base_dir, users_csv):
    _seed(base_dir, [_case()], [_message(0, "a.khan", "2026-08-04T16:02:00.000Z")])

    result = _run(base_dir, dry_run=True)

    assert len(result) == 2
    assert _files(base_dir) == []
    # The ledger table exists before the run — its migration created it — so
    # "recorded nobody" is that it is still empty rather than still absent.
    assert _ledger(base_dir) == []

    # And the pass that follows still tells them.
    _run(base_dir)
    assert _recipients(base_dir) == sorted([PARTY_EMAIL, MANAGER_EMAIL])


def test_re_presenting_a_ledger_row_is_a_no_op_rather_than_a_conflict(base_dir):
    # The reason the row is exactly its key. A crash between the outbox write
    # and the ledger write leaves rows to re-present on the next pass; a
    # non-key column would make the append-only comparison see a value move and
    # abort, turning a duplicate notification into a stuck pipeline.
    store = medallion(StoreRegistry(base_dir), SUBJECT).gold
    rows = [
        {
            "case_id": "case-1",
            "recipient": PARTY_EMAIL,
            "message_at": "2026-08-04T16:02:00.000Z",
        }
    ]

    store.writer(LEDGER_TABLE, AppendOnly(LEDGER_KEY)).write(given_rows(rows).read())
    store.writer(LEDGER_TABLE, AppendOnly(LEDGER_KEY)).write(given_rows(rows).read())

    assert [{key: row[key] for key in LEDGER_KEY} for row in _ledger(base_dir)] == rows


def test_the_first_pass_tolerates_an_empty_ledger(base_dir, users_csv):
    # The first pass of a migrated subject reads a ledger that exists and holds
    # nothing, rather than one that is absent.
    _seed(base_dir, [_case()], [_message(0, "a.khan", "2026-08-04T16:02:00.000Z")])
    assert _ledger(base_dir) == []

    _run(base_dir)

    assert len(_ledger(base_dir)) == 2


def test_the_ledger_reader_still_tolerates_a_table_that_is_absent(tmp_path):
    # The absent-table branch of ledger_reader is unreachable for this subject
    # now that it is migrated, but it is not dead: a store *not* under migration
    # control still creates its tables on first write, so a reader that assumed
    # the table existed would fail on that store's first pass. Driven against a
    # bare base directory, which is exactly such a store.
    store = medallion(StoreRegistry(tmp_path), SUBJECT).gold
    assert store.columns_of(LEDGER_TABLE).columns() is None

    assert rows_of(notifications.ledger_reader(store)()) == []


# --- the recipient rule, without the store --------------------------------


def _recipients_of(last_author: str, *, party: str = PARTY) -> list[str]:
    threads = given_rows(
        [
            {
                "case_id": "case-1",
                "last_author_login": last_author,
                "message_at": "2026-08-04T16:02:00.000Z",
                "case_type": "claims",
                "source_item_id": "42",
                "assigned_reviewer_name": REVIEWER,
                "responsible_party_name": party,
            }
        ]
    ).read()
    users = given_rows(
        [
            {
                "login": "a.khan",
                "email": REVIEWER_EMAIL,
                "manager_login": "m.iqbal",
                "manager_email": "m.iqbal@example.invalid",
            },
            {
                "login": "b.okafor",
                "email": PARTY_EMAIL,
                "manager_login": MANAGER_LOGIN,
                "manager_email": MANAGER_EMAIL,
            },
        ]
    ).read()
    return [
        row["recipient"] for row in rows_of(notifications.recipients_of(threads, users))
    ]


def test_a_case_with_no_responsible_party_notifies_only_the_reviewer_side():
    assert _recipients_of(MANAGER_LOGIN, party="") == [REVIEWER_EMAIL]


def test_the_outbox_filename_is_unique_per_pass_and_legal_on_windows():
    name = notifications.outbox_filename(
        "2026-08-15T12:00:00+00:00", "abcdef0123456789"
    )
    other = notifications.outbox_filename(
        "2026-08-15T12:00:00+00:00", "9876543210fedcba"
    )

    assert name != other
    assert not set(name) & set(':\\/*?"<>|')
    assert name.endswith(".json")
