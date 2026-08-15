"""Tests for the ``users`` reference feed behind the notification recipients."""

from __future__ import annotations

from pathlib import Path

import pytest

from framework.core import ValidationError
from pipelines.notifications.users import UsersReader
from tests.framework_testing import rows_of

HEADER = "login,email,manager_login,manager_email\n"

SAMPLE = Path(__file__).resolve().parents[2] / (
    "pipelines/notifications/sample_data/users.csv"
)


def _csv(tmp_path: Path, body: str, name: str = "users.csv") -> Path:
    path = tmp_path / name
    path.write_text(HEADER + body, encoding="utf-8")
    return path


def test_a_claims_form_login_still_keys_as_a_bare_account(tmp_path):
    path = _csv(
        tmp_path,
        "i:0#.w|CONTOSO\\A.Khan,A.Khan@Example.Invalid,"
        "i:0#.w|CONTOSO\\E.Novak,E.Novak@Example.Invalid\n",
    )

    assert rows_of(UsersReader(path).read()) == [
        {
            "login": "a.khan",
            "email": "a.khan@example.invalid",
            "manager_login": "e.novak",
            "manager_email": "e.novak@example.invalid",
        }
    ]


def test_a_row_with_no_login_or_no_email_is_dropped_rather_than_kept_blank(tmp_path):
    path = _csv(
        tmp_path,
        "a.khan,a.khan@example.invalid,e.novak,e.novak@example.invalid\n"
        ",orphan@example.invalid,e.novak,e.novak@example.invalid\n"
        "b.okafor,,e.novak,e.novak@example.invalid\n",
    )

    assert [row["login"] for row in rows_of(UsersReader(path).read())] == ["a.khan"]


def test_a_row_with_no_manager_is_kept_because_the_person_is_still_reachable(tmp_path):
    path = _csv(tmp_path, "a.khan,a.khan@example.invalid,,\n")

    rows = rows_of(UsersReader(path).read())
    assert rows == [
        {
            "login": "a.khan",
            "email": "a.khan@example.invalid",
            "manager_login": "",
            "manager_email": "",
        }
    ]


def test_a_missing_column_is_refused_by_name(tmp_path):
    path = tmp_path / "users.csv"
    path.write_text("login,email\na.khan,a.khan@example.invalid\n", encoding="utf-8")

    with pytest.raises(ValidationError) as excinfo:
        UsersReader(path).read()

    assert "manager_login" in str(excinfo.value)
    assert "manager_email" in str(excinfo.value)


def test_a_duplicate_login_is_refused_because_the_join_would_fan_out(tmp_path):
    path = _csv(
        tmp_path,
        "a.khan,a.khan@example.invalid,e.novak,e.novak@example.invalid\n"
        "i:0#.w|CONTOSO\\A.KHAN,a.khan@work.invalid,p.shah,p.shah@example.invalid\n",
    )

    with pytest.raises(ValidationError) as excinfo:
        UsersReader(path).read()

    assert "a.khan" in str(excinfo.value)


def test_data_locations_name_the_file_the_read_touched(tmp_path):
    path = _csv(tmp_path, "a.khan,a.khan@example.invalid,,\n")
    reader = UsersReader(path)

    assert reader.data_locations == []
    reader.read()
    assert reader.data_locations == [{"namespace": "file", "name": str(path)}]


def test_the_bundled_sample_reads_and_carries_only_example_addresses():
    rows = rows_of(UsersReader(SAMPLE).read())

    assert len(rows) == len({row["login"] for row in rows})
    assert all(row["email"].endswith("@example.invalid") for row in rows)
