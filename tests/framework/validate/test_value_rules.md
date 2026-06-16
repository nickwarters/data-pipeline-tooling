```python
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

from framework.core.dataset import Dataset
from framework.validate import (
    Length,
    NonNull,
    Nullable,
    OneOf,
    Pattern,
    SchemaValidator,
    Unique,
)
from framework.validate.validators import ValidationError


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


@dataclass
class ConflictingNullabilityCase:
    case_ref: Annotated[str, Nullable(), NonNull()]


def test_schema_validator_rejects_conflicting_nullability_markers_early():
    with pytest.raises(ValueError, match="conflicting nullability.*case_ref"):
        SchemaValidator(ConflictingNullabilityCase)

```
