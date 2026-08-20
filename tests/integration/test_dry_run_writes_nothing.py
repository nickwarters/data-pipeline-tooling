"""A dry run writes nothing — for *every* composition, not just ``Pipeline``.

The promise of ``--dry-run`` is a preview that lands no artifacts. A plain
``Pipeline`` honoured it, but a composition that builds its own child contexts
(``ForEach``) silently wrote real data during a preview, because the child never
carried the ambient dry-run flag. These tests hold every side-effecting
composition to the same contract: run it under ``dry_run_pipeline`` and assert
the base directory is byte-for-byte unchanged.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import pandas as pd

from framework.core import Dataset
from framework.io import AccumulateByRun, DatasetReader
from framework.run import Pipeline, RunContext, dry_run_pipeline
from tools.medallion import medallion
from tools.orchestration import ForEach
from tools.store import StoreRegistry

SUBJECT = "fixture"


def _snapshot(base_dir: Path) -> dict[str, str]:
    """A content fingerprint of every file under ``base_dir``.

    Keyed by the path relative to the root, in POSIX form so the comparison is
    identical on Windows and macOS.
    """
    snapshot: dict[str, str] = {}
    for path in sorted(base_dir.rglob("*")):
        if path.is_file():
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            snapshot[path.relative_to(base_dir).as_posix()] = digest
    return snapshot


def _source(item: str) -> Dataset:
    return Dataset.from_pandas(pd.DataFrame({"case_ref": [f"{item}-1", f"{item}-2"]}))


def _landing_pipeline(item: str, context: RunContext) -> Pipeline:
    """A pipeline that lands rows in the medallion raw store for one item."""
    med = medallion(StoreRegistry(context.base_dir), SUBJECT)
    pipeline = Pipeline(f"feed-{item}")
    read = pipeline.read(DatasetReader(_source(item)), name=f"read-{item}")
    pipeline.write(
        med.raw.writer("cases", AccumulateByRun.from_context(context)),
        read,
        name=f"write-{item}",
    )
    return pipeline


def _plain_pipeline_handler(context: RunContext) -> None:
    _landing_pipeline("a", context).run()


def _nested_runs_handler(context: RunContext) -> None:
    # Two bare p.run() calls in one attempt: each inherits the ambient context.
    _landing_pipeline("a", context).run()
    _landing_pipeline("b", context).run()


def _for_each_handler(context: RunContext) -> None:
    ForEach(["a", "b"], _landing_pipeline).run(context)


def _for_each_continue_on_error_handler(context: RunContext) -> None:
    ForEach(["a", "b"], _landing_pipeline, continue_on_error=True).run(context)


COMPOSITIONS = {
    "pipeline": _plain_pipeline_handler,
    "nested-runs": _nested_runs_handler,
    "for-each": _for_each_handler,
    "for-each-continue-on-error": _for_each_continue_on_error_handler,
}


def test_every_composition_writes_nothing_under_dry_run(tmp_path):
    for name, handler in COMPOSITIONS.items():
        base_dir = tmp_path / name
        base_dir.mkdir()
        before = _snapshot(base_dir)

        report = dry_run_pipeline(handler, "feed", base_dir)

        assert not report.failed, f"{name}: {report.error}"
        assert _snapshot(base_dir) == before, f"{name} wrote during a dry run"


def test_for_each_dry_run_report_covers_every_item(tmp_path):
    # The report is shared by reference across per-item contexts, so a preview
    # accumulates every item's steps rather than only the last one's.
    report = dry_run_pipeline(_for_each_handler, "feed", tmp_path)

    step_names = [step.name for step in report.steps]
    assert step_names == ["read-a", "write-a", "read-b", "write-b"]


def test_for_each_items_inherit_the_run_parameters(tmp_path):
    seen: list[str] = []

    def handler(context: RunContext) -> None:
        def build(item: str, item_context: RunContext) -> Pipeline:
            seen.append(item_context.params["source_file"])
            return _landing_pipeline(item, item_context)

        ForEach(["a", "b"], build).run(context)

    dry_run_pipeline(handler, "feed", tmp_path, params={"source_file": "claims.csv"})

    assert seen == ["claims.csv", "claims.csv"]
