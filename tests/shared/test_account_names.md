```python
"""Tests for the claims/domain login encoding."""

from __future__ import annotations

import pytest

from shared.account_names import to_bare_account, to_domain


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("i:0#.w|CONTOSO\\a.khan", "a.khan"),
        ("CONTOSO\\a.khan", "a.khan"),
        ("a.khan", "a.khan"),
        ("i:0#.w|CONTOSO\\A.Khan", "a.khan"),
        ("A.KHAN", "a.khan"),
        ("  a.khan  ", "a.khan"),
        ("i:0#.w|OTHERDOMAIN\\a.khan", "a.khan"),
        ("i:0#.w|CONTOSO\\SUB\\a.khan", "a.khan"),
    ],
)
def test_a_login_in_any_spelling_reduces_to_the_lower_cased_bare_account(
    value, expected
):
    assert to_bare_account(value) == expected


@pytest.mark.parametrize("value", [None, "", "   ", float("nan"), "i:0#.w|CONTOSO\\"])
def test_an_absent_login_reduces_to_blank_so_it_can_never_match(value):
    # Every caller must drop the blank before joining: "" == "" would otherwise
    # match two strangers.
    assert to_bare_account(value) == ""


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("i:0#.w|CONTOSO\\a.khan", "CONTOSO"),
        ("OtherDom\\a.khan", "OtherDom"),
        ("i:0#.w|CONTOSO\\SUB\\a.khan", "CONTOSO\\SUB"),
        ("a.khan", ""),
        (None, ""),
        (float("nan"), ""),
    ],
)
def test_a_login_names_its_domain_as_spelled_or_none_at_all(value, expected):
    assert to_domain(value) == expected

```
