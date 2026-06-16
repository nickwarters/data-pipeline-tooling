```python
import importlib.util
import ast
from pathlib import Path

FRAMEWORK_DIR = Path(__file__).parent.parent.parent / "framework"


def _framework_package_edges() -> set[tuple[str, str]]:
    edges: set[tuple[str, str]] = set()
    for path in FRAMEWORK_DIR.rglob("*.py"):
        source_package = "framework." + path.relative_to(FRAMEWORK_DIR).parts[0]
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            modules: list[str] = []
            if isinstance(node, ast.ImportFrom) and (node.module or "").startswith(
                "framework."
            ):
                modules.append(node.module)
            elif isinstance(node, ast.Import):
                modules.extend(
                    alias.name
                    for alias in node.names
                    if alias.name.startswith("framework.")
                )
            for module in modules:
                parts = module.split(".")
                if len(parts) >= 2:
                    target_package = ".".join(parts[:2])
                    if source_package != target_package:
                        edges.add((source_package, target_package))
    return edges


def test_case_review_domain_helpers_live_outside_the_framework():
    # The reusable framework owns pipeline primitives; the case-review
    # application owns CaseType/Variation and CasePool.
    assert importlib.util.find_spec("case_review.case_type") is not None
    assert importlib.util.find_spec("case_review.case_pool") is not None
    assert importlib.util.find_spec("framework.case_type") is None
    assert importlib.util.find_spec("framework.case_pool") is None


def test_framework_trace_mechanics_use_generic_names():
    from framework.run.trace import RowTrace
    from framework.transform.processors import Filter

    gate = Filter(lambda row: True, name="eligible")

    assert importlib.util.find_spec("framework.explain") is None
    assert RowTrace.__name__ == "RowTrace"
    assert gate.trace_role == "filter"
    assert gate.trace_name == "eligible"
    assert not hasattr(gate, "selection_role")
    assert not hasattr(gate, "selection_name")


def test_case_review_gold_helpers_wrap_generic_framework_reducers():
    import framework.run.gold as framework_gold
    from case_review import gold as case_review_gold

    assert hasattr(framework_gold, "current_silver_to_gold")
    assert hasattr(framework_gold, "detail_current_silver_to_gold")
    assert not hasattr(framework_gold, "ingest_silver_to_gold")
    assert hasattr(case_review_gold, "ingest_silver_to_gold")
    assert hasattr(case_review_gold, "detail_ingest_silver_to_gold")


def test_framework_package_dependencies_keep_concerns_separate():
    edges = _framework_package_edges()

    forbidden = {
        ("framework.core", "framework.io"),
        ("framework.core", "framework.run"),
        ("framework.core", "framework.transform"),
        ("framework.core", "framework.validate"),
        ("framework.io", "framework.run"),
        ("framework.io", "framework.transform"),
        ("framework.io", "framework.validate"),
        ("framework.shared", "framework.io"),
        ("framework.transform", "framework.io"),
        ("framework.validate", "framework.io"),
        ("framework.validate", "framework.run"),
        ("framework.recipes", "framework._internal"),
    }

    assert not (edges & forbidden)

```
