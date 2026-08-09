import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path

FIXTURE = (
    Path(__file__).parents[2]
    / "platform_frontend"
    / "dev"
    / "fixtures"
    / "my-stats"
    / "123456.txt"
)
ENVELOPE_KEYS = {
    "schema_version",
    "reviewer_account",
    "generated_at",
    "complete_through",
    "rows",
}
ROW_KEYS = {"date", "case_type", "count"}
ACCOUNT_PATTERN = re.compile(r"[a-z0-9._-]+")
DATE_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}")
UTC_INSTANT_PATTERN = re.compile(
    r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)"
)


def _iso_date(value: object) -> date:
    assert isinstance(value, str)
    assert DATE_PATTERN.fullmatch(value)
    return date.fromisoformat(value)


def test_my_stats_fixture_freezes_the_report_feed_envelope():
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))

    assert set(payload) == ENVELOPE_KEYS
    assert payload["schema_version"] == 1

    account = payload["reviewer_account"]
    assert account == FIXTURE.stem
    assert account == account.lower()
    assert ACCOUNT_PATTERN.fullmatch(account)

    generated_at_value = payload["generated_at"]
    assert isinstance(generated_at_value, str)
    assert UTC_INSTANT_PATTERN.fullmatch(generated_at_value)
    generated_at = datetime.fromisoformat(generated_at_value.replace("Z", "+00:00"))
    assert generated_at.utcoffset() == timedelta(0)

    complete_through = _iso_date(payload["complete_through"])
    assert complete_through <= generated_at.date()

    assert isinstance(payload["rows"], list)
    pairs = set()
    for row in payload["rows"]:
        assert isinstance(row, dict)
        assert set(row) == ROW_KEYS
        assert _iso_date(row["date"]) <= complete_through
        assert isinstance(row["case_type"], str) and row["case_type"].strip()
        assert type(row["count"]) is int and row["count"] > 0
        pair = (row["date"], row["case_type"])
        assert pair not in pairs
        pairs.add(pair)
