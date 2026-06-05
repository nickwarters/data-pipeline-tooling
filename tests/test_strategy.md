```python
"""Tests for explicit load strategy value types (Refresh, AccumulateByRun)."""

import pytest

from framework.strategy import AccumulateByRun, Refresh


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

```
