"""The expected-failure vocabulary: one base, and a traceback-free presenter."""

import pytest

from framework.core import (
    ErrorCategory,
    PipelineError,
    ValidationError,
    format_failure,
)
from framework.run import FreshnessError, RunAddressError, UnknownPipelineError
from framework.transform import CoercionError
from tools.orchestration import ForEachPipelineError


@pytest.mark.parametrize(
    "error_type",
    [
        ValidationError,
        FreshnessError,
        UnknownPipelineError,
        RunAddressError,
        ForEachPipelineError,
        CoercionError,
    ],
)
def test_every_expected_failure_is_a_pipeline_error(error_type):
    # The whole fail-fast family shares one base, so a run boundary can catch it
    # with a single `except PipelineError`.
    assert issubclass(error_type, PipelineError)


def test_a_programming_error_is_not_a_pipeline_error():
    # A genuine bug must stay outside the family so it keeps its traceback.
    assert not issubclass(KeyError, PipelineError)


@pytest.mark.parametrize(
    "error_type, expected_category",
    [
        (ValidationError, ErrorCategory.DATA),
        (CoercionError, ErrorCategory.DATA),
        (FreshnessError, ErrorCategory.OPERATIONAL),
        (ForEachPipelineError, ErrorCategory.OPERATIONAL),
        (UnknownPipelineError, ErrorCategory.CONFIG),
        (RunAddressError, ErrorCategory.CONFIG),
    ],
)
def test_each_expected_failure_carries_its_triage_category(
    error_type, expected_category
):
    # The category is how an operator triages a run-log failure without reading
    # every message: data (fix the feed) / operational (fix the run) / config
    # (fix the wiring).
    assert error_type("boom").category == expected_category


def test_base_pipeline_error_defaults_to_operational():
    # Any future subclass is categorised even before it picks a specific bucket.
    assert PipelineError("boom").category == ErrorCategory.OPERATIONAL


def test_a_raw_bug_has_no_triage_category():
    # A non-PipelineError has no `category` — that absence is what the run log
    # records as "this was a bug, not an expected failure".
    assert getattr(KeyError("boom"), "category", None) is None


def test_format_failure_shows_the_triage_category():
    rendered = format_failure(ValidationError("no id column"))

    assert ErrorCategory.DATA in rendered  # "data"
    assert "ValidationError" in rendered


def test_format_failure_names_the_kind_and_reproduces_the_message():
    rendered = format_failure(ValidationError("myfeed pre-validate failed: no id"))

    assert "ValidationError" in rendered
    # The exception's own message survives verbatim so existing text stays greppable.
    assert "myfeed pre-validate failed: no id" in rendered


def test_format_failure_has_no_traceback_and_is_plain_ascii():
    rendered = format_failure(FreshnessError("upstream cases/ingest is stale"))

    assert "Traceback" not in rendered
    assert rendered.isascii()


def test_format_failure_indents_a_multi_line_message():
    rendered = format_failure(ValidationError("line one\nline two"))

    assert "  line one" in rendered
    assert "  line two" in rendered
