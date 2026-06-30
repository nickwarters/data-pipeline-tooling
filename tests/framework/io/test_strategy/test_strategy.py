"""Tests for explicit load strategy value types."""

import pytest

from framework.io.strategy import (
    AccumulateByRun,
    InsertIfAbsent,
    InsertOrIgnore,
    Refresh,
    UpsertStrategy,
)


def test_refresh_is_a_value_type_with_no_required_args():
    s = Refresh()
    assert isinstance(s, Refresh)


def test_accumulate_by_run_holds_run_identity():
    s = AccumulateByRun(logical_run_id="r1", load_date="2026-01-01")
    assert s.logical_run_id == "r1"
    assert s.load_date == "2026-01-01"


def test_accumulate_by_run_rejects_empty_run_id():
    with pytest.raises(ValueError, match="logical_run_id"):
        AccumulateByRun(logical_run_id="", load_date="2026-01-01")


def test_accumulate_by_run_rejects_empty_load_date():
    with pytest.raises(ValueError, match="load_date"):
        AccumulateByRun(logical_run_id="r1", load_date="")


def test_upsert_strategy_normalises_bare_string_to_single_element_tuple():
    s = UpsertStrategy("case_id")
    assert s.key_columns == ("case_id",)


def test_upsert_strategy_rejects_empty_key_columns():
    with pytest.raises(ValueError, match="key column"):
        UpsertStrategy(())


def test_upsert_strategy_is_a_value_type():
    assert UpsertStrategy("id") == UpsertStrategy(("id",))
    assert hash(UpsertStrategy("id")) == hash(UpsertStrategy(("id",)))
    assert UpsertStrategy(("a", "b")) == UpsertStrategy(("a", "b"))
    assert UpsertStrategy("a") != UpsertStrategy("b")


def test_insert_or_ignore_is_a_value_type_with_no_required_args():
    s = InsertOrIgnore()
    assert isinstance(s, InsertOrIgnore)
    assert s == InsertOrIgnore()
    assert hash(s) == hash(InsertOrIgnore())


def test_insert_if_absent_normalises_bare_string_to_single_element_tuple():
    s = InsertIfAbsent("value")
    assert s.key_columns == ("value",)


def test_insert_if_absent_defaults_surrogate_column_to_id():
    s = InsertIfAbsent("value")
    assert s.surrogate_column == "id"


def test_insert_if_absent_accepts_custom_surrogate_column():
    s = InsertIfAbsent("value", surrogate_column="ref_id")
    assert s.surrogate_column == "ref_id"


def test_insert_if_absent_rejects_empty_key_columns():
    with pytest.raises(ValueError, match="key column"):
        InsertIfAbsent(())


def test_insert_if_absent_is_a_value_type():
    assert InsertIfAbsent("id") == InsertIfAbsent(("id",))
    assert hash(InsertIfAbsent("id")) == hash(InsertIfAbsent(("id",)))
    assert InsertIfAbsent(("a", "b")) == InsertIfAbsent(("a", "b"))
    assert InsertIfAbsent("a") != InsertIfAbsent("b")
    assert InsertIfAbsent("a") != InsertIfAbsent("a", surrogate_column="other_id")


def test_insert_if_absent_is_immutable():
    s = InsertIfAbsent("value")
    with pytest.raises(AttributeError):
        s.key_columns = ("other",)  # type: ignore[misc]
