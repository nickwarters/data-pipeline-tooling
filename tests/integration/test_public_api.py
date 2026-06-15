"""The public framework API: three subpackage facades.

A pipeline author depends on ``framework.io`` / ``framework.transform`` /
``framework.run`` — the stable public surface — not on internal modules by
accident. These tests exercise that surface the way an author would: by building
and running a real pipeline through the facades, and by asserting the internal
plumbing stays out of reach.
"""

import ast
from pathlib import Path

FIXTURE = Path(__file__).parent.parent / "fixtures" / "cases.csv"

PIPELINES_DIR = Path(__file__).parent.parent.parent / "pipelines"
CASE_REVIEW_DIR = Path(__file__).parent.parent.parent / "case_review"
PUBLIC_FACADES = {"io", "run", "transform"}


def _framework_submodules_imported(source: str) -> set[str]:
    """Return the ``framework.<submodule>`` paths a pipeline module imports."""
    tree = ast.parse(source)
    used: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and (node.module or "").startswith(
            "framework."
        ):
            used.add(node.module.split(".", 2)[1])
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.startswith("framework."):
                    used.add(alias.name.split(".", 2)[1])
    return used


def _facade_offenders(root: Path) -> dict[str, set[str]]:
    """Map each production module under ``root`` to the framework internals it
    imports — bypassing the public facades. Empty means the tree is clean.

    Test modules are excluded: their tests legitimately import framework
    internals (e.g. ``framework.testing``).
    """
    offenders: dict[str, set[str]] = {}
    for path in sorted(root.rglob("*.py")):
        if path.name.startswith("test_") or "__pycache__" in path.parts:
            continue
        internal = _framework_submodules_imported(path.read_text()) - PUBLIC_FACADES
        if internal:
            offenders[str(path.relative_to(root))] = internal
    return offenders


def test_package_root_exposes_only_public_facade_modules():
    import framework

    assert framework.__all__ == ["io", "run", "transform"]
    assert framework.io.CsvReader is not None
    assert framework.transform.Filter is not None
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
    from framework.io import RAW, CsvReader, Refresh, Store
    from framework.run import Pipeline

    store = Store(tmp_path / "cases")
    (
        Pipeline("cases", CsvReader(FIXTURE))
        .write_to(store.writer(RAW, "cases", Refresh()))
        .run()
    )

    landed = store.reader(RAW, "cases").read()
    assert len(landed) == 3
    assert "case_id" in landed.columns


def test_file_deliverable_writers_are_available_through_the_io_facade(tmp_path):
    from framework.io import (
        CsvReader,
        CsvWriter,
        ExcelWriter,
        JsonWriter,
        Refresh,
        SharePointWriter,
    )
    from framework.run import Pipeline

    target = tmp_path / "deliverables" / "cases.csv"
    Pipeline("cases", CsvReader(FIXTURE)).write_to(CsvWriter(target, Refresh())).run()

    assert target.exists()
    assert ExcelWriter is not None
    assert JsonWriter is not None
    assert SharePointWriter is not None


def test_an_author_can_shape_and_check_a_feed_through_the_transform_facade(tmp_path):
    # Selection-style narrowing: processors and validators come from
    # framework.transform, composed onto the framework.run Pipeline.
    from framework.io import RAW, CsvReader, Refresh, Store
    from framework.run import Pipeline
    from framework.transform import (
        ColumnValidator,
        Filter,
        Score,
        VectorizedDerive,
        VectorizedFilter,
    )

    store = Store(tmp_path / "cases")
    landed = (
        Pipeline("cases", CsvReader(FIXTURE))
        .with_validator(ColumnValidator(["amount"]))
        .with_processor(Score("priority", lambda row: row["amount"] * 2))
        .with_processor(VectorizedDerive("priority_x2", lambda df: df["priority"] * 2))
        .with_processor(Filter(lambda row: row["amount"] >= 1000, name="high-value"))
        .with_processor(
            VectorizedFilter(
                lambda df: df["priority_x2"] >= 4000,
                name="high-priority",
            )
        )
        .write_to(store.writer(RAW, "cases", Refresh()))
        .run()
    )

    # The Filter dropped the sub-1000 Case; Score added its column.
    assert len(landed) == 2
    assert "priority" in landed.columns
    assert "priority_x2" in landed.columns


def test_an_author_can_compose_ordered_stages_through_the_run_facade(tmp_path):
    from framework.io import RAW, CsvReader, Refresh, Store
    from framework.run import Pipeline, ProcessingStage, ValidationStage
    from framework.transform import ColumnValidator, Score

    store = Store(tmp_path / "cases")
    landed = (
        Pipeline("cases", CsvReader(FIXTURE))
        .add_stage(
            ValidationStage(
                name="Validate source shape",
                validators=[ColumnValidator(["amount"])],
            )
        )
        .add_stage(
            ProcessingStage(
                name="Score cases",
                processors=[Score("priority", lambda row: row["amount"] * 2)],
            )
        )
        .add_stage(
            ValidationStage(
                name="Validate scored cases",
                validators=[ColumnValidator(["priority"])],
            )
        )
        .write_to(store.writer(RAW, "cases", Refresh()))
        .run()
    )

    assert len(landed) == 3
    assert "priority" in landed.columns


def test_internal_plumbing_stays_out_of_the_public_facades():
    # Authors must not reach internal seams through the facades. These names are
    # implementation detail (connection factory, layer-name helper, trace
    # mechanics, remote client seam, runner/run-log internals) — documented as
    # internal in docs/public-api.md and absent from every facade's __all__.
    from framework import io, run, transform

    internal = {
        "connect",  # framework.shared.connection — connection factory seam
        "layer_name",  # framework.io.layers — internal validation helper
        "LAYERS",  # framework.io.layers — internal tuple
        "RowTrace",  # framework.run.trace — generic trace mechanics
        "RemoteRunner",  # framework.io.remote — stubbed remote client seam
        "FreshnessGuard",  # framework.run.runner — internal guard
        "StepMetrics",  # framework.run.run_log — internal timing record
        "pipeline_label",  # framework.run.runner — internal label helper
    }
    for facade in (io, run, transform):
        leaked = internal & set(facade.__all__)
        assert not leaked, f"{facade.__name__} leaks internal names: {leaked}"
        # __all__ is also honest: every advertised name resolves on the facade.
        for name in facade.__all__:
            assert hasattr(facade, name), f"{facade.__name__}.{name} missing"


def test_demo_pipelines_import_framework_only_through_the_public_facades():
    # downstream scripts depend on the stable surface, not internal modules
    # by accident. Every framework import in pipelines/ must go through a facade —
    # including feed subpackages (pipelines/<feed>/, scaffolded by ). Test
    # modules are excluded: their tests legitimately import framework.testing.
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
