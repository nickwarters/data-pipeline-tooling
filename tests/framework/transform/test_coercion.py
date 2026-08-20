"""Schema-driven coercion between raw and silver.

``SchemaCoercion`` is the processor that makes a column carry what the Case Type
schema declared, *ahead of* the silver ``SchemaValidator``: types storage loses
outright (dates land as text, booleans as ``1``/``0`` or ``TRUE``/``FALSE``) and
types a reader's inference is free to land as something else (a digits-only
reference read as ``int64``, a number read as text). A column the validator's
dtype check would already accept is left alone. It is engine-confined (reaches
the frame via ``to_pandas``/``from_pandas``).
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Annotated

import numpy as np
import pandas as pd
import pytest

from framework.core import (
    NonNull,
    Nullable,
    SchemaValidator,
    ValidationError,
)
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


@dataclass
class ReferenceCase:
    case_ref: str


@dataclass
class ScoredCase:
    case_ref: str
    score: int


@dataclass
class RatedCase:
    case_ref: str
    rating: float


@dataclass
class RequiredScoreCase:
    case_ref: str
    score: Annotated[int, NonNull()]


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


def test_leaves_columns_the_schema_does_not_declare_untouched():
    # The contract is the declared fields only: a column the schema says nothing
    # about is carried through as it arrived, whatever it holds.
    raw = pd.DataFrame(
        {
            "case_ref": ["c1", "c2"],
            "score": [10, 20],
            "opened": ["2026-01-01", "2026-01-02"],
            "note": ["keep", "me"],
        }
    )

    coerced = SchemaCoercion(MixedCase)(Dataset.from_pandas(raw)).to_pandas()

    assert list(coerced["note"]) == ["keep", "me"]
    assert coerced["note"].dtype == raw["note"].dtype


def test_does_not_recast_a_column_that_already_carries_the_declared_dtype():
    # The no-op guard asks the validator's own dtype check whether the column
    # already satisfies the declaration, so what the coercer leaves alone is
    # exactly what the validator would accept and the two cannot drift. An
    # int64 score and a text reference are both already right: untouched.
    raw = pd.DataFrame(
        {
            "case_ref": ["c1", "c2"],
            "score": [10, 20],
            "opened": ["2026-01-01", "2026-01-02"],
        }
    )

    coerced = SchemaCoercion(MixedCase)(Dataset.from_pandas(raw)).to_pandas()

    assert list(coerced["score"]) == [10, 20]
    assert coerced["score"].dtype == raw["score"].dtype
    assert list(coerced["case_ref"]) == ["c1", "c2"]
    assert coerced["case_ref"].dtype == raw["case_ref"].dtype


def test_types_every_declared_column_when_the_frame_has_no_rows():
    # A quiet source's window has no row to type its columns and no value to
    # infer one from: it arrives object-typed, or float64 where `reindex` had to
    # invent the column. The validator lets an empty frame past on exactly that
    # basis — but the dtypes still reach storage, and an empty write is what
    # *creates* the table, fixing each column's affinity for the life of the
    # feed. No branch handles this: the ordinary paths run with no rows, and
    # what they land is still what fixes the created table's affinity.
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
    # and `SchemaValidator` is where it is reported, at build time, naming the
    # field. The coercer must not pre-empt that by crashing on a type it has no
    # arm for.
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


def test_coerces_mixed_precision_iso_spellings_in_one_column():
    # Two spellings of the same ISO-8601 instant are real in one system — an app
    # writes `.toISOString()` (always milliseconds), a fixture writes `Z` with
    # none. Inference would fit one format to the first value and abort on the
    # other; format="ISO8601" accepts both, so which rows share a batch cannot
    # decide whether the run survives.
    raw = pd.DataFrame(
        {
            "case_ref": ["c1", "c2"],
            "opened": ["2026-08-04T16:02:00Z", "2026-08-11T09:00:00.000Z"],
        }
    )

    coerced = SchemaCoercion(DatedCase)(Dataset.from_pandas(raw)).to_pandas()

    assert list(coerced["opened"]) == [
        pd.Timestamp("2026-08-04T16:02:00Z"),
        pd.Timestamp("2026-08-11T09:00:00Z"),
    ]


def test_a_non_iso_date_spelling_fails_fast_rather_than_being_guessed_at():
    # Fixing the format closes the inference door on purpose: a hand-edited
    # `05/08/2026` is ambiguous (5 Aug or 8 May?), and a guess would land a
    # wrong instant silently. It aborts naming the column instead.
    raw = pd.DataFrame({"case_ref": ["c1"], "opened": ["05/08/2026"]})

    with pytest.raises(CoercionError, match="opened"):
        SchemaCoercion(DatedCase)(Dataset.from_pandas(raw))


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


def test_coerces_an_inferred_numeric_reference_to_text_so_the_validator_passes():
    # The case the coercer exists for on the read side: a digits-only reference
    # in a CSV is inferred as int64, and nothing between the reader and the
    # validator could fix it before. A declared `str` is now cast to text.
    raw = pd.DataFrame({"case_ref": [12345, 67890]})

    coerced = SchemaCoercion(ReferenceCase)(Dataset.from_pandas(raw))

    SchemaValidator(ReferenceCase).validate(coerced)  # does not raise
    assert coerced.to_pandas()["case_ref"].tolist() == ["12345", "67890"]


def test_renders_a_float_widened_whole_number_reference_without_a_trailing_point():
    # A whole-number column with any blank cell cannot be held as an integer, so
    # pandas widens it to float64 — and a plain cast would land the reference as
    # "1234567890.0", which matches nothing downstream. The blank is the second
    # silent failure in the same cast: rendered as "nan" it becomes a value, and
    # downstream it joins, matches and reports as one.
    raw = pd.DataFrame({"case_ref": [1234567890.0, np.nan]})

    coerced = SchemaCoercion(ReferenceCase)(Dataset.from_pandas(raw)).to_pandas()

    assert coerced["case_ref"].tolist()[0] == "1234567890"
    assert coerced["case_ref"].isna().tolist() == [False, True]


@pytest.mark.parametrize("resistant", [3.5, np.inf], ids=["fraction", "infinity"])
def test_the_whole_number_repair_is_column_level_so_one_bad_value_keeps_the_point(
    resistant,
):
    # The Int64 detour is refused for the *whole* column when any one value
    # resists it — a fraction (ValueError) or an infinity (OverflowError) — by
    # choice: a per-value repair would render two spellings of one column. Both
    # arms are pinned because the `str` path must never abort a run: whatever
    # the column holds, the fallback is to render the values as they arrived.
    raw = pd.DataFrame({"case_ref": [1234567890.0, resistant]})

    coerced = SchemaCoercion(ReferenceCase)(Dataset.from_pandas(raw)).to_pandas()

    assert coerced["case_ref"].tolist() == ["1234567890.0", str(resistant)]


def test_coerces_numeric_text_to_the_declared_number_so_the_validator_passes():
    # The mirror of the reference case: a number landed as text (every value out
    # of a strict CSV read) becomes the declared numeric type.
    raw = pd.DataFrame({"case_ref": ["c1", "c2"], "score": ["10", "20"]})

    coerced = SchemaCoercion(ScoredCase)(Dataset.from_pandas(raw))

    SchemaValidator(ScoredCase).validate(coerced)  # does not raise
    assert coerced.to_pandas()["score"].tolist() == [10, 20]


def test_coerces_declared_float_text_to_float():
    # Same path, declared float: the fractional value is kept, not truncated.
    raw = pd.DataFrame({"case_ref": ["c1", "c2"], "rating": ["3.14", "2"]})

    coerced = SchemaCoercion(RatedCase)(Dataset.from_pandas(raw))

    SchemaValidator(RatedCase).validate(coerced)  # does not raise
    assert coerced.to_pandas()["rating"].tolist() == [3.14, 2.0]


@pytest.mark.parametrize(
    "column",
    [[10.0, np.nan], ["10", None], ["10", ""]],
    ids=["float-widened", "null", "blank"],
)
def test_a_gap_in_a_declared_int_survives_the_cast_as_a_gap(column):
    # Three spellings of one absence: the float64 a gap widened the column to,
    # a null, and the empty field a CSV spells "nothing here" with. None is a
    # bad value. The fractional check is where this is easiest to get wrong — it
    # runs over float64, in which a gap is NaN, and `NaN % 1` is NaN, which
    # compares unequal to 0, so without masking the gaps out every null is
    # reported as a fractional value and a plainly nullable column can never be
    # coerced at all. Nullable Int64 is what lands, so the gap survives rather
    # than having to be invented as a zero.
    raw = pd.DataFrame({"case_ref": ["c1", "c2"], "score": column})

    coerced = SchemaCoercion(ScoredCase)(Dataset.from_pandas(raw)).to_pandas()

    assert coerced["score"].isna().tolist() == [False, True]
    assert coerced["score"].dropna().tolist() == [10]
    assert coerced["score"].dtype == "Int64"


def test_validator_accepts_the_nullable_integer_dtype_the_coercer_lands():
    # The landed dtype is pandas' nullable "Int64" (numpy int64 cannot hold NA);
    # assert the validator's dtype check accepts it rather than assuming.
    frame = pd.DataFrame(
        {"case_ref": ["c1", "c2"], "score": pd.array([10, None], dtype="Int64")}
    )

    SchemaValidator(ScoredCase).validate(Dataset.from_pandas(frame))  # does not raise


@pytest.mark.parametrize(
    ("schema", "column"),
    [(ScoredCase, "score"), (RatedCase, "rating")],
)
def test_an_unparseable_number_fails_fast_naming_the_column_and_the_value(
    schema, column
):
    # Nulling a bad value silently would lose it; the coerce step aborts instead
    # with a message naming both the column and the value that broke it.
    raw = pd.DataFrame({"case_ref": ["c1"], column: ["not-a-number"]})

    with pytest.raises(CoercionError, match=f"{column}.*not-a-number"):
        SchemaCoercion(schema)(Dataset.from_pandas(raw))


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("3.5", r"score.*not representable as int: '3\.5'"),
        ("1e30", r"score.*not representable as int \("),
    ],
    ids=["fractional", "too-wide"],
)
def test_a_value_a_declared_int_cannot_hold_aborts_rather_than_being_rounded(
    value, expected
):
    # Rounding or narrowing would silently change the value. Two arms refuse it
    # and the expected message distinguishes them: 3.5 fails the fractional
    # check, while 1e30 passes it (`1e30 % 1 == 0`) and is caught by the Int64
    # cast, which will not narrow a float that has no equivalent integer.
    raw = pd.DataFrame({"case_ref": ["c1"], "score": [value]})

    with pytest.raises(CoercionError, match=expected):
        SchemaCoercion(ScoredCase)(Dataset.from_pandas(raw))


def test_null_in_a_non_null_int_is_a_nullability_breach_not_a_coercion_error():
    # Presence is the validator's job, not the coercer's — the same division the
    # bool path already draws: the gap coerces cleanly and is then reported
    # against the declaration rather than against the value.
    raw = pd.DataFrame({"case_ref": ["c1", "c2"], "score": ["10", None]})

    coerced = SchemaCoercion(RequiredScoreCase)(Dataset.from_pandas(raw))

    with pytest.raises(ValidationError, match="score.*null"):
        SchemaValidator(RequiredScoreCase).validate(coerced)


def test_the_unparseable_number_report_names_only_the_bad_value():
    # An operator is pointed at the one value that is actually wrong: neither a
    # null nor a blank cell is a bad number, so neither appears in the report.
    raw = pd.DataFrame(
        {"case_ref": ["c1", "c2", "c3", "c4"], "score": ["10", None, "  ", "ten"]}
    )

    with pytest.raises(CoercionError) as excinfo:
        SchemaCoercion(ScoredCase)(Dataset.from_pandas(raw))

    message = str(excinfo.value)
    assert "ten" in message
    assert "nan" not in message and "<NA>" not in message and "None" not in message


def test_a_blank_cell_in_a_declared_bool_is_a_gap_not_an_unrecognized_encoding():
    # Same rule on the boolean path, which shares the one gap definition: an
    # empty field is the absence of an encoding, not an unknown one.
    raw = pd.DataFrame({"case_ref": ["c1", "c2"], "active": ["TRUE", "  "]})

    coerced = SchemaCoercion(OptionallyFlaggedCase)(Dataset.from_pandas(raw))

    SchemaValidator(OptionallyFlaggedCase).validate(coerced)  # does not raise
    assert coerced.to_pandas()["active"].isna().tolist() == [False, True]
