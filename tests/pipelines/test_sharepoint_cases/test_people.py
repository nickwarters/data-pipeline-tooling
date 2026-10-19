"""People: the bare account on every Case row, and what is known about each.

Silver reduces each Person column to the lower-cased bare account, so a Case
row joins to the JSON blobs, the Staff Hierarchy and the platform on one
spelling. What that reduction drops -- the domain, the display name, the
email -- goes to the silver ``person`` table: user details only, one row per
person, which each poll merges its people into and upserts on ``account``.
"""

from __future__ import annotations

import json
import shutil
import sqlite3
from dataclasses import fields

import pandas as pd
import pytest

from framework.core import Dataset
from framework.io import DatasetReader
from framework.run import RunContext
from pipelines.sharepoint_cases.gold import PERSON_CURRENT_TABLE
from pipelines.sharepoint_cases.pipeline import (
    FEED_NAME,
    PERSON_NAME_COLUMNS,
    PERSON_SUBFIELDS,
    PERSON_TABLE,
    SIGHTING_ONLY_COLUMNS,
    to_silver,
    to_silver_person,
)
from pipelines.sharepoint_cases.schema import PersonRow
from shared.account_names import to_bare_account
from tests._sharepoint_cases_fixtures import (
    COMPLAINTS,
    NEXT_POLL,
    SERVER_NOW,
    FakeListClient,
    item,
    items,
    landed,
    later_item,
    person,
    quarantine_rows,
    run,
)
from tests.framework_testing import (
    RecordingWriter,
    given_rows,
    read_rows,
    rows_of,
)
from tools.medallion import medallion
from tools.migrations import MIGRATIONS_ROOT, MigrationRunner
from tools.store import StoreRegistry

PERSON_COLUMNS = tuple(field.name for field in fields(PersonRow))

# --- silver: the Case row ----------------------------------------------------


def test_silver_holds_each_person_as_the_lower_cased_bare_account():
    raw = landed(
        FakeListClient(
            items(item(AssignedReviewer=person("CONTOSO\\A.Khan", "Aisha Khan")))
        )
    )
    writer = RecordingWriter()

    to_silver(given_rows(raw), writer, COMPLAINTS)

    [row] = rows_of(writer)
    # Raw stays faithful to the login the list gave.
    assert raw[0]["AssignedReviewer/Name"] == "i:0#.w|CONTOSO\\A.Khan"
    assert {column: row[column] for column in PERSON_NAME_COLUMNS} == {
        "assigned_reviewer_name": "a.khan",
        "responsible_party_name": "b.okafor",
        "assigned_reviewer_manager_name": "d.reid",
        "responsible_party_manager_name": "e.novak",
        "current_reviewer_manager_name": "d.reid",
        "current_responsible_party_manager_name": "e.novak",
        # Nobody is a null, not an empty string.
        "voided_by_name": None,
    }
    # The details beside each login are the sighting table's, not the Case's.
    assert not set(SIGHTING_ONLY_COLUMNS) & set(row)


# --- the current managers ----------------------------------------------------

# A Case whose people have moved on since the Reviewer and the Responsible
# Party were set: the at-the-time record still names who managed them then,
# and the current pair, kept up to date outside the platform, who does now.
MOVED_ON = {
    "CurrentReviewerManager": person("CONTOSO\\K.Adeyemi", "Kemi Adeyemi"),
    "CurrentResponsiblePartyManager": person("OTHERDOM\\m.osei", "Mo Osei"),
}


def test_the_read_asks_for_both_current_managers_beside_the_at_the_time_pair():
    client = FakeListClient()

    landed(client)

    [call] = client.calls
    for manager in (
        "AssignedReviewerManager",
        "ResponsiblePartyManager",
        "CurrentReviewerManager",
        "CurrentResponsiblePartyManager",
    ):
        assert manager in call["expand_fields"]
        assert {f"{manager}/{sub}" for sub in ("Name", "Title", "EMail")} <= set(
            call["select_fields"]
        )


def test_silver_keeps_the_current_managers_apart_from_the_at_the_time_record():
    raw = landed(FakeListClient(items(item(**MOVED_ON))))
    writer = RecordingWriter()

    to_silver(given_rows(raw), writer, COMPLAINTS)

    [row] = rows_of(writer)
    # Raw keeps the logins the list gave, in the list's own names.
    assert raw[0]["CurrentReviewerManager/Name"] == "i:0#.w|CONTOSO\\K.Adeyemi"
    assert raw[0]["CurrentResponsiblePartyManager/EMail"] == "M.Osei@contoso.com"
    # Silver reduces both to the bare account, and the record is untouched.
    assert (
        row["current_reviewer_manager_name"],
        row["current_responsible_party_manager_name"],
    ) == ("k.adeyemi", "m.osei")
    assert (
        row["assigned_reviewer_manager_name"],
        row["responsible_party_manager_name"],
    ) == ("d.reid", "e.novak")


def test_a_case_nobody_currently_manages_holds_null_current_managers():
    raw = landed(
        FakeListClient(
            items(
                item(CurrentReviewerManager=None, CurrentResponsiblePartyManager=None)
            )
        )
    )
    writer = RecordingWriter()

    to_silver(given_rows(raw), writer, COMPLAINTS)

    [row] = rows_of(writer)
    assert row["current_reviewer_manager_name"] is None
    assert row["current_responsible_party_manager_name"] is None
    # The record of who managed them then is a separate fact, and still held.
    assert row["assigned_reviewer_manager_name"] == "d.reid"


def test_both_manager_pairs_reach_gold_and_the_current_managers_are_people(
    base_dir,
):
    run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME),
        client=FakeListClient(items(item(**MOVED_ON))),
    )

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    [case] = read_rows(med.gold, "case_current")
    assert {
        column: case[column]
        for column in (
            "assigned_reviewer_manager_name",
            "responsible_party_manager_name",
            "current_reviewer_manager_name",
            "current_responsible_party_manager_name",
        )
    } == {
        "assigned_reviewer_manager_name": "d.reid",
        "responsible_party_manager_name": "e.novak",
        "current_reviewer_manager_name": "k.adeyemi",
        "current_responsible_party_manager_name": "m.osei",
    }
    people = {row["account"]: row for row in read_rows(med.gold, PERSON_CURRENT_TABLE)}
    assert (
        people["k.adeyemi"]["domain"],
        people["k.adeyemi"]["display_name"],
        people["k.adeyemi"]["email"],
    ) == ("CONTOSO", "Kemi Adeyemi", "k.adeyemi@contoso.com")
    assert people["m.osei"]["domain"] == "OTHERDOM"
    # The at-the-time managers are still people this feed has seen named.
    assert {"d.reid", "e.novak"} <= set(people)


def test_a_root_cause_person_reaches_person_current(base_dir):
    # A person is named in rcaCapture exactly as one in capture is, so nobody
    # a Manager picks as accountable is missing from the people table.
    answers = {
        "q-1": {
            "value": "x",
            "rcaCapture": {
                "accountable": {"loginName": "N.Park", "displayName": "Nia Park"}
            },
        }
    }
    run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME),
        client=FakeListClient(items(item(Answers=json.dumps(answers)))),
    )

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    people = {row["account"]: row for row in read_rows(med.gold, PERSON_CURRENT_TABLE)}
    assert people["n.park"]["display_name"] == "Nia Park"
    [root_cause] = read_rows(med.gold, "answer_root_cause")
    assert root_cause["value_kind"] == "person"


def test_a_quarantined_case_keeps_both_manager_pairs(base_dir):
    run(
        RunContext(base_dir=base_dir, pipeline=FEED_NAME),
        client=FakeListClient(items(item(Status="Closed", **MOVED_ON))),
    )

    [reject] = quarantine_rows(base_dir)["case_version"]
    assert "status" in reject["failed_rule"]
    assert (
        reject["assigned_reviewer_manager_name"],
        reject["current_reviewer_manager_name"],
        reject["current_responsible_party_manager_name"],
    ) == ("d.reid", "k.adeyemi", "m.osei")


# --- silver: person ---------------------------------------------------------


def merged(*observations: dict, known: tuple[dict, ...] = ()) -> dict[str, dict]:
    """What the person step would upsert for a raw batch of ``observations``
    over a table already holding ``known``, by account."""
    writer = RecordingWriter()
    to_silver_person(
        given_rows(landed(FakeListClient(items(*observations)))),
        DatasetReader(
            Dataset.from_pandas(pd.DataFrame(list(known), columns=PERSON_COLUMNS))
        ),
        writer,
        COMPLAINTS,
        RecordingWriter(),
    )
    # A null detail reads back as None, whatever pandas made of it.
    rows = [
        {key: None if pd.isna(value) else value for key, value in row.items()}
        for row in rows_of(writer)
    ]
    by_account = {row["account"]: row for row in rows}
    assert len(by_account) == len(rows), "one row per person"
    return by_account


def sighted(**overrides: object) -> dict[str, dict]:
    """The people one observation of ``item(**overrides)`` names, by account."""
    return merged(item(**overrides))


def known(account: str, at: str, **details: object) -> dict[str, object]:
    """A row the person table already holds."""
    return {
        "account": account,
        **dict.fromkeys(("domain", "display_name", "email")),
        "first_seen_at": at,
        "last_seen_at": at,
        **details,
    }


EVERY_BLOB = {
    **MOVED_ON,
    "VoidedBy": person("OTHERDOM\\V.Grey", "Val Grey"),
    "Answers": json.dumps(
        {
            "q-1": {
                "value": "x",
                "capture": {
                    "owner": {
                        "loginName": "c.ito",
                        "displayName": "Chie Ito",
                        "domain": "contoso",
                        "email": "C.Ito@Contoso.com",
                    },
                    "note": "free text is not a person",
                },
                # The Responsible Party Manager's Root Cause capture holds a
                # person in the same shape.
                "rcaCapture": {
                    "accountable": {
                        "loginName": "n.park",
                        "displayName": "Nia Park",
                        "domain": "otherdom",
                        "email": "N.Park@Contoso.com",
                    },
                    "category": "Process gap",
                },
            }
        }
    ),
    "Conversation": json.dumps(
        [{"author": {"loginName": "f.lund", "displayName": "Finn Lund"}}]
    ),
    "Appeals": json.dumps(
        [{"appellant": "g.moss", "resolution": {"resolver": "h.ruiz"}}]
    ),
    "AmendedOutcome": json.dumps({"amendedBy": "j.diaz"}),
}


def test_a_sighting_is_recorded_for_everyone_an_observation_names():
    people = sighted(**EVERY_BLOB)

    assert set(people) == {
        # The seven Person columns ...
        "a.khan",
        "b.okafor",
        "d.reid",
        "e.novak",
        "k.adeyemi",
        "m.osei",
        "v.grey",
        # ... and everyone the JSON blobs name.
        "c.ito",
        "n.park",
        "f.lund",
        "g.moss",
        "h.ruiz",
        "j.diaz",
    }
    # User details only: nothing about the Case that named them.
    assert {tuple(row) for row in people.values()} == {PERSON_COLUMNS}
    assert {row["first_seen_at"] for row in people.values()} == {
        pd.Timestamp("2026-08-05 08:10:00+00:00")
    }


def test_a_sighting_keeps_what_its_source_said_in_one_spelling():
    people = sighted(**EVERY_BLOB)

    def details(account: str) -> tuple:
        row = people[account]
        return row["domain"], row["display_name"], row["email"]

    # A Person column: the domain from the claims login, upper-cased; the
    # email lower-cased; the display name as the directory gave it.
    assert details("a.khan") == ("CONTOSO", "Aisha Khan", "a.khan@contoso.com")
    assert details("v.grey") == ("OTHERDOM", "Val Grey", "v.grey@contoso.com")
    # A captured person records its own domain and email.
    assert details("c.ito") == ("CONTOSO", "Chie Ito", "c.ito@contoso.com")
    # So does one picked in a Root Cause Field.
    assert details("n.park") == ("OTHERDOM", "Nia Park", "n.park@contoso.com")
    # A Conversation author has a display name and nothing else.
    assert details("f.lund") == (None, "Finn Lund", None)
    # An Appeal or amendment names the account alone.
    assert details("j.diaz") == (None, None, None)


def test_a_person_named_twice_in_one_observation_takes_each_detail_first_given():
    # The Person column leads: a Conversation snapshot of an old display name
    # does not override the directory's current one -- but a detail only the
    # blob gave still fills in.
    people = sighted(
        AssignedReviewer={"Name": "i:0#.w|CONTOSO\\a.khan", "Title": "Aisha Khan"},
        Conversation=json.dumps(
            [{"author": {"loginName": "A.Khan", "displayName": "A Khan (old)"}}]
        ),
        Answers=json.dumps(
            {"q-1": {"capture": {"owner": {"loginName": "a.khan", "email": "A@x.com"}}}}
        ),
    )

    row = people["a.khan"]
    assert (row["domain"], row["display_name"], row["email"]) == (
        "CONTOSO",
        "Aisha Khan",
        "a@x.com",
    )


def test_an_observation_naming_nobody_records_no_sighting():
    nobody = dict.fromkeys(PERSON_SUBFIELDS)

    assert sighted(**nobody, Answers="not json") == {}


def test_the_latest_observation_in_a_batch_gives_each_detail():
    people = merged(
        item(AssignedReviewer=person("CONTOSO\\a.khan", "Aisha Khan")),
        later_item(
            AssignedReviewer={"Name": "i:0#.w|CONTOSO\\a.khan", "Title": "A Khan-Ross"}
        ),
    )

    row = people["a.khan"]
    # The later observation renamed her and carried no email, which must not
    # blank the one the earlier observation gave.
    assert (row["display_name"], row["email"]) == ("A Khan-Ross", "a.khan@contoso.com")
    assert row["first_seen_at"] == pd.Timestamp("2026-08-05 08:10:00+00:00")
    assert row["last_seen_at"] == pd.Timestamp("2026-08-05 08:45:00+00:00")


def test_a_poll_updates_a_known_person_without_blanking_what_it_did_not_say():
    people = merged(
        item(
            AssignedReviewer={"Name": "i:0#.w|CONTOSO\\a.khan", "Title": "A Khan-Ross"}
        ),
        known=(
            known(
                "a.khan",
                "2026-08-01 10:00:00+00:00",
                domain="CONTOSO",
                display_name="Aisha Khan",
                email="a.khan@contoso.com",
            ),
        ),
    )

    row = people["a.khan"]
    assert (row["domain"], row["display_name"], row["email"]) == (
        "CONTOSO",
        "A Khan-Ross",
        "a.khan@contoso.com",
    )
    assert row["first_seen_at"] == pd.Timestamp("2026-08-01 10:00:00+00:00")
    assert row["last_seen_at"] == pd.Timestamp("2026-08-05 08:10:00+00:00")


def test_an_old_observation_polled_late_does_not_overwrite_a_newer_detail():
    # A re-read of an old version is still a sighting -- but Modified, not the
    # order things are polled in, decides what is current.
    people = merged(
        item(AssignedReviewer={"Name": "i:0#.w|CONTOSO\\a.khan", "Title": "Old name"}),
        known=(known("a.khan", "2026-08-06 09:00:00+00:00", display_name="New name"),),
    )

    row = people["a.khan"]
    assert row["display_name"] == "New name"
    assert row["first_seen_at"] == pd.Timestamp("2026-08-05 08:10:00+00:00")
    assert row["last_seen_at"] == pd.Timestamp("2026-08-06 09:00:00+00:00")


def test_only_the_people_a_batch_names_are_written():
    # The upsert leaves everyone else as they are, so they are not rewritten.
    people = merged(item(), known=(known("z.stranger", "2026-08-01 10:00:00+00:00"),))

    assert "z.stranger" not in people


# --- the whole poll ----------------------------------------------------------


def test_polls_keep_one_row_per_person_and_the_case_row_holds_the_account(base_dir):
    context = RunContext(base_dir=base_dir, pipeline=FEED_NAME)
    run(context, client=FakeListClient())
    run(
        context,
        client=FakeListClient(
            items(
                later_item(ResponsiblePartyManager=person("CONTOSO\\e.novak", "Eva N"))
            ),
            server_now=SERVER_NOW + NEXT_POLL,
        ),
    )

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    [case] = read_rows(med.gold, "case_current")
    assert case["responsible_party_manager_name"] == "e.novak"
    people = {row["account"]: row for row in read_rows(med.silver, PERSON_TABLE)}
    assert set(people) == {"a.khan", "b.okafor", "d.reid", "e.novak"}
    assert (people["e.novak"]["domain"], people["e.novak"]["email"]) == (
        "CONTOSO",
        "e.novak@contoso.com",
    )
    assert people["e.novak"]["display_name"] == "Eva N"

    # Gold republishes the same people, as they stand after the second poll.
    published = {
        row["account"]: row for row in read_rows(med.gold, PERSON_CURRENT_TABLE)
    }
    assert {
        account: {column: row[column] for column in PERSON_COLUMNS}
        for account, row in published.items()
    } == {
        account: {column: row[column] for column in PERSON_COLUMNS}
        for account, row in people.items()
    }
    assert len({row["as_of_utc"] for row in published.values()}) == 1


# --- the backfill ------------------------------------------------------------

# The Person columns a deployment held before the reduction existed -- the ones
# the silver and gold 0003 migrations reduce. The current managers came later,
# and only ever landed as bare accounts.
BACKFILLED_COLUMNS = (
    "assigned_reviewer_name",
    "responsible_party_name",
    "assigned_reviewer_manager_name",
    "responsible_party_manager_name",
    "voided_by_name",
)

CLAIMS_LOGINS = [
    ("i:0#.w|CONTOSO\\A.Khan", "a.khan"),
    ("i:0#.w|OTHERDOM\\b.okafor", "b.okafor"),
    ("i:0#.w|CONTOSO\\SUB\\c.ito", "c.ito"),
    ("CONTOSO\\d.reid", "d.reid"),
    ("  E.Novak  ", "e.novak"),
    ("f.lund", "f.lund"),
    ("", None),
    (None, None),
]


@pytest.mark.parametrize(
    "database, table", [("silver", "case_version"), ("gold", "case_current")]
)
def test_the_migration_reduces_every_stored_person_to_the_bare_account(
    tmp_path, database, table
):
    # Rows a deployment stored before the reduction existed hold claims logins.
    # The migration has to leave them spelled exactly as the pipeline now
    # writes them, or a Case polled since would not match one polled before.
    declared = MIGRATIONS_ROOT / FEED_NAME / database
    before = tmp_path / "before"
    before.mkdir()
    for path in sorted(declared.glob("000[12]_*.sql")):
        shutil.copy(path, before)
    db_path = tmp_path / f"{database}.db"
    MigrationRunner(db_path, before).apply()
    columns = ", ".join(f'"{column}"' for column in BACKFILLED_COLUMNS)
    placeholders = ", ".join("?" for _ in BACKFILLED_COLUMNS)
    with sqlite3.connect(db_path) as con:
        con.executemany(
            f'INSERT INTO "{table}" ({columns}) VALUES ({placeholders})',
            [(login,) * len(BACKFILLED_COLUMNS) for login, _ in CLAIMS_LOGINS],
        )
    con.close()

    MigrationRunner(db_path, declared).apply()

    with sqlite3.connect(db_path) as con:
        stored = con.execute(f'SELECT {columns} FROM "{table}" ORDER BY rowid')
        assert [set(row) for row in stored] == [{bare} for _, bare in CLAIMS_LOGINS]
    con.close()
    # ... which is the pipeline's own rule, not a second one beside it.
    assert [to_bare_account(login) or None for login, _ in CLAIMS_LOGINS] == [
        bare for _, bare in CLAIMS_LOGINS
    ]
