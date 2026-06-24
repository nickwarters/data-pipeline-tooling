"""Tests for explicit load strategy value types."""

import pytest

from framework.io.strategy import AccumulateByRun, InsertOrIgnore, Refresh, UpsertStrategy


def test_refresh_is_a_value_type_with_no_required_args():
    s = Refresh()
    assert isinstance(s, Refresh)


def test_accumulate_by_run_holds_run_identity():
    s = AccumulateByRun(run_id="r1", load_date="2026-01-01")
    assert s.run_id == "r1"
    assert s.load_date == "2026-01-01"


def test_accumulate_by_run_rejects_empty_run_id():
    with pytest.raises(ValueError, match="run_id"):
        AccumulateByRun(run_id="", load_date="2026-01-01")


def test_accumulate_by_run_rejects_empty_load_date():
    with pytest.raises(ValueError, match="load_date"):
        AccumulateByRun(run_id="r1", load_date="")


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
