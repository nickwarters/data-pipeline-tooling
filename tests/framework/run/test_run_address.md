```python
"""Stable addresses for dependency targets."""

import pytest

from framework.core import ErrorCategory, PipelineError
from framework.run import RunAddress, RunAddressError


def test_pipeline_address_formats_without_subject():
    address = RunAddress.pipeline("claims")

    assert address.pipeline == "claims"
    assert address.subject is None
    assert address.step is None
    assert address.label == "claims"
    assert str(address) == "claims"


def test_step_address_formats_with_subject():
    address = RunAddress.step("claims", "validate_schema", subject="case-review")

    assert address.pipeline == "claims"
    assert address.subject == "case-review"
    assert address.step == "validate_schema"
    assert address.label == "case-review/claims.validate_schema"
    assert str(address) == "case-review/claims.validate_schema"


def test_address_matches_design_doc_step_example():
    address = RunAddress.step("pipeline_2", "step_4")

    assert address.pipeline == "pipeline_2"
    assert address.step == "step_4"
    assert address.label == "pipeline_2.step_4"


@pytest.mark.parametrize(
    "label, expected",
    [
        ("claims", RunAddress.pipeline("claims")),
        ("case-review/claims", RunAddress.pipeline("claims", subject="case-review")),
        ("claims.validate_schema", RunAddress.step("claims", "validate_schema")),
        (
            "case-review/claims.validate_schema",
            RunAddress.step("claims", "validate_schema", subject="case-review"),
        ),
        ("pipeline_2.step_4", RunAddress.step("pipeline_2", "step_4")),
    ],
)
def test_parse_round_trips_all_address_shapes(label, expected):
    assert RunAddress.parse(label) == expected
    assert RunAddress.parse(expected.label) == expected


def test_task_constructor_aliases_step_for_existing_builder_vocabulary():
    assert RunAddress.task("claims", "validate_schema") == RunAddress.step(
        "claims", "validate_schema"
    )


@pytest.mark.parametrize(
    "label",
    [
        "",
        "case-review/",
        "/claims",
        "claims.",
        ".validate_schema",
        "case-review/claims.validate_schema.extra",
        "case/review/claims",
    ],
)
def test_invalid_labels_raise_config_category_errors(label):
    with pytest.raises(RunAddressError, match="Invalid run address"):
        RunAddress.parse(label)

    assert RunAddressError("bad").category == ErrorCategory.CONFIG
    assert issubclass(RunAddressError, PipelineError)

```
