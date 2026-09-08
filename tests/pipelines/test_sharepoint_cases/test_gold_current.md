```python
"""The current-state rule: an append-only observation history reduced to one
row per Case, and the amended-outcome blob flattened onto it.

``current()`` drives the real ``to_gold_case_current`` over a history of
``version()`` rows, so what a test names is the history and what it reads back
is the Case.
"""

from __future__ import annotations

import json

import pandas as pd
import pytest

from pipelines.sharepoint_cases.gold import (
    AMENDED_OUTCOME_FIELDS,
    DETAIL_BLOB_COLUMNS,
)
from tests._sharepoint_cases_fixtures import (
    AS_OF,
    SILVER_COLUMNS,
    current,
    version,
)


def test_two_versions_of_one_case_reduce_to_the_later_status():
    rows = current(
        version(source_version='"3"', source_modified_at="2026-08-05 08:10:00+00:00"),
        version(
            source_version='"4"',
            source_modified_at="2026-08-05 08:45:00+00:00",
            status="Completed",
        ),
    )

    assert [(row["source_item_id"], row["status"]) for row in rows] == [
        ("101", "Completed")
    ]


def test_two_cases_stay_two_current_rows_with_distinct_ids():
    rows = current(version(), version(id=102, source_item_id="102"))

    # Ordered by the derived case_id, which is deterministic but not the item
    # order: the reduction sorts by key, and the key is a uuid5.
    assert {row["source_item_id"] for row in rows} == {"101", "102"}
    assert len({row["case_id"] for row in rows}) == 2


@pytest.mark.parametrize(
    "earlier, later",
    [
        # An ETag, and the reason not to compare these as text: "10" sorts
        # before "9" lexically, so a text tie-break would resolve backwards.
        ('"9"', '"10"'),
        # The weak-ETag form, which carries a W/ prefix as well as the quotes.
        ('W/"9"', 'W/"10"'),
        # The comma form SharePoint uses for a major,minor ETag.
        ('"4,1"', '"4,2"'),
        # The dotted UI version, which is a different shape of the same idea.
        ("3.0", "10.0"),
        ("512.0", "512.1"),
    ],
)
def test_a_same_modified_tie_is_broken_by_the_parsed_version(earlier, later):
    # Two versions of one item really can share a Modified to the second, and
    # append-only silver keeps both, so this tie is reachable.
    tied = "2026-08-05 08:10:00+00:00"
    rows = current(
        version(source_version=later, source_modified_at=tied, status="Completed"),
        version(source_version=earlier, source_modified_at=tied),
    )

    assert [row["status"] for row in rows] == ["Completed"]


def test_a_versionless_observation_loses_to_a_versioned_one_at_the_same_modified():
    # A row that arrived with no version at all falls back to a sha256 digest,
    # which is not a version and must not out-sort one. It sorts at -1 rather
    # than NA, because pandas sorts NA *last*.
    tied = "2026-08-05 08:10:00+00:00"
    rows = current(
        version(source_version='"3"', source_modified_at=tied, status="Completed"),
        version(source_version="a" * 64, source_modified_at=tied),
    )

    assert [row["status"] for row in rows] == ["Completed"]


def test_two_versionless_observations_are_separated_by_the_observation_id():
    # Both sit in the same unparseable bucket, so only the deterministic
    # observation id is left. Which one wins is arbitrary; that it is the same
    # one every time is the guarantee.
    tied = "2026-08-05 08:10:00+00:00"
    args = (
        version(
            source_version="a" * 64,
            source_modified_at=tied,
            source_observation_id="aaa",
        ),
        version(
            source_version="b" * 64,
            source_modified_at=tied,
            source_observation_id="bbb",
            status="Completed",
        ),
    )

    assert [row["source_observation_id"] for row in current(*args)] == ["bbb"]
    assert [row["source_observation_id"] for row in current(*reversed(args))] == ["bbb"]


def test_an_unparseable_modified_stamp_stops_the_reduction():
    # Silver declares source_modified_at non-null and typed, so this cannot
    # honestly arrive — and coercing it to NaT would sort the bad row *last* and
    # hand it the Case, which is exactly the trap the version parse avoids.
    with pytest.raises(ValueError):
        current(
            version(),
            version(source_version='"4"', source_modified_at="not a timestamp"),
        )


def test_every_current_row_carries_the_candidate_window_end():
    [row] = current(version())

    assert row["as_of_utc"] == AS_OF.isoformat()


def test_current_gold_carries_the_join_key_for_detail_tables():
    # Nothing else states this column is load-bearing for a second table:
    # winning_observations projects case_current down to it, so a future
    # change to latest_case_version that dropped it would silently break
    # every Detail Table's join with no error to catch it.
    [row] = current(version())

    assert "source_observation_id" in row


# --- the amended outcome, flattened ------------------------------------------


AMENDED_COLUMNS = tuple(AMENDED_OUTCOME_FIELDS.values())


# The five raw JSON blob columns, which gold does not republish: each one's
# data lives in its normalised home (the Detail Tables; the amended_* columns),
# and silver case_version keeps the landed text.
BLOB_COLUMNS = (*DETAIL_BLOB_COLUMNS, "amended_outcome")


def test_current_gold_republishes_every_silver_column_except_the_blobs():
    [row] = current(version())

    assert not set(BLOB_COLUMNS) & set(row)
    assert set(SILVER_COLUMNS) - set(BLOB_COLUMNS) <= set(row)
    assert {"case_id", "as_of_utc", *AMENDED_COLUMNS} <= set(row)


def amended(row: dict) -> dict:
    """The flattened amendment, keyed as the blob keys it -- so a test can
    compare it to the blob it wrote rather than to six literals."""
    return {key: row[column] for key, column in AMENDED_OUTCOME_FIELDS.items()}


def test_a_reason_carrying_amendment_flattens_onto_the_current_row():
    # The qa-check/tm-check provenance arm: a reason key, no source Appeal.
    blob = json.dumps(
        {
            "outcome": "poor-with-harm",
            "reason": "qa-check",
            "justification": "The missed needs check was immaterial.",
            "amendedBy": "user-controls",
            "amendedAt": "2026-06-12T00:00:00.000Z",
        }
    )

    [row] = current(version(amended_outcome=blob))

    flattened = amended(row)
    # Every written key lands verbatim -- amendedAt as ISO text, since text
    # inside a blob stays text -- and the one not written lands null.
    assert {k: v for k, v in flattened.items() if k != "fromAppealId"} == json.loads(
        blob
    )
    assert pd.isna(flattened["fromAppealId"])
    # The flatten consumes the blob: the columns are its only gold home now,
    # and silver case_version keeps the landed text.
    assert "amended_outcome" not in row


def test_an_appeal_derived_amendment_carries_the_appeal_id_and_no_reason():
    # The other provenance arm: fromAppealId (which joins appeal.appeal_id) is
    # present iff the amendment came from agreeing an Appeal, and the app then
    # writes no reason key.
    blob = json.dumps(
        {
            "outcome": "poor-no-harm",
            "justification": "Appeal agreed.",
            "amendedBy": "user-controls",
            "amendedAt": "2026-06-12T00:00:00Z",
            "fromAppealId": "appeal-1754390400000",
        }
    )

    [row] = current(version(amended_outcome=blob))

    flattened = amended(row)
    assert {k: v for k, v in flattened.items() if k != "reason"} == json.loads(blob)
    assert pd.isna(flattened["reason"])


@pytest.mark.parametrize(
    "blob",
    [
        pytest.param(None, id="never-written"),
        pytest.param("", id="empty"),
        pytest.param("null", id="explicitly-cleared"),
    ],
)
def test_a_case_with_no_amendment_carries_nulls_not_a_crash(blob):
    # The column holds the JSON literal "null" when explicitly cleared and is
    # empty or absent if never written; all three land identically.
    [row] = current(version(amended_outcome=blob))

    assert all(pd.isna(row[column]) for column in AMENDED_COLUMNS)


def test_a_malformed_amendment_in_a_losing_observation_cannot_abort_gold():
    # The flatten sits after the reduction, so only each Case's winning blob is
    # ever parsed: a malformed blob in superseded history stays recoverable in
    # silver without holding the rebuild hostage.
    rows = current(
        version(
            source_version='"3"',
            source_modified_at="2026-08-05 08:10:00+00:00",
            amended_outcome="{not json",
        ),
        version(
            source_version='"4"',
            source_modified_at="2026-08-05 08:45:00+00:00",
            amended_outcome=json.dumps({"outcome": "good"}),
        ),
    )

    assert [row["amended_outcome_id"] for row in rows] == ["good"]

```
