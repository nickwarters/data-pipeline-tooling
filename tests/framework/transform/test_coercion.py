"""Schema-driven coercion between raw and silver.

``SchemaCoercion`` is the processor that repairs the representation raw loses to
storage: types that don't survive a SQLite round-trip (dates land as text,
booleans as ``1``/``0`` or ``TRUE``/``FALSE``) are cast back to the Case Type
schema's declared types *ahead of* the silver ``SchemaValidator``. It is
engine-confined (reaches the frame via ``to_pandas``/``from_pandas``) and casts
only the round-trip-lossy types — ``str``/``int``/``float`` survive storage, so
they pass through untouched and stay the validator's gate.
"""

from dataclasses import dataclass
from datetime import date

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.transform import SchemaCoercion
from framework.transform.processors import CoercionError
from framework.validate import SchemaValidator


@dataclass
class DatedCase:
    case_ref: str
    opened: date


@dataclass
class FlaggedCase:
    case_ref: str
    active: bool


@dataclass
class MixedCase:
    case_ref: str
    score: int
    opened: date


def test_coerces_a_declared_date_from_text_so_the_validator_passes():
    # raw lands a date as text (SQLite has no date type); the coercer casts it to
    # datetime64 so the silver SchemaValidator — which the un-coerced text would
    # fail — is satisfied on the coerced output.
    raw = pd.DataFrame(
        {"case_ref": ["c1", "c2"], "opened": ["2026-01-01", "2026-01-02"]}
    )
    dataset = Dataset.from_pandas(raw)

    coerced = SchemaCoercion(DatedCase).process(dataset)

    SchemaValidator(DatedCase).validate(coerced)  # does not raise


def test_coerces_a_declared_bool_from_true_false_text():
    # A boolean landed as TRUE/FALSE text (one of the encodings SQLite leaves
    # behind) is cast to a real bool column so the validator passes.
    raw = pd.DataFrame({"case_ref": ["c1", "c2"], "active": ["TRUE", "FALSE"]})
    dataset = Dataset.from_pandas(raw)

    coerced = SchemaCoercion(FlaggedCase).process(dataset)

    SchemaValidator(FlaggedCase).validate(coerced)  # does not raise
    assert list(coerced.to_pandas()["active"]) == [True, False]


def test_leaves_round_trip_safe_and_undeclared_columns_untouched():
    # Scope: the coercer repairs only what storage loses. str/int/float
    # survive a SQLite round-trip, so they pass through unchanged and stay the
    # validator's gate; columns the schema doesn't declare are left alone too.
    raw = pd.DataFrame(
        {
            "case_ref": ["c1", "c2"],
            "score": [10, 20],
            "opened": ["2026-01-01", "2026-01-02"],
            "note": ["keep", "me"],
        }
    )
    dataset = Dataset.from_pandas(raw)

    coerced = SchemaCoercion(MixedCase).process(dataset).to_pandas()

    assert list(coerced["case_ref"]) == ["c1", "c2"]
    assert list(coerced["score"]) == [10, 20]
    assert coerced["score"].dtype == raw["score"].dtype  # int untouched, not recast
    assert list(coerced["note"]) == ["keep", "me"]  # undeclared, untouched


def test_unparseable_date_fails_fast_with_a_located_message():
    # A value the coercer cannot parse aborts at the coerce step with a message
    # naming the column, so the breach is diagnosable.
    raw = pd.DataFrame({"case_ref": ["c1"], "opened": ["not-a-date"]})
    dataset = Dataset.from_pandas(raw)

    with pytest.raises(CoercionError, match="opened"):
        SchemaCoercion(DatedCase).process(dataset)


def test_unrecognized_boolean_encoding_fails_fast_with_a_located_message():
    # A value outside the known boolean encodings is a coercion failure, not a
    # silently-true row: it aborts naming the column and the offending value.
    raw = pd.DataFrame({"case_ref": ["c1"], "active": ["maybe"]})
    dataset = Dataset.from_pandas(raw)

    with pytest.raises(CoercionError, match="active.*maybe"):
        SchemaCoercion(FlaggedCase).process(dataset)


def test_coerces_a_declared_bool_from_one_zero_encoding():
    # The other encoding SQLite leaves behind: a boolean stored as 1/0 integers
    # is cast to a real bool column, not left as an int the validator would reject.
    raw = pd.DataFrame({"case_ref": ["c1", "c2"], "active": [1, 0]})
    dataset = Dataset.from_pandas(raw)

    coerced = SchemaCoercion(FlaggedCase).process(dataset)

    SchemaValidator(FlaggedCase).validate(coerced)  # does not raise
    assert list(coerced.to_pandas()["active"]) == [True, False]
