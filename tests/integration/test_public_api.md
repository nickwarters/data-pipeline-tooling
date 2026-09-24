```python
"""The public framework API: subpackage facades.

A pipeline author depends on ``framework.core`` / ``framework.io`` /
``framework.transform`` / ``framework.run`` — the four facades that make up the
stable public surface — not on internal modules by accident. These tests
exercise that surface the way an author would: by building and running a real
pipeline through the facades, and by asserting the internal plumbing stays out
of reach.

The boundary check below is deliberately strict about *both* halves of the rule:
a non-facade top-level module (``framework._internal.schema``) is a violation,
and so is reaching *behind* a facade for one of its implementation modules
(``framework.core.value_rules``). The second half is the one the rule is really
about — the facade name is the contract, the module path behind it is layout.
"""

import ast
from pathlib import Path

FIXTURE = Path(__file__).parent.parent / "fixtures" / "cases.csv"

PIPELINES_DIR = Path(__file__).parent.parent.parent / "pipelines"
CASE_REVIEW_DIR = Path(__file__).parent.parent.parent / "case_review"
READERS_DIR = Path(__file__).parent.parent.parent / "readers"
PUBLIC_FACADES = {"core", "io", "transform", "run"}


def _facade_violations(module_path: str) -> str | None:
    """Return why ``module_path`` breaks the facade rule, or ``None`` if it doesn't.

    Non-framework imports are none of this check's business. A framework import
    is legal only when it names a facade *exactly*: ``framework.transform`` is
    the contract, ``framework.transform.processors`` is layout and
    ``framework._internal.schema`` is private.
    """
    parts = module_path.split(".")
    if parts[0] != "framework":
        return None
    if len(parts) == 1:
        # `import framework` / `from framework import core` — the package root
        # only binds the facades, so it cannot reach past them.
        return None
    if parts[1] not in PUBLIC_FACADES:
        return f"{module_path} is not a public facade"
    if len(parts) > 2:
        return f"{module_path} reaches behind the framework.{parts[1]} facade"
    return None


def _framework_import_violations(source: str) -> list[str]:
    """Return one message per framework import in ``source`` that breaks the rule."""
    tree = ast.parse(source)
    found: list[str] = []
    for node in ast.walk(tree):
        modules: list[str] = []
        if isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            modules = [node.module]
        elif isinstance(node, ast.Import):
            modules = [alias.name for alias in node.names]
        for module in modules:
            reason = _facade_violations(module)
            if reason is not None:
                found.append(f"line {node.lineno}: {reason}")
    return found


def _scanned_modules(root: Path) -> list[str]:
    """Return the production modules the facade check inspects under ``root``.

    Test modules are excluded: their tests legitimately import framework
    internals (e.g. ``tests.framework_testing``).

    Exposed so a tree's test can assert it actually *scanned* something. An
    empty tree yields no offenders, which reads exactly like a clean one — the
    kind of assertion that infers a guarantee from an absence.
    """
    return [
        str(path.relative_to(root))
        for path in sorted(root.rglob("*.py"))
        if not path.name.startswith("test_") and "__pycache__" not in path.parts
    ]


def _facade_offenders(root: Path) -> dict[str, list[str]]:
    """Map each production module under ``root`` to the ways it bypasses the
    public facades. Empty means the tree is clean.
    """
    offenders: dict[str, list[str]] = {}
    for name in _scanned_modules(root):
        found = _framework_import_violations((root / name).read_text(encoding="utf-8"))
        if found:
            offenders[name] = found
    return offenders


def test_package_root_exposes_only_public_facade_modules():
    import framework

    assert framework.__all__ == [
        "core",
        "io",
        "transform",
        "run",
    ]
    # Every advertised facade must be bound at runtime, not merely listed in __all__.
    for name in framework.__all__:
        assert hasattr(framework, name), (
            f"framework.{name} listed in __all__ but unbound"
        )
    assert framework.core.Dataset is not None
    assert framework.io.CsvReader is not None
    assert framework.transform.Filter is not None
    # The validate(dataset) checks are exported from framework.core.
    assert framework.core.SchemaValidator is not None
    assert framework.core.ColumnValidator is not None
    assert framework.run.Pipeline is not None

    unsupported_facade_names = {
        "CsvReader",
        "Filter",
        "Pipeline",
        "Dataset",
        "Store",
        "RunLog",
    }
    for name in unsupported_facade_names:
        assert not hasattr(framework, name), f"framework.{name} is not public"


def test_an_author_can_ingest_a_feed_through_the_io_and_run_facades(tmp_path):
    # The blessed import path: sources/sinks from framework.io, the builder from
    # framework.run. Composing and running them lands the feed and reads back.
    from framework.io import CsvReader, Refresh
    from framework.run import Pipeline
    from tools.store import Store

    store = Store(tmp_path / "cases.db")
    p = Pipeline("cases")
    r = p.read(CsvReader(FIXTURE), name="read")
    p.write(store.writer("cases", Refresh()), r, name="write")
    p.run()

    landed = store.reader("cases").read()
    assert len(landed) == 3
    assert "case_id" in landed.columns


def test_file_deliverable_writers_are_available_through_the_io_facade(tmp_path):
    from framework.io import (
        CsvReader,
        CsvWriter,
        ExcelWriter,
        JsonWriter,
        Refresh,
    )
    from framework.run import Pipeline

    target = tmp_path / "deliverables" / "cases.csv"
    p = Pipeline("cases")
    r = p.read(CsvReader(FIXTURE), name="read")
    p.write(CsvWriter(target, Refresh()), r, name="write")
    p.run()

    assert target.exists()
    assert ExcelWriter is not None
    assert JsonWriter is not None


def test_an_author_can_shape_and_check_a_feed_through_the_transform_facade(tmp_path):
    # Selection-style narrowing: processors come from framework.transform and
    # the checks from framework.core, composed onto the framework.run Pipeline.
    from framework.core import ColumnValidator
    from framework.io import CsvReader, Refresh
    from framework.run import Pipeline
    from framework.transform import (
        Filter,
        SchemaCoercion,
        Score,
        VectorizedDerive,
        VectorizedFilter,
    )
    from tests._schema_fixtures import FixtureCase
    from tools.store import Store

    store = Store(tmp_path / "cases.db")
    p = Pipeline("cases")
    r = p.read(CsvReader(FIXTURE), name="read")
    v = p.validate(ColumnValidator(["amount"]), r, name="validate")
    # A CSV read is text, so the declared types come first and the scoring and
    # filtering below are arithmetic rather than string repetition.
    c = p.transform(SchemaCoercion(FixtureCase), v, name="coerce")
    s = p.transform(Score("priority", lambda row: row["amount"] * 2), c, name="score")
    vd = p.transform(
        VectorizedDerive("priority_x2", lambda df: df["priority"] * 2), s, name="derive"
    )
    f = p.transform(
        Filter(lambda row: row["amount"] >= 1000, name="high-value"), vd, name="filter"
    )
    vf = p.transform(
        VectorizedFilter(lambda df: df["priority_x2"] >= 4000, name="high-priority"),
        f,
        name="vector-filter",
    )
    p.write(store.writer("cases", Refresh()), vf, name="write")
    landed = p.run()

    # The Filter dropped the sub-1000 Case; Score added its column.
    assert len(landed) == 2
    assert "priority" in landed.columns
    assert "priority_x2" in landed.columns


def test_an_author_can_compose_ordered_stages_through_the_run_facade(tmp_path):
    from framework.core import ColumnValidator
    from framework.io import CsvReader, Refresh
    from framework.run import Pipeline
    from framework.transform import SchemaCoercion, Score
    from tests._schema_fixtures import FixtureCase
    from tools.store import Store

    store = Store(tmp_path / "cases.db")
    p = Pipeline("cases")
    r = p.read(CsvReader(FIXTURE), name="read")
    v1 = p.validate(ColumnValidator(["amount"]), r, name="validate-source")
    c = p.transform(SchemaCoercion(FixtureCase), v1, name="coerce")
    s = p.transform(Score("priority", lambda row: row["amount"] * 2), c, name="score")
    v2 = p.validate(ColumnValidator(["priority"]), s, name="validate-scored")
    p.write(store.writer("cases", Refresh()), v2, name="write")
    landed = p.run()

    assert len(landed) == 3
    assert "priority" in landed.columns


def test_internal_plumbing_stays_out_of_the_public_facades():
    # Authors must not reach internal seams through the facades. These names are
    # implementation detail (connection factory, layer-name helper, trace
    # mechanics, runner/run-log internals) — documented as
    # internal in docs/public-api.md and absent from every facade's __all__.
    from framework import core, io, run, transform

    internal = {
        "connect",  # framework._internal.connection — connection factory seam
        "RowTrace",  # framework.run.trace — generic trace mechanics
        "FreshnessGuard",  # framework.run.runner — internal guard
        "StepMetrics",  # tools.observability.run_log — internal timing record
        "pipeline_label",  # framework.run.runner — internal label helper
    }
    for facade in (core, io, transform, run):
        leaked = internal & set(facade.__all__)
        assert not leaked, f"{facade.__name__} leaks internal names: {leaked}"
        # __all__ is also honest: every advertised name resolves on the facade.
        for name in facade.__all__:
            assert hasattr(facade, name), f"{facade.__name__}.{name} missing"


def test_demo_pipelines_import_framework_only_through_the_public_facades():
    # downstream scripts depend on the stable surface, not internal modules
    # by accident. Every framework import in pipelines/ must go through a facade —
    # including feed subpackages (pipelines/<feed>/, rendered by the scaffold
    # command from its templates). Test
    # modules are excluded: their tests legitimately import tests.framework_testing.
    assert not _facade_offenders(PIPELINES_DIR), (
        f"pipelines bypassing the public facades: {_facade_offenders(PIPELINES_DIR)}"
    )


def test_case_review_imports_framework_only_through_the_public_facades():
    # case_review/ is an application layer above the framework — the same
    # architectural position as pipelines/ — so it depends on the same stable
    # surface. Production code only: domain *tests* (tests/case_review/)
    # legitimately import framework internals and stay out of scope.
    offenders = _facade_offenders(CASE_REVIEW_DIR)
    assert not offenders, f"case_review bypassing the public facades: {offenders}"


def test_readers_import_framework_only_through_the_public_facades():
    # readers/ is a third application tree beside pipelines/ and case_review/ —
    # the shared readers a pipeline uses to reach data it does not own — so it
    # is held to the same boundary. tools.store / tools.medallion are sibling
    # utilities, not framework internals, and stay allowed: resolving where a
    # dataset lands is exactly what a module here is for.
    offenders = _facade_offenders(READERS_DIR)
    assert not offenders, f"readers bypassing the public facades: {offenders}"
    # Guard against a stable no-offenders result from an empty scan.
    assert _scanned_modules(READERS_DIR), f"{READERS_DIR} has no modules to check"


def test_the_boundary_check_itself_catches_both_kinds_of_violation():
    # The check above is only worth its CI status if it would actually fail.
    # Pin both rejection paths here: reaching behind a public facade and naming
    # a private framework module must each produce a violation.
    behind_a_facade = _framework_import_violations(
        "from framework.core.value_rules import Range\n"
    )
    assert behind_a_facade == [
        "line 1: framework.core.value_rules reaches behind the framework.core facade"
    ]

    private_module = _framework_import_violations(
        "from framework._internal.schema import ValueRule\n"
    )
    assert private_module == [
        "line 1: framework._internal.schema is not a public facade"
    ]

    # `import framework.io.strategy` is the same violation in the other syntax.
    assert _framework_import_violations("import framework.io.strategy\n") == [
        "line 1: framework.io.strategy reaches behind the framework.io facade"
    ]

    # The four facades themselves, and anything outside framework, are fine.
    for legal in (
        "from framework.core import Dataset\n",
        "from framework.io import CsvReader\n",
        "from framework.transform import Filter\n",
        "from framework.run import Pipeline\n",
        "import framework\n",
        "from tools.store import StoreRegistry\n",
        "from case_review.variation import Variation\n",
    ):
        assert _framework_import_violations(legal) == [], legal

```
