"""JSON blob reshaping: exploding maps and lists, flattening 1:1 objects.

These transforms walk a JSON *blob* in a column, where ``Unpivot`` reshapes wide
*columns*. They are domain-free, so the tests speak in generic feed terms and
drive only the public facade.
"""

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.core.errors import ErrorCategory
from framework.transform import (
    ExplodeJsonList,
    ExplodeJsonMap,
    FlattenJsonObject,
    JsonShapeError,
)


def test_explode_json_map_yields_one_row_per_key_with_id_vars_repeated():
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_ref": ["c1"],
                "answers": [
                    '{"q1": {"value": "Poor", "justification": "slow"}, '
                    '"q2": {"value": "Good", "justification": "fast"}}'
                ],
            }
        )
    )
    result = ExplodeJsonMap(
        column="answers",
        key_into="question_id",
        id_vars=["case_ref"],
        fields={"value": "answer_value", "justification": "justification"},
    )(dataset).to_pandas()
    assert list(result.columns) == [
        "case_ref",
        "question_id",
        "answer_value",
        "justification",
    ]
    assert list(result["question_id"]) == ["q1", "q2"]
    assert list(result["case_ref"]) == ["c1", "c1"]
    assert list(result["answer_value"]) == ["Poor", "Good"]
    assert list(result["justification"]) == ["slow", "fast"]


def test_explode_json_map_lifts_dotted_paths_out_of_nested_objects():
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_ref": ["c1"],
                "answers": [
                    '{"q1": {"remediationStatus": {"status": "open"}}, '
                    '"q2": {"value": "Good"}}'
                ],
            }
        )
    )
    result = ExplodeJsonMap(
        column="answers",
        key_into="question_id",
        id_vars=["case_ref"],
        fields={"remediationStatus.status": "remediation_status"},
    )(dataset).to_pandas()
    # q2 has no such nest at all: an absent path lands null, it is not an error.
    assert result["remediation_status"].iloc[0] == "open"
    assert pd.isna(result["remediation_status"].iloc[1])


def test_explode_json_map_value_into_lands_the_whole_map_value():
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_ref": ["c1"],
                "details": ['{"reviewer": "ana", "tags": ["a", "b"]}'],
            }
        )
    )
    result = ExplodeJsonMap(
        column="details",
        key_into="detail_name",
        id_vars=["case_ref"],
        value_into="detail_value",
    )(dataset).to_pandas()
    assert list(result.columns) == ["case_ref", "detail_name", "detail_value"]
    # A scalar lands as itself; anything else is JSON-encoded so one column can
    # carry a polymorphic value.
    assert list(result["detail_value"]) == ["ana", '["a", "b"]']


def _prefixed_map() -> Dataset:
    return Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_ref": ["c1"],
                "answers": [
                    '{"q1": {"value": "Poor"}, "general:tone": {"value": "Yes"}}'
                ],
            }
        )
    )


def test_explode_json_map_excludes_keys_carrying_a_prefix():
    result = ExplodeJsonMap(
        column="answers",
        key_into="question_id",
        id_vars=["case_ref"],
        fields={"value": "answer_value"},
        exclude_key_prefix="general:",
    )(_prefixed_map()).to_pandas()
    assert list(result["question_id"]) == ["q1"]


def test_explode_json_map_includes_only_keys_carrying_a_prefix():
    result = ExplodeJsonMap(
        column="answers",
        key_into="question_id",
        id_vars=["case_ref"],
        fields={"value": "answer_value"},
        include_key_prefix="general:",
    )(_prefixed_map()).to_pandas()
    assert list(result["question_id"]) == ["general:tone"]


def test_explode_json_map_can_strip_the_included_prefix_from_the_stored_key():
    result = ExplodeJsonMap(
        column="answers",
        key_into="question_id",
        id_vars=["case_ref"],
        fields={"value": "answer_value"},
        include_key_prefix="general:",
        strip_key_prefix=True,
    )(_prefixed_map()).to_pandas()
    assert list(result["question_id"]) == ["tone"]


def test_explode_json_map_treats_empty_null_and_blank_blobs_as_no_rows():
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_ref": ["c1", "c2", "c3", "c4"],
                "answers": ["{}", None, "", '{"q1": {"value": "Poor"}}'],
            }
        )
    )
    result = ExplodeJsonMap(
        column="answers",
        key_into="question_id",
        id_vars=["case_ref"],
        fields={"value": "answer_value"},
    )(dataset).to_pandas()
    assert list(result["case_ref"]) == ["c4"]


def test_explode_json_map_over_an_empty_feed_yields_the_declared_columns():
    empty = Dataset.from_pandas(pd.DataFrame({"case_ref": [], "answers": []}))
    result = ExplodeJsonMap(
        column="answers",
        key_into="question_id",
        id_vars=["case_ref"],
        fields={"value": "answer_value"},
    )(empty).to_pandas()
    assert len(result) == 0
    assert list(result.columns) == ["case_ref", "question_id", "answer_value"]


def test_explode_json_map_raises_a_data_error_naming_the_malformed_row():
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {"case_ref": ["c1", "c2"], "answers": ["{}", "{not json"]},
        )
    )
    explode = ExplodeJsonMap(
        column="answers",
        key_into="question_id",
        id_vars=["case_ref"],
        fields={"value": "answer_value"},
    )
    with pytest.raises(JsonShapeError) as raised:
        explode(dataset)
    assert JsonShapeError.category == ErrorCategory.DATA
    assert "answers" in str(raised.value)
    assert "row 1" in str(raised.value)


def test_explode_json_map_rejects_a_blob_that_is_not_an_object():
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1"], "answers": ['["q1"]']})
    )
    with pytest.raises(JsonShapeError):
        ExplodeJsonMap(
            column="answers",
            key_into="question_id",
            id_vars=["case_ref"],
            fields={"value": "answer_value"},
        )(dataset)


def test_explode_json_map_requires_exactly_one_of_fields_and_value_into():
    with pytest.raises(ValueError):
        ExplodeJsonMap(column="details", key_into="k", id_vars=[])
    with pytest.raises(ValueError):
        ExplodeJsonMap(
            column="details",
            key_into="k",
            id_vars=[],
            fields={"a": "a"},
            value_into="v",
        )


def test_explode_json_list_yields_one_row_per_element_with_a_stable_ordinal():
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_ref": ["c1", "c2"],
                "conversation": [
                    '[{"author": {"name": "ana"}, "body": "hello"}, '
                    '{"author": {"name": "bo"}, "body": "hi"}]',
                    '[{"author": {"name": "cy"}, "body": "yo"}]',
                ],
            }
        )
    )
    result = ExplodeJsonList(
        column="conversation",
        ordinal_into="seq",
        id_vars=["case_ref"],
        fields={"author.name": "author", "body": "body"},
    )(dataset).to_pandas()
    assert list(result.columns) == ["case_ref", "seq", "author", "body"]
    assert list(result["case_ref"]) == ["c1", "c1", "c2"]
    assert list(result["seq"]) == [0, 1, 0]
    assert list(result["author"]) == ["ana", "bo", "cy"]
    assert list(result["body"]) == ["hello", "hi", "yo"]


def test_explode_json_list_treats_empty_null_and_blank_blobs_as_no_rows():
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_ref": ["c1", "c2", "c3"],
                "conversation": ["[]", None, ""],
            }
        )
    )
    result = ExplodeJsonList(
        column="conversation",
        ordinal_into="seq",
        id_vars=["case_ref"],
        fields={"body": "body"},
    )(dataset).to_pandas()
    assert len(result) == 0
    assert list(result.columns) == ["case_ref", "seq", "body"]


def test_explode_json_list_raises_a_data_error_naming_the_malformed_row():
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1", "c2"], "conversation": ["[]", "{not json"]})
    )
    with pytest.raises(JsonShapeError, match="row 1"):
        ExplodeJsonList(
            column="conversation",
            ordinal_into="seq",
            id_vars=["case_ref"],
            fields={"body": "body"},
        )(dataset)


def test_flatten_json_object_lands_subfields_as_columns_on_the_same_row():
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_ref": ["c1", "c2"],
                "amendedOutcome": [
                    '{"outcome": "Upheld", "amendedBy": {"name": "ana"}}',
                    None,
                ],
            }
        )
    )
    result = FlattenJsonObject(
        column="amendedOutcome",
        fields={"outcome": "amended_outcome", "amendedBy.name": "amended_by"},
    )(dataset).to_pandas()
    # Both rows survive; the source column is consumed and the null object
    # leaves null columns behind.
    assert list(result.columns) == ["case_ref", "amended_outcome", "amended_by"]
    assert list(result["case_ref"]) == ["c1", "c2"]
    assert result["amended_outcome"].iloc[0] == "Upheld"
    assert result["amended_by"].iloc[0] == "ana"
    assert pd.isna(result["amended_outcome"].iloc[1])
    assert pd.isna(result["amended_by"].iloc[1])


def test_flatten_json_object_keeps_the_source_column_when_asked():
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1"], "resolution": ['{"outcome": "Upheld"}']})
    )
    result = FlattenJsonObject(
        column="resolution",
        fields={"outcome": "resolution_outcome"},
        drop=False,
    )(dataset).to_pandas()
    assert list(result.columns) == ["case_ref", "resolution", "resolution_outcome"]


def test_flatten_json_object_raises_a_data_error_naming_the_malformed_row():
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1", "c2"], "resolution": ["{}", "{not json"]})
    )
    with pytest.raises(JsonShapeError, match="row 1"):
        FlattenJsonObject(
            column="resolution", fields={"outcome": "resolution_outcome"}
        )(dataset)


def test_a_flatten_feeds_an_explode_over_the_same_row():
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_ref": ["c1"],
                "answers": ['{"q1": {"value": "Poor"}}'],
                "amendedOutcome": ['{"outcome": "Upheld"}'],
            }
        )
    )
    flattened = FlattenJsonObject(
        column="amendedOutcome", fields={"outcome": "amended_outcome"}
    )(dataset)
    exploded = ExplodeJsonMap(
        column="answers",
        key_into="question_id",
        id_vars=["case_ref", "amended_outcome"],
        fields={"value": "answer_value"},
    )(flattened).to_pandas()
    assert list(exploded.columns) == [
        "case_ref",
        "amended_outcome",
        "question_id",
        "answer_value",
    ]
    assert exploded.iloc[0]["amended_outcome"] == "Upheld"


def test_each_transform_describes_itself_for_the_run_log():
    described = [
        ExplodeJsonMap(
            column="answers", key_into="k", id_vars=[], fields={"value": "v"}
        ).describe(),
        ExplodeJsonList(
            column="conversation", ordinal_into="seq", id_vars=[], fields={"body": "b"}
        ).describe(),
        FlattenJsonObject(column="amendedOutcome", fields={"outcome": "o"}).describe(),
    ]
    for name, text in zip(
        ["ExplodeJsonMap", "ExplodeJsonList", "FlattenJsonObject"], described
    ):
        assert name in text


def test_a_column_already_decoded_into_python_values_is_read_as_is():
    # A raw SQLite table hands back JSON text; an upstream Parse (or an
    # in-memory fixture) hands back dicts and lists. Both are the same blob, so
    # a Parse ahead of these transforms is optional, not required.
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_ref": ["c1"],
                "answers": [{"q1": {"value": "Poor"}}],
                "conversation": [[{"body": "hello"}]],
            }
        )
    )
    exploded = ExplodeJsonMap(
        column="answers",
        key_into="question_id",
        id_vars=["case_ref"],
        fields={"value": "answer_value"},
    )(dataset).to_pandas()
    assert list(exploded["answer_value"]) == ["Poor"]
    listed = ExplodeJsonList(
        column="conversation",
        ordinal_into="seq",
        id_vars=["case_ref"],
        fields={"body": "body"},
    )(dataset).to_pandas()
    assert list(listed["body"]) == ["hello"]


def test_a_lifted_subfield_that_is_not_a_scalar_is_json_encoded():
    # One rule for both modes: whatever lands in a column is a scalar as-is or
    # JSON text. A live dict in a column is not writable — it fails at the
    # Writer, naming neither the column nor the row.
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1"], "answers": ['{"q1": {"value": ["a", "b"]}}']})
    )
    result = ExplodeJsonMap(
        column="answers",
        key_into="question_id",
        id_vars=["case_ref"],
        fields={"value": "answer_value"},
    )(dataset).to_pandas()
    assert list(result["answer_value"]) == ['["a", "b"]']


def test_a_pandas_null_blob_is_absent_rather_than_malformed():
    # A nullable-dtype column yields pd.NA, not None or float nan. All three
    # transforms must read that as "no blob here", not as a shape breach.
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_ref": ["c1"],
                "amendedOutcome": pd.array([None], dtype="string"),
            }
        )
    )
    result = FlattenJsonObject(
        column="amendedOutcome", fields={"outcome": "amended_outcome"}
    )(dataset).to_pandas()
    assert pd.isna(result["amended_outcome"].iloc[0])


def test_a_literal_json_null_is_a_missing_blob_rather_than_a_wrong_shape():
    # An upstream snapshot writes `null` for an object it does not have, so the
    # text "null" is the same absence as an empty cell — not a shape breach.
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1"], "answers": ["null"], "log": ["null"]})
    )
    exploded = ExplodeJsonMap(
        column="answers",
        key_into="question_id",
        id_vars=["case_ref"],
        fields={"value": "answer_value"},
    )(dataset).to_pandas()
    assert len(exploded) == 0
    listed = ExplodeJsonList(
        column="log", ordinal_into="seq", id_vars=["case_ref"], fields={"body": "body"}
    )(dataset).to_pandas()
    assert len(listed) == 0
    flattened = FlattenJsonObject(column="answers", fields={"value": "answer_value"})(
        dataset
    ).to_pandas()
    assert pd.isna(flattened["answer_value"].iloc[0])


def test_a_blob_that_is_not_json_at_all_names_the_column_and_the_row():
    # A numpy array in the column is not a null, a string or a JSON shape. It
    # must arrive as a located data error, not as a bare pandas ValueError.
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1"], "answers": [pd.array([1, 2])]})
    )
    with pytest.raises(JsonShapeError, match="row 0"):
        FlattenJsonObject(column="answers", fields={"value": "v"})(dataset)


def test_a_missing_column_names_itself_and_the_available_columns():
    # The house rule the other column processors follow: a mis-typed column is a
    # ValueError naming what is available, not a bare KeyError from pandas.
    dataset = Dataset.from_pandas(pd.DataFrame({"case_ref": ["c1"], "answers": ["{}"]}))
    with pytest.raises(ValueError, match="ghost"):
        ExplodeJsonMap(
            column="ghost",
            key_into="k",
            id_vars=["case_ref"],
            fields={"value": "v"},
        )(dataset)
    with pytest.raises(ValueError, match="ghost"):
        ExplodeJsonList(
            column="answers", ordinal_into="seq", id_vars=["ghost"], fields={"a": "a"}
        )(dataset)
    with pytest.raises(ValueError, match="ghost"):
        FlattenJsonObject(column="ghost", fields={"a": "a"})(dataset)


def test_colliding_output_columns_are_refused_at_wiring_time():
    # Two fields into one column, or a field over an id_var, silently drops a
    # column in pandas. These are wiring mistakes, so they fail at construction.
    with pytest.raises(ValueError, match="answer_value"):
        ExplodeJsonMap(
            column="answers",
            key_into="question_id",
            id_vars=["case_ref"],
            fields={"value": "answer_value", "justification": "answer_value"},
        )
    with pytest.raises(ValueError, match="case_ref"):
        ExplodeJsonMap(
            column="answers",
            key_into="case_ref",
            id_vars=["case_ref"],
            fields={"value": "answer_value"},
        )
    with pytest.raises(ValueError, match="seq"):
        ExplodeJsonList(
            column="conversation",
            ordinal_into="seq",
            id_vars=["case_ref"],
            fields={"body": "seq"},
        )


def test_stripping_a_prefix_requires_a_prefix_to_have_been_included():
    with pytest.raises(ValueError, match="strip_key_prefix"):
        ExplodeJsonMap(
            column="answers",
            key_into="question_id",
            id_vars=[],
            fields={"value": "v"},
            strip_key_prefix=True,
        )


def test_the_ordinal_column_is_an_integer_even_when_nothing_explodes():
    # An all-empty source must not write a differently-typed ordinal column from
    # the run before it: the SQLite column affinity would differ run to run.
    empty = Dataset.from_pandas(pd.DataFrame({"case_ref": ["c1"], "log": ["[]"]}))
    result = ExplodeJsonList(
        column="log", ordinal_into="seq", id_vars=["case_ref"], fields={"body": "body"}
    )(empty).to_pandas()
    assert len(result) == 0
    assert result["seq"].dtype == "int64"


def test_a_declared_field_lands_null_wherever_it_is_not_there_to_lift():
    # One rule, at every depth: a declared field that is not there lands null.
    # It does not matter whether the value has no such key, is a scalar with no
    # subfields at all, or goes non-object part-way down a dotted path. These
    # transforms are as permissive about a blob's *inner* shape as `Unpivot` is
    # about a column's contents; only the top-level blob shape is held to a rule.
    dataset = Dataset.from_pandas(
        pd.DataFrame(
            {
                "case_ref": ["c1", "c2", "c3"],
                "answers": [
                    '{"q1": {"value": "Poor"}}',
                    '{"q1": "Poor"}',
                    '{"q1": {"remediationStatus": "open"}}',
                ],
            }
        )
    )
    result = ExplodeJsonMap(
        column="answers",
        key_into="question_id",
        id_vars=["case_ref"],
        fields={"value": "answer_value", "remediationStatus.status": "status"},
    )(dataset).to_pandas()
    assert list(result["case_ref"]) == ["c1", "c2", "c3"]
    assert result["answer_value"].iloc[0] == "Poor"
    assert pd.isna(result["answer_value"].iloc[1])
    assert pd.isna(result["status"].iloc[2])


def test_a_key_that_is_not_text_carries_no_prefix_rather_than_crashing():
    # Only pre-decoded input can hold a non-text key (JSON keys are text). It
    # carries no prefix, so an include filter drops it and an exclude keeps it.
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1"], "details": [{1: "one", "general:x": "two"}]})
    )
    kept = ExplodeJsonMap(
        column="details",
        key_into="detail_name",
        id_vars=["case_ref"],
        value_into="detail_value",
        exclude_key_prefix="general:",
    )(dataset).to_pandas()
    assert list(kept["detail_name"]) == [1]
    dropped = ExplodeJsonMap(
        column="details",
        key_into="detail_name",
        id_vars=["case_ref"],
        value_into="detail_value",
        include_key_prefix="general:",
    )(dataset).to_pandas()
    assert list(dropped["detail_name"]) == ["general:x"]


@pytest.mark.parametrize("drop", [True, False])
def test_a_flatten_field_may_replace_the_source_column_in_place(drop):
    # A field target named for the source column replaces the blob with the
    # value lifted out of it, as `JoinColumns` writes into a column it consumes.
    # `drop=True` is the case the drop guard exists for — without it the column
    # is written and then deleted. `drop=False` is here to hold the two paths to
    # the same answer, not because it could regress on its own.
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1"], "amendedOutcome": ['{"outcome": "Upheld"}']})
    )
    result = FlattenJsonObject(
        column="amendedOutcome",
        fields={"outcome": "amendedOutcome"},
        drop=drop,
    )(dataset).to_pandas()
    assert list(result.columns) == ["case_ref", "amendedOutcome"]
    assert list(result["amendedOutcome"]) == ["Upheld"]


def test_a_flatten_refuses_a_write_target_the_dataset_names_twice():
    # Writing to a duplicated label collapses both columns into one, with
    # nothing but a pandas warning to say a column was lost.
    frame = pd.DataFrame(
        [["c1", "c2", '{"outcome": "Upheld"}']],
        columns=["outcome", "outcome", "resolution"],
    )
    with pytest.raises(ValueError, match="outcome"):
        FlattenJsonObject(column="resolution", fields={"outcome": "outcome"})(
            Dataset.from_pandas(frame)
        )


def test_a_null_key_survives_when_no_prefix_filter_is_configured():
    # `None` is a legitimate key of a pre-decoded map, so it must not collide
    # with however the prefix filters signal "this key is filtered out".
    dataset = Dataset.from_pandas(
        pd.DataFrame({"case_ref": ["c1"], "details": [{None: "x", "a": "y"}]})
    )
    result = ExplodeJsonMap(
        column="details",
        key_into="detail_name",
        id_vars=["case_ref"],
        value_into="detail_value",
    )(dataset).to_pandas()
    assert list(result["detail_value"]) == ["x", "y"]


def test_a_duplicated_id_var_column_is_refused_rather_than_read_as_garbage():
    # Two columns of one name read back as a frame, not a column, and would land
    # the column *name* in every output row.
    frame = pd.DataFrame([["c1", "c2", "{}"]], columns=["case_ref", "case_ref", "log"])
    with pytest.raises(ValueError, match="case_ref"):
        ExplodeJsonList(
            column="log", ordinal_into="seq", id_vars=["case_ref"], fields={"b": "b"}
        )(Dataset.from_pandas(frame))
