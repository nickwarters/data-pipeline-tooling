"""People: the bare account on every Case row, and what is known about each.

Silver reduces each Person column to the lower-cased bare account, so a Case
row joins to the JSON blobs, the Staff Hierarchy and the platform on one
spelling. What that reduction drops -- the domain, the display name, the
email -- goes to ``person_sighting``, one row per observation x person it
names, and gold reduces that history to ``person_current``, one row per person.
"""

from __future__ import annotations

import json
import shutil
import sqlite3

import pandas as pd
import pytest

from framework.run import RunContext
from pipelines.sharepoint_cases.gold import (
    PERSON_COLUMNS,
    PERSON_SIGHTING_TABLE,
    PERSON_TABLE,
    to_gold_person_current,
)
from pipelines.sharepoint_cases.pipeline import (
    FEED_NAME,
    PERSON_NAME_COLUMNS,
    SIGHTING_ONLY_COLUMNS,
    to_silver,
    to_silver_person_sighting,
)
from shared.account_names import to_bare_account
from tests._sharepoint_cases_fixtures import (
    AS_OF,
    COMPLAINTS,
    FakeListClient,
    gold_rows,
    item,
    items,
    landed,
    person,
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
        # Nobody is a null, not an empty string.
        "voided_by_name": None,
    }
    # The details beside each login are the sighting table's, not the Case's.
    assert not set(SIGHTING_ONLY_COLUMNS) & set(row)


# --- silver: person_sighting -------------------------------------------------


def sighted(**overrides: object) -> dict[str, dict]:
    """The sightings one observation of ``item(**overrides)`` yields, by account."""
    writer = RecordingWriter()
    to_silver_person_sighting(
        given_rows(landed(FakeListClient(items(item(**overrides))))),
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
    assert len(by_account) == len(rows), "one row per person per observation"
    return by_account


EVERY_BLOB = {
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
        # The five Person columns ...
        "a.khan",
        "b.okafor",
        "d.reid",
        "e.novak",
        "v.grey",
        # ... and everyone the JSON blobs name.
        "c.ito",
        "f.lund",
        "g.moss",
        "h.ruiz",
        "j.diaz",
    }
    # Each row carries the observation it came from.
    [observation] = landed(FakeListClient(items(item(**EVERY_BLOB))))
    assert {row["source_observation_id"] for row in people.values()} == {
        observation["source_observation_id"]
    }
    assert {row["case_type"] for row in people.values()} == {COMPLAINTS.case_type}


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
    nobody = dict.fromkeys(
        (
            "AssignedReviewer",
            "ResponsibleParty",
            "AssignedReviewerManager",
            "ResponsiblePartyManager",
        )
    )

    assert sighted(**nobody, Answers="not json") == {}


# --- gold: person_current ----------------------------------------------------


def sighting(at: str, observation: str, **details: object) -> dict[str, object]:
    """One silver person-sighting row for ``a.khan``."""
    return {
        "case_type": COMPLAINTS.case_type,
        "source_item_id": "101",
        "source_modified_at": at,
        "source_version": observation,
        "source_observation_id": f"101@{observation}",
        "account": "a.khan",
        **dict.fromkeys(("domain", "display_name", "email")),
        **details,
    }


def person_rows(*sightings: dict) -> list[dict]:
    return gold_rows(to_gold_person_current, list(sightings))


def test_person_current_is_one_row_per_person_stamped_as_of():
    rows = person_rows(
        sighting("2026-08-05 08:10:00+00:00", "3"),
        {**sighting("2026-08-05 08:10:00+00:00", "3"), "account": "b.okafor"},
        sighting("2026-08-05 08:45:00+00:00", "4"),
    )

    assert [row["account"] for row in rows] == ["a.khan", "b.okafor"]
    assert set(rows[0]) == {*PERSON_COLUMNS, "as_of_utc"}
    assert {row["as_of_utc"] for row in rows} == {AS_OF.isoformat()}


def test_person_current_keeps_the_latest_value_each_detail_was_given():
    [row] = person_rows(
        sighting(
            "2026-08-05 08:10:00+00:00",
            "3",
            domain="CONTOSO",
            display_name="Aisha Khan",
            email="a.khan@contoso.com",
        ),
        # Seen later as a Conversation author: a newer display name, and no
        # email -- which must not blank the one already known.
        sighting("2026-08-05 08:45:00+00:00", "4", display_name="Aisha Khan-Ross"),
    )

    assert (row["domain"], row["display_name"], row["email"]) == (
        "CONTOSO",
        "Aisha Khan-Ross",
        "a.khan@contoso.com",
    )
    assert row["first_seen_at"] == pd.Timestamp("2026-08-05 08:10:00+00:00")
    assert row["last_seen_at"] == pd.Timestamp("2026-08-05 08:45:00+00:00")


def test_an_old_observation_landed_late_does_not_overwrite_a_newer_one():
    # Append order is not observation order: a backfill can land an old
    # version after a new one. Modified decides.
    [row] = person_rows(
        sighting("2026-08-05 09:00:00+00:00", "5", display_name="New name"),
        sighting("2026-08-05 08:00:00+00:00", "2", display_name="Old name"),
    )

    assert row["display_name"] == "New name"
    assert row["first_seen_at"] == pd.Timestamp("2026-08-05 08:00:00+00:00")


# --- the whole poll ----------------------------------------------------------


def test_a_poll_lands_bare_accounts_in_gold_and_everyone_in_person_current(base_dir):
    run(RunContext(base_dir=base_dir, pipeline=FEED_NAME), client=FakeListClient())

    med = medallion(StoreRegistry(base_dir), FEED_NAME)
    [case] = read_rows(med.gold, "case_current")
    assert case["assigned_reviewer_name"] == "a.khan"
    assert {row["account"] for row in read_rows(med.silver, PERSON_SIGHTING_TABLE)} == {
        "a.khan",
        "b.okafor",
        "d.reid",
        "e.novak",
    }
    people = {row["account"]: row for row in read_rows(med.gold, PERSON_TABLE)}
    assert set(people) == {"a.khan", "b.okafor", "d.reid", "e.novak"}
    assert people["e.novak"]["domain"] == "CONTOSO"
    assert people["e.novak"]["display_name"] == "Eva Novak"
    assert people["e.novak"]["email"] == "e.novak@contoso.com"


# --- the backfill ------------------------------------------------------------

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
    columns = ", ".join(f'"{column}"' for column in PERSON_NAME_COLUMNS)
    with sqlite3.connect(db_path) as con:
        con.executemany(
            f'INSERT INTO "{table}" ({columns}) VALUES (?, ?, ?, ?, ?)',
            [(login,) * len(PERSON_NAME_COLUMNS) for login, _ in CLAIMS_LOGINS],
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
