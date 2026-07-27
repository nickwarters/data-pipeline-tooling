"""Value-level schema rules: format, length, uniqueness, and value-set.

These rules ride on the *same* Case Type dataclass as the columns+dtypes
contract from , attached to a field via ``Annotated[type, Rule(...), ...]`` so
the annotations stay the single source of truth. ``SchemaValidator``
runs them over column values on the same engine-confined seam it uses for
dtypes, collecting every breach into one located message naming column + rule.
"""

import re
from dataclasses import dataclass
from datetime import date
from typing import Annotated

import pandas as pd
import pytest

from framework.core import (
    Length,
    NonNull,
    Nullable,
    OneOf,
    Pattern,
    Range,
    SchemaValidator,
    Unique,
)
from framework.core.dataset import Dataset
from framework.core.validators import ValidationError


@dataclass
class PatternCase:
    # An id that must be 9-10 numeric characters (the issue's worked example).
    case_ref: Annotated[str, Pattern(r"\d{9,10}")]


def test_pattern_rejects_values_not_matching_the_regex():
    # A value with letters / wrong length breaches the field's pattern, and the
    # message locates the column and names the rule with offending samples.
    frame = pd.DataFrame(
        {"case_ref": pd.Series(["123456789", "ABC", "12"], dtype="string")}
    )

    # Samples are sorted for a deterministic message, so '12' precedes 'ABC'.
    with pytest.raises(
        ValidationError,
        match=r"column 'case_ref' violates pattern .*'12'.*'ABC'",
    ):
        SchemaValidator(PatternCase).validate(Dataset.from_pandas(frame))


def test_pattern_passes_when_present_values_match_and_skips_nulls():
    # Conforming values satisfy the rule; a missing value is out of scope for a
    # value rule (nullability is a separate concern), so it does not breach.
    frame = pd.DataFrame(
        {"case_ref": pd.Series(["123456789", "1234567890", pd.NA], dtype="string")}
    )

    SchemaValidator(PatternCase).validate(Dataset.from_pandas(frame))  # no raise


def test_pattern_rejects_a_malformed_regex_at_construction():
    # A bad pattern is a configuration error surfaced where the schema is
    # composed (the rule is built), not as a cryptic failure mid-run — mirroring
    # the validator's unsupported-dtype guard.
    with pytest.raises(re.error):
        Pattern(r"(unclosed")


@dataclass
class LengthCase:
    # A code constrained to 2-4 characters: a too-short or too-long string is a
    # value breach even though the dtype (str) is fine.
    code: Annotated[str, Length(minimum=2, maximum=4)]


def test_length_rejects_strings_outside_the_inclusive_bounds():
    # 'x' (too short) and 'toolong' (too long) breach; 'ok' / 'four' are within.
    frame = pd.DataFrame(
        {"code": pd.Series(["ok", "four", "x", "toolong"], dtype="string")}
    )

    with pytest.raises(
        ValidationError,
        match=r"column 'code' length not in \[2, 4\] .*'toolong'.*'x'",
    ):
        SchemaValidator(LengthCase).validate(Dataset.from_pandas(frame))


def test_length_rejects_contradictory_bounds_at_construction():
    # min > max can never be satisfied; flag it where the schema is composed.
    with pytest.raises(ValueError, match="minimum 5 exceeds maximum 2"):
        Length(minimum=5, maximum=2)


def test_length_requires_at_least_one_bound_at_construction():
    # A Length with neither bound constrains nothing — a meaningless rule, flagged
    # where the schema is composed rather than left to misbehave at run time.
    with pytest.raises(ValueError, match="at least one"):
        Length()


@dataclass
class ScoreCase:
    # A score constrained to the inclusive range [0, 100]: a negative or
    # over-100 value is a value breach even though the dtype (int) is fine.
    score: Annotated[int, Range(minimum=0, maximum=100)]


def test_range_rejects_values_outside_the_inclusive_bounds():
    # -5 (too low) and 150 (too high) breach; 0 / 50 / 100 are within.
    frame = pd.DataFrame({"score": pd.Series([0, 50, 100, -5, 150], dtype="int64")})

    with pytest.raises(
        ValidationError,
        match=r"column 'score' value not in \[0, 100\] .*'-5'.*'150'",
    ):
        SchemaValidator(ScoreCase).validate(Dataset.from_pandas(frame))


def test_range_passes_when_present_values_are_within_and_skips_nulls():
    @dataclass
    class OpenCeiling:
        # Only a floor: anything >= 0 is fine, missing values out of scope.
        amount: Annotated[float, Range(minimum=0)]

    frame = pd.DataFrame({"amount": pd.Series([0.0, 12.5, None], dtype="float64")})
    SchemaValidator(OpenCeiling).validate(Dataset.from_pandas(frame))  # no raise


def test_range_rejects_contradictory_bounds_at_construction():
    # min > max can never be satisfied; flag it where the schema is composed.
    with pytest.raises(ValueError, match="minimum 5 exceeds maximum 2"):
        Range(minimum=5, maximum=2)


def test_range_requires_at_least_one_bound_at_construction():
    # A Range with neither bound constrains nothing — a meaningless rule, flagged
    # where the schema is composed rather than left to misbehave at run time.
    with pytest.raises(ValueError, match="at least one"):
        Range()


@dataclass
class UniqueRefCase:
    # A field-level uniqueness rule: no unexpected duplicate keys in the column.
    case_ref: Annotated[str, Unique()]


def test_unique_rejects_duplicate_values_naming_the_offenders():
    # 'dup' appears twice; the breach names the column and the repeated value.
    frame = pd.DataFrame(
        {"case_ref": pd.Series(["a", "dup", "b", "dup"], dtype="string")}
    )

    with pytest.raises(
        ValidationError, match=r"column 'case_ref' has duplicate value\(s\): 'dup'"
    ):
        SchemaValidator(UniqueRefCase).validate(Dataset.from_pandas(frame))


def test_unique_passes_when_all_present_values_are_distinct():
    frame = pd.DataFrame({"case_ref": pd.Series(["a", "b", "c"], dtype="string")})

    SchemaValidator(UniqueRefCase).validate(Dataset.from_pandas(frame))  # no raise


@dataclass
class StatusCase:
    # Value-set membership: status must be one of a known set.
    status: Annotated[str, OneOf("open", "closed")]


def test_one_of_rejects_values_outside_the_allowed_set():
    # 'pending' is not a member; the breach names the column and the bad value.
    frame = pd.DataFrame(
        {"status": pd.Series(["open", "pending", "closed"], dtype="string")}
    )

    with pytest.raises(
        ValidationError,
        match=r"column 'status' has value\(s\) outside .*'pending'",
    ):
        SchemaValidator(StatusCase).validate(Dataset.from_pandas(frame))


def test_one_of_passes_when_every_value_is_a_member():
    frame = pd.DataFrame(
        {"status": pd.Series(["open", "closed", "open"], dtype="string")}
    )

    SchemaValidator(StatusCase).validate(Dataset.from_pandas(frame))  # no raise


def test_one_of_requires_a_non_empty_allowed_set_at_construction():
    # An empty allowed set can never be satisfied; flag it where composed.
    with pytest.raises(ValueError, match="at least one"):
        OneOf()


@dataclass
class MixedCase:
    # A schema mixing a plain columns+dtypes field (opened) with value-ruled
    # fields, so one validate() pass exercises both contracts together.
    case_ref: Annotated[str, Pattern(r"\d+"), Unique()]
    status: Annotated[str, OneOf("open", "closed")]
    opened: date


def test_every_dtype_and_value_breach_is_reported_in_one_message():
    # Two value breaches (a non-numeric case_ref, an out-of-set status) and one
    # dtype breach (opened left as text) all surface in a single located message
    # naming each column — the "report at once" contract extended to value rules.
    frame = pd.DataFrame(
        {
            "case_ref": pd.Series(["123", "oops"], dtype="string"),
            "status": pd.Series(["open", "pending"], dtype="string"),
            "opened": pd.Series(["2026-01-01", "2026-01-02"], dtype="string"),
        }
    )

    with pytest.raises(ValidationError) as excinfo:
        SchemaValidator(MixedCase).validate(Dataset.from_pandas(frame))

    message = str(excinfo.value)
    assert "column 'case_ref' violates pattern" in message
    assert "column 'status' has value(s) outside" in message
    assert "column 'opened' expected date but found" in message


def test_value_rule_is_skipped_when_the_columns_dtype_is_wrong():
    # A wrong-typed column reports its dtype breach only; running the string-shaped
    # value rule over it would be a spurious second failure, so it is skipped —
    # the dtype is the prior problem to fix.
    frame = pd.DataFrame(
        {
            "case_ref": pd.Series([1, 2], dtype="int64"),  # declared str
            "status": pd.Series(["open", "closed"], dtype="string"),
            "opened": pd.to_datetime(["2026-01-01", "2026-01-02"]),
        }
    )

    with pytest.raises(ValidationError) as excinfo:
        SchemaValidator(MixedCase).validate(Dataset.from_pandas(frame))

    message = str(excinfo.value)
    assert "column 'case_ref' expected str but found" in message
    assert "violates pattern" not in message
    assert "duplicate value" not in message


def test_value_rules_resolve_under_postponed_annotations():
    # Real Case Types live in modules with `from __future__ import annotations`,
    # so an `Annotated[...]` field arrives as a *string* the adapter must resolve
    # with include_extras to recover the attached rules — not just the base type.
    from tests._schema_fixtures import RuledCase

    ok = pd.DataFrame(
        {
            "case_ref": pd.Series(["123456789", "987654321"], dtype="string"),
            "status": pd.Series(["open", "closed"], dtype="string"),
        }
    )
    SchemaValidator(RuledCase).validate(Dataset.from_pandas(ok))  # no raise

    bad = pd.DataFrame(
        {
            "case_ref": pd.Series(["123456789", "nope"], dtype="string"),
            "status": pd.Series(["open", "closed"], dtype="string"),
        }
    )
    with pytest.raises(ValidationError, match="column 'case_ref' violates pattern"):
        SchemaValidator(RuledCase).validate(Dataset.from_pandas(bad))


@dataclass
class RequiredCase:
    case_ref: Annotated[str, NonNull(), Pattern(r"\d+")]
    status: Annotated[str, Nullable(), OneOf("open", "closed")]


def test_non_null_field_rejects_missing_values_with_a_located_message():
    frame = pd.DataFrame(
        {
            "case_ref": pd.Series(["123", pd.NA], dtype="string"),
            "status": pd.Series(["open", "closed"], dtype="string"),
        }
    )

    with pytest.raises(
        ValidationError, match="column 'case_ref' contains null value\\(s\\)"
    ):
        SchemaValidator(RequiredCase).validate(Dataset.from_pandas(frame))


def test_nullable_field_allows_nulls_without_running_value_rules_on_them():
    frame = pd.DataFrame(
        {
            "case_ref": pd.Series(["123", "456"], dtype="string"),
            "status": pd.Series(["open", pd.NA], dtype="string"),
        }
    )

    SchemaValidator(RequiredCase).validate(Dataset.from_pandas(frame))


def test_non_null_field_passes_on_an_empty_dataset():
    frame = pd.DataFrame(
        {
            "case_ref": pd.Series([], dtype="string"),
            "status": pd.Series([], dtype="string"),
        }
    )

    SchemaValidator(RequiredCase).validate(Dataset.from_pandas(frame))


def _rules_columns_and_masks():
    """Each value rule paired with a column it judges and its expected mask.

    One duplicated-index frame (built the way application code builds one: two
    frames concatenated without resetting the index) drives every rule, so the
    shared masking contract is exercised once per rule.
    """
    return [
        (Pattern(r"[AB]{2}"), "code", [False, False, True, False]),
        (Length(minimum=2), "code", [False, False, True, False]),
        (Range(minimum=0, maximum=100), "amount", [False, False, True, False]),
        (Unique(), "code", [True, False, False, True]),
        (OneOf("AA", "BB"), "code", [False, False, True, False]),
    ]


def _duplicated_index_frame():
    # Two batches concatenated the way a custom processor would, so index labels
    # repeat: 0, 1, 0, 1. Row 2 ('X' / 500.0) breaches the format/size rules,
    # rows 0 and 3 duplicate 'AA', and the null row 1 is out of scope for all.
    first = pd.DataFrame(
        {
            "code": pd.Series(["AA", pd.NA], dtype="string"),
            "amount": pd.Series([10.0, None], dtype="float64"),
        }
    )
    second = pd.DataFrame(
        {
            "code": pd.Series(["X", "AA"], dtype="string"),
            "amount": pd.Series([500.0, 20.0], dtype="float64"),
        }
    )
    return pd.concat([first, second])


@pytest.mark.parametrize("rule,column,expected", _rules_columns_and_masks())
def test_violating_mask_is_positional_on_a_duplicated_index(rule, column, expected):
    # A frame whose index labels repeat must not derail a rule: label-based
    # assignment either raises outright or silently masks the wrong rows.
    frame = _duplicated_index_frame()
    assert list(frame.index) == [0, 1, 0, 1]

    mask = rule.violating_mask(frame[column])

    assert list(mask) == expected
    assert list(mask.index) == [0, 1, 0, 1]


@pytest.mark.parametrize("rule,column,expected", _rules_columns_and_masks())
def test_violating_mask_is_a_numpy_bool_mask_usable_for_row_selection(
    rule, column, expected
):
    # Quarantine selects rows with `frame.index[mask]` / `frame.loc[mask]`, both
    # of which need a plain numpy bool mask: a *nullable* boolean mask carrying
    # pd.NA raises there. Pin the dtype, and that selection actually works.
    frame = _duplicated_index_frame()

    mask = rule.violating_mask(frame[column])

    assert mask.dtype == bool  # numpy bool, never pandas' nullable "boolean"
    assert not mask.isna().any()
    assert len(frame.loc[mask]) == sum(expected)


def test_violating_mask_stays_numpy_bool_over_a_nullable_boolean_column():
    # Coercion can land pandas' nullable "boolean" dtype, whose comparisons
    # produce nullable boolean results. The mask must still come back as plain
    # numpy bool so downstream row selection keeps working.
    series = pd.Series([True, None, False], dtype="boolean")

    mask = OneOf(True).violating_mask(series)

    assert mask.dtype == bool
    assert list(mask) == [False, False, True]
    assert len(series[mask]) == 1


@pytest.mark.parametrize(
    "rule,values,dtype,expected",
    [
        (
            Pattern(r"\d{9,10}"),
            ["123456789", "ABC", "12"],
            "string",
            r"violates pattern '\\d{9,10}' (e.g. '12', 'ABC')",
        ),
        (
            Length(minimum=2, maximum=4),
            ["ok", "x", "toolong"],
            "string",
            "length not in [2, 4] (e.g. 'toolong', 'x')",
        ),
        (
            Range(minimum=0, maximum=100),
            [0, -5, 150],
            "int64",
            "value not in [0, 100] (e.g. '-5', '150')",
        ),
        (
            Unique(),
            ["a", "dup", "dup"],
            "string",
            "has duplicate value(s): 'dup'",
        ),
        (
            OneOf("open", "closed"),
            ["open", "pending"],
            "string",
            "has value(s) outside {'closed', 'open'}: 'pending'",
        ),
    ],
)
def test_check_message_is_exact_for_every_rule(rule, values, dtype, expected):
    # Breach phrases are operator-facing: they land in reject tables and stored
    # quarantine evidence, so pin them character for character.
    assert rule.check(pd.Series(values, dtype=dtype)) == expected


@pytest.mark.parametrize("rule,column,_expected", _rules_columns_and_masks())
def test_check_returns_none_when_no_present_value_breaches(rule, column, _expected):
    # A conforming slice that still carries repeated index labels (1, 1).
    frame = _duplicated_index_frame()
    conforming = frame.iloc[[1, 3]]
    assert list(conforming.index) == [1, 1]

    assert rule.check(conforming[column]) is None


def test_check_returns_none_for_an_all_null_column():
    # Nulls are out of scope for every value rule, so a wholly-missing column
    # is not a value breach (nullability is the separate contract).
    empty = pd.Series([None, None], dtype="string")

    assert OneOf("A").check(empty) is None
    assert Pattern(r"\d+").check(empty) is None
    assert Unique().check(empty) is None


class HandRolledRule:
    """A rule that implements the protocol and inherits nothing.

    The ValueRule contract is structural, so a third-party rule that satisfies
    the two methods must keep validating and quarantining without deriving from
    the framework's shared base.
    """

    def violating_mask(self, series: "pd.Series") -> "pd.Series":
        return pd.Series(
            [bool(v is not None and str(v).startswith("bad")) for v in series],
            index=series.index,
        )

    def check(self, series: "pd.Series") -> str | None:
        breaches = series[self.violating_mask(series).to_numpy()]
        if breaches.empty:
            return None
        return "is a bad value"


@dataclass
class HandRolledCase:
    code: Annotated[str, HandRolledRule()]


def test_a_rule_inheriting_nothing_still_validates():
    frame = pd.DataFrame({"code": pd.Series(["ok", "bad-one"], dtype="string")})

    with pytest.raises(ValidationError, match="column 'code' is a bad value"):
        SchemaValidator(HandRolledCase).validate(Dataset.from_pandas(frame))


@dataclass
class ConflictingNullabilityCase:
    case_ref: Annotated[str, Nullable(), NonNull()]


def test_schema_validator_rejects_conflicting_nullability_markers_early():
    with pytest.raises(ValueError, match="conflicting nullability.*case_ref"):
        SchemaValidator(ConflictingNullabilityCase)
