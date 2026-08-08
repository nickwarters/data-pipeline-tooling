import importlib.util
from dataclasses import FrozenInstanceError, fields

import pytest

from case_review.variation import Variation, variation_by_id


def test_variation_keeps_its_declarative_contract():
    variation = Variation(id="v1", question_bank_id="qb-100")

    assert [field.name for field in fields(variation)] == ["id", "question_bank_id"]
    assert variation.id == "v1"
    assert variation.question_bank_id == "qb-100"

    with pytest.raises(FrozenInstanceError):
        variation.question_bank_id = "qb-200"


def test_variation_by_id_returns_the_matching_variation():
    v1 = Variation(id="v1", question_bank_id="qb-100")
    v2 = Variation(id="v2", question_bank_id="qb-200")

    assert variation_by_id((v1, v2), "v2") is v2


def test_variation_by_id_reports_an_unknown_id():
    with pytest.raises(KeyError) as error:
        variation_by_id((), "missing")

    assert error.value.args == ("No Variation with id 'missing'",)


def test_retired_case_type_module_is_absent():
    assert importlib.util.find_spec("case_review.case_type") is None
