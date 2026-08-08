from dataclasses import FrozenInstanceError, fields

import pytest

from case_review.variation import Variation


def test_variation_keeps_its_declarative_contract():
    variation = Variation(id="v1", question_bank_id="qb-100")

    assert [field.name for field in fields(variation)] == ["id", "question_bank_id"]
    assert variation.id == "v1"
    assert variation.question_bank_id == "qb-100"

    with pytest.raises(FrozenInstanceError):
        variation.question_bank_id = "qb-200"
