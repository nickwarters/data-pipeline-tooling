import uuid

import pytest

from case_review.case_type import CaseType, Variation
from tests._schema_fixtures import LandedCase


def test_case_type_derives_its_namespace_from_its_name():
    # The identity contract: the Case Type owns the UUID space its
    # case_id derives under, computed deterministically from its name so each
    # Case Type has its own space without storing an opaque UUID by hand.
    case_type = CaseType(name="cases", schema=LandedCase, natural_key=("case_ref",))

    assert case_type.namespace == uuid.uuid5(uuid.NAMESPACE_DNS, "cases")
    # Stable across constructions — same name, same space.
    assert case_type.namespace == CaseType(
        name="cases", schema=LandedCase, natural_key=("ref",)
    ).namespace


def test_case_type_looks_up_a_variation_by_id():
    # A Case Type bundles its schema with its declarative Variations; the
    # variation(id) lookup is how Selection resolves "which Question Bank" for a
    # run without a global CaseType config registry.
    case_type = CaseType(
        name="cases",
        schema=LandedCase,
        natural_key=("case_ref",),
        variations=(
            Variation(id="v1", question_bank_id="qb-100"),
            Variation(id="v2", question_bank_id="qb-200"),
        ),
    )

    assert case_type.variation("v2").question_bank_id == "qb-200"


def test_case_type_raises_on_an_unknown_variation():
    # An unknown Variation id is a configuration error surfaced where it is
    # asked for, with a located message naming the Case Type and the id.
    case_type = CaseType(
        name="cases",
        schema=LandedCase,
        natural_key=("case_ref",),
        variations=(Variation(id="v1", question_bank_id="qb-100"),),
    )

    with pytest.raises(KeyError, match="cases.*v9"):
        case_type.variation("v9")
