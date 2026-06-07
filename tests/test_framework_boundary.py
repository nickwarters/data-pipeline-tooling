import importlib.util


def test_case_review_domain_helpers_live_outside_the_framework():
    # The reusable framework owns pipeline primitives; the case-review
    # application owns CaseType/Variation and CasePool.
    assert importlib.util.find_spec("case_review.case_type") is not None
    assert importlib.util.find_spec("case_review.case_pool") is not None
    assert importlib.util.find_spec("framework.case_type") is None
    assert importlib.util.find_spec("framework.case_pool") is None


def test_framework_trace_mechanics_use_generic_names():
    from framework.processors import Filter
    from framework.trace import RowTrace

    gate = Filter(lambda row: True, name="eligible")

    assert importlib.util.find_spec("framework.explain") is None
    assert RowTrace.__name__ == "RowTrace"
    assert gate.trace_role == "filter"
    assert gate.trace_name == "eligible"
    assert not hasattr(gate, "selection_role")
    assert not hasattr(gate, "selection_name")


def test_case_review_gold_helpers_wrap_generic_framework_reducers():
    import framework.gold as framework_gold
    from case_review import gold as case_review_gold

    assert hasattr(framework_gold, "current_silver_to_gold")
    assert hasattr(framework_gold, "detail_current_silver_to_gold")
    assert not hasattr(framework_gold, "ingest_silver_to_gold")
    assert hasattr(case_review_gold, "ingest_silver_to_gold")
    assert hasattr(case_review_gold, "detail_ingest_silver_to_gold")
