"""The aggregates over ``case_current``: the counts, the two age profiles and
daily throughput.

Each is driven exactly as ``publish_gold`` wires it -- read, reduce, stamp,
write -- over the rows the real current-state reduction produced, so a test
names a history and reads back a published table.
"""

from __future__ import annotations

import datetime as dt
from functools import partial

import pytest

from pipelines.sharepoint_cases.gold import (
    AGE_BUCKETS,
    UNASSIGNED,
    UNKNOWN_AGE_BUCKET,
    UNKNOWN_BRAND,
    UNSTAMPED,
    age_buckets,
    case_counts,
)
from pipelines.sharepoint_cases.gold import throughput as throughput_transform
from tests._sharepoint_cases_fixtures import (
    AS_OF,
    COMPLAINTS,
    OTHER,
    aggregate,
    current,
    version,
)
from tests.framework_testing import given_rows

# Who version()'s default Case is assigned to -- the reviewer every base-grain
# row below lands under unless a test names another.
REVIEWER = version()["assigned_reviewer_name"]

# --- the current counts ------------------------------------------------------


def counts(*rows: dict) -> list[dict]:
    return aggregate(case_counts, "count-by-base-grain-and-status", current(*rows))


def grain(rows: list[dict]) -> list[tuple]:
    return [
        (
            row["brand"],
            row["case_type"],
            row["assigned_reviewer_name"],
            row["status"],
            row["case_count"],
        )
        for row in rows
    ]


def test_current_counts_match_the_current_table():
    # Two Cases with one reviewer, split by status, and a third under a
    # second reviewer.
    rows = counts(
        version(),
        version(id=102, source_item_id="102", status="Completed"),
        version(
            id=103,
            source_item_id="103",
            assigned_reviewer_name="i:0#.w|CONTOSO\\r.okafor",
        ),
    )

    assert set(grain(rows)) == {
        (UNKNOWN_BRAND, COMPLAINTS.case_type, REVIEWER, "Completed", 1),
        (UNKNOWN_BRAND, COMPLAINTS.case_type, REVIEWER, "In-progress", 1),
        (
            UNKNOWN_BRAND,
            COMPLAINTS.case_type,
            "i:0#.w|CONTOSO\\r.okafor",
            "In-progress",
            1,
        ),
    }
    assert {row["as_of_utc"] for row in rows} == {AS_OF.isoformat()}


def test_two_case_types_under_one_reviewer_produce_two_rows():
    # Same reviewer, two Case Types: the base grain keeps them as two rows
    # rather than summing across Case Type.
    rows = counts(
        version(),
        version(id=102, source_item_id="102", case_type=OTHER.case_type),
    )

    assert set(grain(rows)) == {
        (UNKNOWN_BRAND, COMPLAINTS.case_type, REVIEWER, "In-progress", 1),
        (UNKNOWN_BRAND, OTHER.case_type, REVIEWER, "In-progress", 1),
    }
    assert sum(row["case_count"] for row in rows) == 2


# --- the age profiles --------------------------------------------------------


def aged(*rows: dict) -> list[dict]:
    return aggregate(partial(age_buckets, as_of=AS_OF), "bucket-by-age", current(*rows))


def aged_from_assigned(*rows: dict) -> list[dict]:
    return aggregate(
        partial(age_buckets, as_of=AS_OF, age_from="assigned_at"),
        "bucket-by-age-from-assigned",
        current(*rows),
    )


def days_before(age: int) -> str:
    """A stamp exactly ``age`` local calendar days before ``as_of`` -- used for
    both ``created`` and ``assigned_at``, which share the same age arithmetic."""
    return f"{AS_OF.date() - dt.timedelta(days=age)} 09:14:00+00:00"


def bucket_of(age: int) -> tuple[str, int]:
    """The ``(label, order)`` AGE_BUCKETS declares for ``age`` -- read off the
    declaration, so the tests hold the reduction to it rather than to a copy."""
    for order, (bound, label) in enumerate(AGE_BUCKETS):
        if bound is None or age < bound:
            return label, order
    raise AssertionError("the last bucket is open-ended")


def bucket_edges() -> list[int]:
    """Both edges of every declared bucket: where one starts, and the last age
    before the next -- the ages an off-by-one in the reduction would misplace."""
    edges, lower = [], 0
    for bound, _ in AGE_BUCKETS:
        edges += [lower, lower + 30 if bound is None else bound - 1]
        lower = bound
    return edges


@pytest.mark.parametrize("age", bucket_edges())
def test_an_age_falls_in_exactly_one_declared_bucket(age):
    [row] = aged(version(created=days_before(age)))

    assert (row["age_bucket"], row["age_bucket_order"]) == bucket_of(age)
    assert row["case_count"] == 1
    assert row["as_of_utc"] == AS_OF.isoformat()


def test_the_bucket_order_is_the_declared_position_and_unknown_sorts_last():
    orders = {bucket_of(age)[1] for age in bucket_edges()}

    assert orders == set(range(len(AGE_BUCKETS)))
    assert UNKNOWN_AGE_BUCKET[1] == len(AGE_BUCKETS)


def test_a_case_with_no_created_date_has_an_unknown_age():
    [row] = aged(version(created=None))

    assert (row["age_bucket"], row["age_bucket_order"]) == UNKNOWN_AGE_BUCKET


def test_a_case_created_after_the_as_of_instant_is_unknown_rather_than_clamped():
    # Impossible while created <= Modified < as_of, so if it happens it is
    # corruption and belongs somewhere visible.
    [row] = aged(version(created=days_before(-3)))

    assert (row["age_bucket"], row["age_bucket_order"]) == UNKNOWN_AGE_BUCKET


def test_every_current_case_lands_in_exactly_one_age_bucket():
    # The docs claim the age profile totals to the number of current Cases —
    # every Case in one bucket, `unknown` catching the ones with no created date.
    history = (
        version(created=days_before(2)),
        version(id=102, source_item_id="102", created=days_before(40)),
        version(id=103, source_item_id="103", created=None, status="Completed"),
    )

    assert sum(row["case_count"] for row in aged(*history)) == len(current(*history))


def test_age_buckets_carry_the_base_grain():
    [row] = aged(version())

    assert (row["brand"], row["case_type"], row["assigned_reviewer_name"]) == (
        UNKNOWN_BRAND,
        COMPLAINTS.case_type,
        REVIEWER,
    )


def test_an_age_from_assigned_falls_in_the_bucket_its_days_indicate():
    [row] = aged_from_assigned(version(assigned_at=days_before(10)))

    assert (row["age_bucket"], row["age_bucket_order"]) == bucket_of(10)
    assert row["case_count"] == 1


def test_a_case_never_assigned_has_an_unknown_age_from_assigned():
    # Unlike a null `created`, a null `assigned_at` is an ordinary state — the
    # Case simply has not been handed to anyone yet — so `unknown` here means
    # never-assigned, not corruption.
    [row] = aged_from_assigned(version(assigned_at=None))

    assert (row["age_bucket"], row["age_bucket_order"]) == UNKNOWN_AGE_BUCKET


def test_every_current_case_lands_in_exactly_one_age_from_assigned_bucket():
    history = (
        version(assigned_at=days_before(2)),
        version(
            id=102,
            source_item_id="102",
            assigned_at=None,
            status="Completed",
        ),
    )

    assert sum(row["case_count"] for row in aged_from_assigned(*history)) == len(
        current(*history)
    )


# --- daily throughput --------------------------------------------------------


def ended(*rows: dict) -> list[dict]:
    return aggregate(throughput_transform, "count-by-terminal-date", current(*rows))


def test_a_case_observed_many_times_but_completed_once_counts_once():
    # Five observations across overlapping windows, one terminal transition.
    history = [
        version(
            source_version=f'"{n}"',
            source_modified_at=f"2026-08-05 08:{10 + n}:00+00:00",
        )
        for n in range(1, 5)
    ]
    history.append(
        version(
            source_version='"5"',
            source_modified_at="2026-08-05 08:45:00+00:00",
            status="Completed",
            completed_at="2026-08-05 08:44:00+00:00",
        )
    )

    assert [
        (
            row["terminal_date"],
            row["brand"],
            row["case_type"],
            row["assigned_reviewer_name"],
            row["terminal_status"],
            row["case_count"],
        )
        for row in ended(*history)
    ] == [("2026-08-05", UNKNOWN_BRAND, COMPLAINTS.case_type, REVIEWER, "Completed", 1)]


def test_a_voided_case_counts_on_the_date_it_was_voided():
    rows = ended(
        version(status="Void", voided_at="2026-08-04 16:00:00+00:00"),
        version(
            id=102,
            source_item_id="102",
            status="Completed",
            completed_at="2026-08-05 08:44:00+00:00",
        ),
    )

    assert {
        (row["terminal_date"], row["assigned_reviewer_name"], row["terminal_status"])
        for row in rows
    } == {
        ("2026-08-04", REVIEWER, "Void"),
        ("2026-08-05", REVIEWER, "Completed"),
    }


def test_a_terminal_case_with_no_stamp_is_counted_as_unstamped():
    # Nothing enforces "terminal status implies a stamp" and the list row is
    # editable by hand, so the Case is counted under a literal key rather than
    # dropped out of a total.
    rows = ended(version(status="Completed", completed_at=None))

    assert [(row["terminal_date"], row["case_count"]) for row in rows] == [
        (UNSTAMPED, 1)
    ]


def test_throughput_totals_the_cases_currently_in_a_terminal_status():
    history = (
        version(),
        version(
            id=102,
            source_item_id="102",
            status="Completed",
            completed_at="2026-08-05 08:44:00+00:00",
        ),
        version(id=103, source_item_id="103", status="Void", voided_at=None),
        version(id=104, source_item_id="104", status="Actions In Progress"),
    )

    assert sum(row["case_count"] for row in ended(*history)) == 2


def test_throughput_is_empty_when_nothing_has_ended():
    assert ended(version()) == []


def test_throughput_returns_the_same_columns_whether_or_not_anything_ended():
    # The empty-terminal branch hand-declares its shape; this pins it to the
    # populated path so the two cannot silently drift apart.
    populated = throughput_transform(
        given_rows(
            current(
                version(
                    status="Completed",
                    completed_at="2026-08-05 08:44:00+00:00",
                )
            )
        ).read()
    )
    empty = throughput_transform(given_rows(current(version())).read())

    assert set(populated.to_pandas().columns) == set(empty.to_pandas().columns)


# --- the base grain, across every aggregate that carries it ------------------


@pytest.mark.parametrize(
    "profile, terminal",
    [
        pytest.param(counts, {}, id="case_counts_current"),
        pytest.param(aged, {}, id="case_age_buckets_current"),
        pytest.param(aged_from_assigned, {}, id="case_age_from_assigned_buckets"),
        pytest.param(
            ended,
            {"status": "Completed", "completed_at": "2026-08-05 08:44:00+00:00"},
            id="case_throughput_daily",
        ),
    ],
)
def test_a_case_with_nobody_assigned_is_counted_as_unassigned(profile, terminal):
    # A NULL group key is a hole in the grain that pandas' groupby silently
    # drops, so the Case would fall out of a total whose whole job is to add up
    # to the number of current Cases. Every aggregate over the base grain fills
    # it with the same literal instead -- one rule, so one test over the four.
    [row] = profile(version(assigned_reviewer_name=None, **terminal))

    assert row["assigned_reviewer_name"] == UNASSIGNED
    assert row["case_count"] == 1
