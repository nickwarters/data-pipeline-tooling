```python
"""The shared schema-declaration traversal: hint resolution and rule evaluation.

``framework._internal.schema`` owns the one reading of a schema dataclass's
annotations and the one evaluation of its declared value rules. Both the
checking half (``SchemaValidator``) and the routing half
(``SchemaValueRulePartitioner``) consume that single traversal, so a rule is
consulted once per frame and a schema's annotations are resolved once per class.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

import pandas as pd

from framework._internal import schema as schema_module
from framework._internal.schema import (
    _declared_fields,
    _declared_rules,
    _resolved_hints,
    evaluate_rules,
)
from framework.core.schema import _declared_nullability
from framework.core.value_rules import NonNull, OneOf


@dataclass
class Sample:
    code: Annotated[str, OneOf("A", "B")]
    name: Annotated[str, NonNull()]


def test_type_hints_are_resolved_once_per_schema_class(monkeypatch):
    # Every declaration reader goes through one cached resolution, so building a
    # validator does not evaluate the same annotations three times over.
    _resolved_hints.cache_clear()
    calls = {"n": 0}
    real = schema_module.get_type_hints

    def counting(*args, **kwargs):
        calls["n"] += 1
        return real(*args, **kwargs)

    monkeypatch.setattr(schema_module, "get_type_hints", counting)

    _declared_fields(Sample)
    _declared_rules(Sample)
    _declared_nullability(Sample)

    assert calls["n"] == 1
    _resolved_hints.cache_clear()


def test_evaluate_rules_consults_each_rule_once_and_reports_the_mask():
    frame = pd.DataFrame(
        {
            "code": pd.Series(["A", "X", "B"], dtype="string"),
            "name": pd.Series(["a", "b", "c"], dtype="string"),
        }
    )

    outcomes = evaluate_rules(Sample, frame)

    assert len(outcomes) == 1
    outcome = outcomes[0]
    assert outcome.column == "code"
    assert list(outcome.mask) == [False, True, False]
    assert outcome.phrase == "has value(s) outside {'A', 'B'}"
    assert outcome.sampled_phrase == "has value(s) outside {'A', 'B'}: 'X'"
    assert outcome.missing_column is False


def test_evaluate_rules_marks_a_rule_whose_column_is_absent():
    frame = pd.DataFrame({"name": pd.Series(["a"], dtype="string")})

    outcomes = evaluate_rules(Sample, frame)

    assert [o.missing_column for o in outcomes] == [True]
    assert list(outcomes[0].mask) == [False]


def test_evaluate_rules_skips_a_column_the_caller_declares_ill_typed():
    frame = pd.DataFrame({"code": pd.Series([1, 2], dtype="int64")})

    assert evaluate_rules(Sample, frame, skip_columns={"code"}) == []

```
