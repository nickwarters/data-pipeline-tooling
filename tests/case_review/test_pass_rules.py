"""Tests for the reporting pass rules: a named pass/fail line over a bank's outcomes."""

from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest

from case_review.pass_rules import PASS_RULES, STANDARD, STRICT, PassRule

RULE = PassRule(
    name="demo",
    passing={"complaints": ("good",)},
    failing={"complaints": ("poor",), "claims": ("late",)},
)


def test_a_rule_gives_each_named_outcome_its_verdict():
    assert RULE.verdict("complaints", "good") == "pass"
    assert RULE.verdict("complaints", "poor") == "fail"
    assert RULE.verdict("claims", "late") == "fail"


@pytest.mark.parametrize(
    ("case_type", "outcome_id"),
    [("complaints", "meh"), ("claims", "good"), ("unknown", "good")],
)
def test_an_outcome_a_rule_does_not_name_is_an_error_naming_all_three(
    case_type, outcome_id
):
    with pytest.raises(ValueError) as error:
        RULE.verdict(case_type, outcome_id)

    message = str(error.value)
    assert "'demo'" in message
    assert repr(outcome_id) in message
    assert repr(case_type) in message


def test_a_rule_covers_every_case_type_either_side_names():
    assert RULE.covers == ("claims", "complaints")


def test_a_rule_is_a_declaration_and_cannot_be_edited_in_place():
    with pytest.raises(FrozenInstanceError):
        RULE.name = "other"


def test_the_standard_rule_passes_a_process_enhancement_and_the_strict_one_does_not():
    assert STANDARD.verdict("complaints", "good") == "pass"
    assert STANDARD.verdict("complaints", "good-with-process-enhancement") == "pass"
    assert STANDARD.verdict("complaints", "poor") == "fail"
    assert STANDARD.verdict("complaints", "poor-with-harm") == "fail"

    assert STRICT.verdict("complaints", "good") == "pass"
    assert STRICT.verdict("complaints", "good-with-process-enhancement") == "fail"
    assert STRICT.verdict("complaints", "poor") == "fail"
    assert STRICT.verdict("complaints", "poor-with-harm") == "fail"


def test_every_declared_rule_has_a_distinct_name_and_states_both_sides():
    names = [rule.name for rule in PASS_RULES]
    assert names == ["standard", "strict"]
    assert len(set(names)) == len(names)
    for rule in PASS_RULES:
        for case_type in rule.covers:
            assert rule.passing.get(case_type), (rule.name, case_type)
            assert rule.failing.get(case_type), (rule.name, case_type)
            assert not set(rule.passing[case_type]) & set(rule.failing[case_type])
