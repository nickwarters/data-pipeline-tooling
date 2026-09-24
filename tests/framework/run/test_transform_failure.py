"""A transformer's crash arrives as a located, readable ``TransformError``."""

from __future__ import annotations

import functools
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated

import pandas as pd
import pytest

from framework.core import Dataset, NonNull, ValidationError, format_failure
from framework.run import (
    Pipeline,
    RunContext,
    TransformError,
    coerce,
    enforce,
    transform,
)
from framework.run.run_context import active_context
from framework.run.transform_failure import describe_transformer
from framework.transform.processors import CoercionError
from tests.framework_testing import RecordingRunLog, RecordingWriter, given_rows

THIS_FILE = Path(__file__).name


@dataclass
class Scored:
    case_ref: str
    amount: int


@dataclass
class RequiredScored:
    case_ref: str
    amount: Annotated[int, NonNull()]


def _data() -> Dataset:
    return Dataset.from_pandas(pd.DataFrame({"case_ref": ["C-1"], "amount": [5]}))


def _missing_column(dataset: Dataset) -> Dataset:
    return Dataset.from_pandas(dataset.to_pandas()[["no_such_column"]])


def test_a_crashing_lambda_is_named_by_where_it_was_written_and_its_source():
    with pytest.raises(TransformError) as raised:
        transform(lambda d: d.to_pandas()["no_such_column"], _data())

    message = str(raised.value)
    assert message.startswith("transform step 'transform' failed: KeyError:")
    assert "transformer: <lambda> at " in message
    assert THIS_FILE in message
    # The lambda's own source, so "which lambda?" answers itself.
    assert 'lambda d: d.to_pandas()["no_such_column"]' in message


def test_the_line_named_is_the_authors_not_the_library_internals_it_failed_in():
    with pytest.raises(TransformError) as raised:
        transform(_missing_column, _data())

    message = str(raised.value)
    assert "raised at " in message
    raised_line = next(line for line in message.splitlines() if "raised at" in line)
    assert THIS_FILE in raised_line
    assert "in _missing_column" in raised_line
    assert "pandas" not in raised_line


def test_a_named_function_is_described_by_its_qualified_name_and_location():
    with pytest.raises(TransformError) as raised:
        transform(_missing_column, _data(), name="narrow")

    assert raised.value.step == "narrow"
    assert raised.value.transformer.startswith("_missing_column at ")
    assert "transform step 'narrow' failed" in str(raised.value)


def test_the_original_exception_is_chained_so_the_traceback_survives():
    with pytest.raises(TransformError) as raised:
        transform(lambda d: 1 / 0, _data())

    assert isinstance(raised.value.__cause__, ZeroDivisionError)
    assert raised.value.original is raised.value.__cause__
    assert raised.value.category == "code"


def test_a_pipeline_error_raised_by_a_transformer_passes_through_untouched():
    bad = Dataset.from_pandas(pd.DataFrame({"case_ref": ["C-1"], "amount": ["x"]}))
    with pytest.raises(CoercionError):
        coerce(Scored, bad)


def test_the_builder_transform_node_wraps_a_crashing_lambda_the_same_way():
    p = Pipeline("cases")
    read = p.read(given_rows([{"case_ref": "C-1"}]), name="read")
    p.transform(lambda d: d.to_pandas()["nope"], read, name="pick")

    with pytest.raises(TransformError) as raised:
        p.run()

    message = str(raised.value)
    assert "transform step 'pick' failed: KeyError" in message
    assert "<lambda> at " in message
    assert 'd.to_pandas()["nope"]' in message


def test_the_run_log_records_the_located_message_and_the_code_category():
    run_log = RecordingRunLog()
    with pytest.raises(TransformError):
        with active_context(RunContext(pipeline="demo", run_log=run_log)):
            transform(lambda d: 1 / 0, _data(), name="divide")

    record = run_log.records[-1]
    assert record["step"] == "divide"
    assert record["status"] == "error"
    assert record["error_category"] == "code"
    assert "ZeroDivisionError" in record["errors"][0]


def test_format_failure_renders_it_as_an_indented_block_without_a_traceback():
    with pytest.raises(TransformError) as raised:
        transform(lambda d: 1 / 0, _data(), name="divide")

    rendered = format_failure(raised.value)
    lines = rendered.splitlines()
    assert lines[0] == "Pipeline run failed [TransformError, code]"
    assert lines[1] == (
        "  transform step 'divide' failed: ZeroDivisionError: division by zero"
    )
    assert "Traceback" not in rendered
    assert all(line.isascii() for line in lines)


def test_a_transformer_called_directly_raises_exactly_what_it_raised_before():
    # The wrapping belongs to the step, not the transformer.
    with pytest.raises(KeyError):
        _missing_column(_data())


def test_enforce_passes_its_key_through_to_the_coercion():
    rows = [{"case_ref": "C-1", "amount": "1"}, {"case_ref": "C-2", "amount": "x"}]
    with pytest.raises(CoercionError, match="in 1 row: case_ref='C-2'"):
        enforce(Scored, given_rows(rows).read(), key="case_ref")


def test_enforce_passes_its_key_through_to_the_validator():
    rows = [{"case_ref": "C-1", "amount": "1"}, {"case_ref": "C-2", "amount": None}]
    with pytest.raises(
        ValidationError,
        match=r"'amount' contains null value\(s\) in 1 row: case_ref='C-2'",
    ):
        enforce(RequiredScored, given_rows(rows).read(), key="case_ref")


# --- describing what ran -----------------------------------------------------


class _Doubler:
    def __call__(self, dataset: Dataset) -> Dataset:
        return dataset

    def run(self, dataset: Dataset) -> Dataset:
        return dataset


class _Described:
    def __call__(self, dataset: Dataset) -> Dataset:
        return dataset

    def describe(self) -> str:
        return "Described(threshold=3)"


def test_a_bound_method_is_described_by_its_owner():
    assert describe_transformer(_Doubler().run) == ("_Doubler.run", None)


def test_a_callable_object_is_described_through_its_describe_protocol():
    assert describe_transformer(_Described()) == ("Described(threshold=3)", None)
    assert describe_transformer(_Doubler()) == ("_Doubler", None)


def test_a_partial_is_described_by_what_it_wraps():
    described, _ = describe_transformer(functools.partial(_missing_column))
    assert described.startswith("partial(_missing_column at ")


def test_a_lambda_without_source_is_still_described_by_its_location():
    built = eval("lambda d: d")  # no source file behind it
    described, source = describe_transformer(built)
    assert described == "<lambda> at <string>:1"
    assert source is None


def test_a_crashing_transform_stops_the_graph_before_its_write():
    writer = RecordingWriter()
    p = Pipeline("cases")
    read = p.read(given_rows([{"case_ref": "C-1"}]), name="read")
    t = p.transform(lambda d: 1 / 0, read, name="divide")
    p.write(writer, t, name="write")
    with pytest.raises(TransformError):
        p.run()
    assert writer.writes == []
