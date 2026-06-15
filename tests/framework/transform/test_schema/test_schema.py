from dataclasses import dataclass
from datetime import date

import pandas as pd
import pytest

from framework.io.dataset import Dataset
from framework.transform.schema import SchemaValidator
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
