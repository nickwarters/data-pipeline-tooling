```python
from dataclasses import dataclass
from datetime import date

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.validate import RowCheck, SchemaValidator, row_checks
from framework.validate.validators import ValidationError


@dataclass
class CaseA:
    """A Case Type schema: annotations are the contract."""

    case_ref: str
    opened: date
    active: bool


def _silver_frame(**overrides) -> pd.DataFrame:
    # A frame whose dtypes match CaseA's declared shape, unless a test
    # overrides one column to break it.
    data = {
        "case_ref": pd.Series(["c1", "c2"], dtype="string"),
        "opened": pd.to_datetime(["2026-01-01", "2026-01-02"]),
        "active": pd.Series([True, False], dtype="bool"),
    }
    data.update(overrides)
    return pd.DataFrame(data)


def test_schema_validator_passes_when_columns_and_dtypes_match():
    # The post-validator at silver is satisfied by a conforming frame: every
    # declared column is present and carries the declared type.
    dataset = Dataset.from_pandas(_silver_frame())

    SchemaValidator(CaseA).validate(dataset)  # does not raise


def test_schema_validator_locates_a_missing_declared_column():
    # A declared column absent from the frame fails with a message naming it,
    # so the breach is diagnosable at the boundary.
    frame = _silver_frame().drop(columns=["case_ref"])
    dataset = Dataset.from_pandas(frame)

    with pytest.raises(ValidationError, match="missing column 'case_ref'"):
        SchemaValidator(CaseA).validate(dataset)


def test_schema_validator_locates_a_wrong_dtype_with_expected_and_actual():
    # A present column carrying the wrong type fails naming the column, the
    # declared type, and what was actually found — e.g. dates left as text.
    frame = _silver_frame(opened=pd.Series(["2026-01-01", "nope"], dtype="string"))
    dataset = Dataset.from_pandas(frame)

    with pytest.raises(
        ValidationError, match="column 'opened' expected date but found"
    ):
        SchemaValidator(CaseA).validate(dataset)


def test_schema_validator_ignores_columns_not_declared_in_the_schema():
    # The contract is the declared fields only; a frame carrying extra columns
    # still passes, so silver can hold more than the schema names.
    frame = _silver_frame()
    frame["unexpected"] = pd.Series([1, 2], dtype="int64")
    dataset = Dataset.from_pandas(frame)

    SchemaValidator(CaseA).validate(dataset)  # does not raise


@dataclass
class Measurement:
    count: int
    score: float


def test_schema_validator_accepts_matching_numeric_dtypes():
    # int <-> integer dtype and float <-> float dtype both satisfy the contract.
    frame = pd.DataFrame(
        {
            "count": pd.Series([1, 2], dtype="int64"),
            "score": pd.Series([0.5, 1.5], dtype="float64"),
        }
    )

    SchemaValidator(Measurement).validate(Dataset.from_pandas(frame))


def test_schema_validator_rejects_int_where_float_declared():
    # The mapping is strict: an integer column does not satisfy a declared
    # float (no silent widening), and the breach names the column.
    frame = pd.DataFrame(
        {
            "count": pd.Series([1, 2], dtype="int64"),
            "score": pd.Series([1, 2], dtype="int64"),
        }
    )

    with pytest.raises(ValidationError, match="column 'score' expected float"):
        SchemaValidator(Measurement).validate(Dataset.from_pandas(frame))


def test_schema_validator_resolves_postponed_string_annotations():
    # Real schemas live in modules with `from __future__ import annotations`, so
    # their field types arrive as strings. The validator must resolve them to
    # the declared types, not choke on "str"/"date"/"bool".
    from tests._schema_fixtures import DeferredCase

    dataset = Dataset.from_pandas(_silver_frame())

    SchemaValidator(DeferredCase).validate(dataset)  # does not raise

    bad = _silver_frame(opened=pd.Series(["x", "y"], dtype="string"))
    with pytest.raises(ValidationError, match="column 'opened' expected date"):
        SchemaValidator(DeferredCase).validate(Dataset.from_pandas(bad))


def _opened_before_closed(row) -> str | None:
    # A row check: horizontal, validating the relationship between two fields.
    # The author guards nulls explicitly — row checks see every row.
    if pd.notna(row["opened"]) and pd.notna(row["closed"]):
        if row["opened"] > row["closed"]:
            return "opened is after closed"
    return None


@row_checks(RowCheck(("opened", "closed"), _opened_before_closed))
@dataclass
class CaseWithOrder:
    case_ref: str
    opened: date
    closed: date


def _ordered_frame(**overrides) -> pd.DataFrame:
    data = {
        "case_ref": pd.Series(["c1", "c2"], dtype="string"),
        "opened": pd.to_datetime(["2026-01-01", "2026-01-02"]),
        "closed": pd.to_datetime(["2026-02-01", "2026-02-02"]),
    }
    data.update(overrides)
    return pd.DataFrame(data)


def test_schema_validator_aborts_when_a_row_check_is_violated():
    # A row whose fields contradict each other (opened after closed) breaches the
    # declared row check; the abort names the check's own breach phrase.
    frame = _ordered_frame(closed=pd.to_datetime(["2025-12-01", "2026-02-02"]))

    with pytest.raises(ValidationError, match="opened is after closed"):
        SchemaValidator(CaseWithOrder).validate(Dataset.from_pandas(frame))


def test_schema_validator_passes_when_every_row_satisfies_the_row_check():
    # A frame where opened precedes closed in every row conforms; the row check
    # is part of the contract but raises nothing when honoured.
    SchemaValidator(CaseWithOrder).validate(Dataset.from_pandas(_ordered_frame()))


def test_row_check_skipped_when_a_spanned_column_is_missing():
    # The footprint guard: with 'closed' absent, the missing-column breach is the
    # prior problem to fix — the row check is skipped, not crashed on a KeyError.
    frame = _ordered_frame().drop(columns=["closed"])

    with pytest.raises(ValidationError) as exc:
        SchemaValidator(CaseWithOrder).validate(Dataset.from_pandas(frame))
    assert "missing column 'closed'" in str(exc.value)
    assert "opened is after closed" not in str(exc.value)


def test_row_check_skipped_when_a_spanned_column_is_ill_typed():
    # The footprint guard again: 'opened' arriving as text is the dtype breach to
    # fix first; the row check (which would choke comparing text to a date) is
    # suppressed rather than reporting a spurious or crashing second failure.
    frame = _ordered_frame(opened=pd.Series(["nope", "nah"], dtype="string"))

    with pytest.raises(ValidationError) as exc:
        SchemaValidator(CaseWithOrder).validate(Dataset.from_pandas(frame))
    assert "column 'opened' expected date" in str(exc.value)
    assert "opened is after closed" not in str(exc.value)


def test_row_check_collects_every_breaching_row_into_one_message():
    # The exhaustive contract holds horizontally too: two contradictory rows are
    # reported together with a count, in the single located message.
    frame = _ordered_frame(
        opened=pd.to_datetime(["2026-03-01", "2026-03-02"]),
        closed=pd.to_datetime(["2026-01-01", "2026-01-02"]),
    )

    with pytest.raises(ValidationError, match=r"opened is after closed \(2 rows\)"):
        SchemaValidator(CaseWithOrder).validate(Dataset.from_pandas(frame))


def _closed_needs_date(row) -> str | None:
    # A presence-style row check: the null IS the thing under test, so it must
    # see every row including the null one.
    if row["status"] == "closed" and pd.isna(row["closed_date"]):
        return "closed case is missing closed_date"
    return None


@row_checks(RowCheck(("status", "closed_date"), _closed_needs_date))
@dataclass
class CaseWithClosure:
    status: str
    closed_date: date


def test_row_check_runs_over_null_rows_for_presence_checks():
    # Unlike value rules (which skip nulls), a row check sees nulls — here a
    # closed case whose closed_date is null is exactly the breach.
    frame = pd.DataFrame(
        {
            "status": pd.Series(["closed", "open"], dtype="string"),
            "closed_date": pd.to_datetime([None, None]),
        }
    )

    with pytest.raises(ValidationError, match="missing closed_date"):
        SchemaValidator(CaseWithClosure).validate(Dataset.from_pandas(frame))


@dataclass
class UnsupportedSchema:
    case_ref: str
    payload: list


def test_schema_validator_rejects_an_unsupported_declared_type_early():
    # A schema declaring a type the adapter cannot map to a dtype is a
    # configuration error, surfaced when the validator is built (not as a
    # cryptic failure mid-run), naming the offending field and type.
    with pytest.raises(ValueError, match="payload.*list"):
        SchemaValidator(UnsupportedSchema)

```
