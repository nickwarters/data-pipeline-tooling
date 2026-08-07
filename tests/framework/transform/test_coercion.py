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
from decimal import Decimal
from typing import Annotated

import pandas as pd
import pytest

from framework.core import NonNull, Nullable, SchemaValidator, ValidationError
from framework.core.dataset import Dataset
from framework.transform import SchemaCoercion
from framework.transform.processors import CoercionError


@dataclass
class DatedCase:
    case_ref: str
    opened: date


@dataclass
class FlaggedCase:
    case_ref: str
    active: bool


@dataclass
class OptionallyFlaggedCase:
    case_ref: str
    active: Annotated[bool, Nullable()]


@dataclass
class RequiredFlagCase:
    case_ref: str
    active: Annotated[bool, NonNull()]


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

    coerced = SchemaCoercion(DatedCase)(dataset)

    SchemaValidator(DatedCase).validate(coerced)  # does not raise


def test_coerces_a_declared_bool_from_true_false_text():
    # A boolean landed as TRUE/FALSE text (one of the encodings SQLite leaves
    # behind) is cast to a real bool column so the validator passes.
    raw = pd.DataFrame({"case_ref": ["c1", "c2"], "active": ["TRUE", "FALSE"]})
    dataset = Dataset.from_pandas(raw)

    coerced = SchemaCoercion(FlaggedCase)(dataset)

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

    coerced = SchemaCoercion(MixedCase)(dataset).to_pandas()

    assert list(coerced["case_ref"]) == ["c1", "c2"]
    assert list(coerced["score"]) == [10, 20]
    assert coerced["score"].dtype == raw["score"].dtype  # int untouched, not recast
    assert list(coerced["note"]) == ["keep", "me"]  # undeclared, untouched


def test_types_every_declared_column_when_the_frame_has_no_rows():
    # A quiet source's window has no row to type its columns and no value to
    # infer one from: it arrives object-typed, or float64 where `reindex` had to
    # invent the column. The validator lets an empty frame past on exactly that
    # basis — but the dtypes still reach storage, and an empty write is what
    # *creates* the table, fixing each column's affinity for the life of the
    # feed. So when there are no rows the coercer types every declared column,
    # including the round-trip-safe ones it leaves alone when there are.
    empty = pd.DataFrame(
        {
            "case_ref": pd.Series([], dtype="float64"),  # as reindex invents it
            "score": pd.Series([], dtype="object"),
            "opened": pd.Series([], dtype="object"),
        }
    )

    coerced = SchemaCoercion(MixedCase)(Dataset.from_pandas(empty)).to_pandas()

    assert pd.api.types.is_string_dtype(coerced["case_ref"])
    assert pd.api.types.is_integer_dtype(coerced["score"])
    assert pd.api.types.is_datetime64_any_dtype(coerced["opened"])


def test_leaves_a_type_it_cannot_map_alone_on_an_empty_frame():
    # A declared type outside the supported six is a schema configuration error,
    # and `SchemaValidator` is where it is reported — at build time, naming the
    # field. The coercer must not pre-empt that with a raw KeyError from its own
    # dtype table, which an empty frame would otherwise be the only way to hit.
    @dataclass
    class OddCase:
        case_ref: str
        amount: Decimal

    empty = pd.DataFrame(
        {
            "case_ref": pd.Series([], dtype="object"),
            "amount": pd.Series([], dtype="object"),
        }
    )

    coerced = SchemaCoercion(OddCase)(Dataset.from_pandas(empty)).to_pandas()

    assert coerced["amount"].dtype == object  # untouched, not crashed on


def test_unparseable_date_fails_fast_with_a_located_message():
    # A value the coercer cannot parse aborts at the coerce step with a message
    # naming the column, so the breach is diagnosable.
    raw = pd.DataFrame({"case_ref": ["c1"], "opened": ["not-a-date"]})
    dataset = Dataset.from_pandas(raw)

    with pytest.raises(CoercionError, match="opened"):
        SchemaCoercion(DatedCase)(dataset)


def test_unrecognized_boolean_encoding_fails_fast_with_a_located_message():
    # A value outside the known boolean encodings is a coercion failure, not a
    # silently-true row: it aborts naming the column and the offending value.
    raw = pd.DataFrame({"case_ref": ["c1"], "active": ["maybe"]})
    dataset = Dataset.from_pandas(raw)

    with pytest.raises(CoercionError, match="active.*maybe"):
        SchemaCoercion(FlaggedCase)(dataset)


def test_coerces_a_nullable_bool_column_keeping_the_null():
    # A null is the absence of an encoding, not a bad one: a Nullable() bool
    # coerces without error and the gap survives as pd.NA rather than being
    # reported as an unrecognized encoding blaming the feed.
    raw = pd.DataFrame(
        {"case_ref": ["c1", "c2", "c3"], "active": ["TRUE", None, "FALSE"]}
    )
    dataset = Dataset.from_pandas(raw)

    coerced = SchemaCoercion(OptionallyFlaggedCase)(dataset)

    SchemaValidator(OptionallyFlaggedCase).validate(coerced)  # does not raise
    active = coerced.to_pandas()["active"]
    assert active.isna().tolist() == [False, True, False]
    assert active.dropna().tolist() == [True, False]


def test_unrecognized_boolean_encoding_names_only_the_bad_value_not_the_nulls():
    # The unrecognized-encoding report must exclude nulls, so an operator is
    # pointed at the one value that is actually wrong.
    raw = pd.DataFrame(
        {"case_ref": ["c1", "c2", "c3"], "active": ["TRUE", None, "MAYBE"]}
    )
    dataset = Dataset.from_pandas(raw)

    with pytest.raises(CoercionError) as excinfo:
        SchemaCoercion(OptionallyFlaggedCase)(dataset)

    message = str(excinfo.value)
    assert "MAYBE" in message
    assert "nan" not in message and "<NA>" not in message and "None" not in message


def test_null_in_a_non_null_bool_is_a_nullability_breach_not_a_coercion_error():
    # Presence is the rules' job, not the coercer's: a missing flag in a
    # NonNull() column coerces cleanly and is then reported by the validator as
    # a null, pointing at the declaration rather than at the encoding set.
    raw = pd.DataFrame({"case_ref": ["c1", "c2"], "active": ["TRUE", None]})
    dataset = Dataset.from_pandas(raw)

    coerced = SchemaCoercion(RequiredFlagCase)(dataset)  # does not raise

    with pytest.raises(ValidationError, match="active.*null"):
        SchemaValidator(RequiredFlagCase).validate(coerced)


def test_validator_accepts_the_nullable_boolean_dtype_the_coercer_lands():
    # The landed dtype is pandas' nullable "boolean" (numpy bool cannot hold
    # NA); assert the validator's dtype check accepts it rather than assuming.
    frame = pd.DataFrame(
        {"case_ref": ["c1", "c2"], "active": pd.array([True, False], dtype="boolean")}
    )

    SchemaValidator(FlaggedCase).validate(Dataset.from_pandas(frame))  # does not raise


@pytest.mark.parametrize(
    ("encoding", "expected"),
    [
        ("1.0", True),
        ("0.0", False),
        ("Y", True),
        ("N", False),
        ("YES", True),
        ("NO", False),
        ("  true  ", True),
        ("no", False),
    ],
)
def test_recognises_the_wider_boolean_encodings(encoding, expected):
    # Float-typed 1.0/0.0 stringify with a decimal point after a round-trip,
    # and Y/N/YES/NO are everyday source spellings; all are compared case-folded
    # and whitespace-stripped.
    raw = pd.DataFrame({"case_ref": ["c1"], "active": [encoding]})

    coerced = SchemaCoercion(FlaggedCase)(Dataset.from_pandas(raw))

    assert coerced.to_pandas()["active"].tolist() == [expected]


def test_recognises_float_typed_one_zero_after_a_lossy_round_trip():
    # A 1/0 boolean that came back as float (which a null in the column is
    # enough to cause) stringifies as "1.0"/"0.0"; it must still be recognised.
    raw = pd.DataFrame({"case_ref": ["c1", "c2"], "active": [1.0, 0.0]})

    coerced = SchemaCoercion(FlaggedCase)(Dataset.from_pandas(raw))

    assert coerced.to_pandas()["active"].dropna().tolist() == [True, False]


def test_coerces_a_declared_bool_from_one_zero_encoding():
    # The other encoding SQLite leaves behind: a boolean stored as 1/0 integers
    # is cast to a real bool column, not left as an int the validator would reject.
    raw = pd.DataFrame({"case_ref": ["c1", "c2"], "active": [1, 0]})
    dataset = Dataset.from_pandas(raw)

    coerced = SchemaCoercion(FlaggedCase)(dataset)

    SchemaValidator(FlaggedCase).validate(coerced)  # does not raise
    assert list(coerced.to_pandas()["active"]) == [True, False]
