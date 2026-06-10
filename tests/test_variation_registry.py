"""Declarative Variation registry: load Variations from YAML config (#58).

Case Type B has ~100 Variations; hand-constructing them in Python does not scale
(CONTEXT.md). These tests pin the data-driven loader that mints ``Variation``
objects from a YAML file, binding them to a code-defined Case Type ``schema``.
"""

from pathlib import Path

import pytest

from case_review.case_type import Variation
from case_review.variation_registry import (
    case_type_from_config,
    load_variations,
)
from tests._schema_fixtures import LandedCase


def _write(tmp_path: Path, text: str) -> Path:
    config = tmp_path / "variations.yaml"
    config.write_text(text, encoding="utf-8")
    return config


def test_loads_variations_from_a_yaml_mapping(tmp_path: Path):
    # The common case: each Variation is a one-line `id: question_bank_id`
    # entry under `variations:`. The loader mints a Variation per entry.
    config = _write(
        tmp_path,
        "variations:\n  v1: qb-100\n  v2: qb-200\n",
    )

    variations = load_variations(config)

    assert variations == (
        Variation(id="v1", question_bank_id="qb-100"),
        Variation(id="v2", question_bank_id="qb-200"),
    )


def test_case_type_from_config_binds_variations_to_a_code_schema(tmp_path: Path):
    # The small Case Type A set: ~3 Variations declared in config, bound to the
    # type's code-defined schema. A Variation inherits its Case Type by living
    # in the one CaseType object; Selection resolves the Question Bank via the
    # ordinary `.variation(id)` lookup from #11.
    config = _write(
        tmp_path,
        "variations:\n  a1: qb-100\n  a2: qb-200\n  a3: qb-300\n",
    )

    case_type = case_type_from_config("cases", LandedCase, config)

    assert case_type.name == "cases"
    assert case_type.schema is LandedCase
    assert case_type.variation("a3").question_bank_id == "qb-300"


def test_config_with_no_variations_key_yields_no_variations(tmp_path: Path):
    # A Case Type need not declare any Variations yet (or the key is simply
    # absent). That degrades to an empty tuple — a Case Type with no Variations
    # still works — rather than an error.
    config = _write(tmp_path, "# nothing declared yet\n")

    assert load_variations(config) == ()


def test_empty_variations_mapping_yields_no_variations(tmp_path: Path):
    # An explicit-but-empty `variations:` mapping degrades the same way.
    config = _write(tmp_path, "variations:\n")

    assert load_variations(config) == ()


def test_non_mapping_variations_degrades_with_a_located_error(tmp_path: Path):
    # A wrong shape (a list, not an id->question-bank mapping) is a config error,
    # not silent emptiness. It degrades clearly, naming the offending file so an
    # operator can find it — the future config-lint pass starts here.
    config = _write(tmp_path, "variations:\n  - v1\n  - v2\n")

    with pytest.raises(ValueError, match=str(config)):
        load_variations(config)


def test_loads_a_generated_case_type_b_set_of_a_hundred(tmp_path: Path):
    # Case Type B has ~100 Variations — the scale that motivates the registry.
    # A generated set proves config-driven minting holds up where Python
    # hand-construction does not (CONTEXT.md): every line is one Variation, each
    # overriding only its Question Bank.
    lines = [f"  v{n:03d}: qb-{1000 + n}" for n in range(1, 101)]
    config = _write(tmp_path, "variations:\n" + "\n".join(lines) + "\n")

    case_type = case_type_from_config("b", LandedCase, config)

    assert len(case_type.variations) == 100
    assert case_type.variation("v001").question_bank_id == "qb-1001"
    assert case_type.variation("v100").question_bank_id == "qb-1100"
