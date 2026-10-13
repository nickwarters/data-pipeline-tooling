```python
"""Tests for the ``users`` reference feed behind the notification recipients."""

from __future__ import annotations

from pathlib import Path

import pytest

from framework.core import ValidationError
from readers.users import _BUNDLED_FEED, UsersReader
from tests.framework_testing import rows_of

HEADER = "login,email,manager_login,manager_email\n"

SAMPLE = Path(__file__).resolve().parents[2] / "readers" / "sample_data" / "users.csv"


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

    assert rows_of(UsersReader(path=path).read()) == [
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

    rows = rows_of(UsersReader(path=path).read())
    assert [row["login"] for row in rows] == ["a.khan"]


def test_a_row_with_no_manager_is_kept_because_the_person_is_still_reachable(tmp_path):
    path = _csv(tmp_path, "a.khan,a.khan@example.invalid,,\n")

    rows = rows_of(UsersReader(path=path).read())
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
        UsersReader(path=path).read()

    assert "manager_login" in str(excinfo.value)
    assert "manager_email" in str(excinfo.value)


def test_a_duplicate_login_is_refused_because_the_join_would_fan_out(tmp_path):
    path = _csv(
        tmp_path,
        "a.khan,a.khan@example.invalid,e.novak,e.novak@example.invalid\n"
        "i:0#.w|CONTOSO\\A.KHAN,a.khan@work.invalid,p.shah,p.shah@example.invalid\n",
    )

    with pytest.raises(ValidationError) as excinfo:
        UsersReader(path=path).read()

    assert "a.khan" in str(excinfo.value)


def test_data_locations_name_the_file_the_read_touched(tmp_path):
    path = _csv(tmp_path, "a.khan,a.khan@example.invalid,,\n")
    reader = UsersReader(path=path)

    assert reader.data_locations == []
    reader.read()
    assert reader.data_locations == [{"namespace": "file", "name": str(path)}]


def test_the_bundled_sample_reads_and_carries_only_example_addresses():
    rows = rows_of(UsersReader(path=SAMPLE).read())

    assert len(rows) == len({row["login"] for row in rows})
    assert all(row["email"].endswith("@example.invalid") for row in rows)


def test_a_consumer_supplies_only_a_base_dir_and_gets_the_feed(tmp_path):
    # The consumer-facing construction: a base_dir and nothing else. This
    # reader's answer to "where is it?" is the file bundled beside the module,
    # so a base_dir pointing at an empty directory changes nothing — the point
    # being that the consumer cannot tell, and will not have to change the day
    # the answer becomes a table under that base_dir.
    assert rows_of(UsersReader(base_dir=tmp_path).read()) == rows_of(
        UsersReader(path=SAMPLE).read()
    )
    assert rows_of(UsersReader().read()) == rows_of(UsersReader(path=SAMPLE).read())


def test_the_path_seam_is_keyword_only_so_it_cannot_be_passed_by_accident():
    # A positional argument is the base_dir, always. Were `path` positional too,
    # a consumer could hand over a file path without ever deciding to — the leak
    # the signature exists to prevent.
    with pytest.raises(TypeError):
        UsersReader(SAMPLE, SAMPLE)

    # And a positional path is silently *not* a path: it binds base_dir, so the
    # reader falls back to its own declared source rather than reading it.
    reader = UsersReader(SAMPLE)
    reader.read()
    assert reader.data_locations == [{"namespace": "file", "name": str(_BUNDLED_FEED)}]

```
