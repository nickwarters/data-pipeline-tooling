import datetime as dt

import pandas as pd
import pytest

from framework.builder import Pipeline
from framework.dataset import Dataset
from framework.orchestration import ForEachPipelineError, run_for_each
from framework.run_context import RunContext
from framework.store import Store
from framework.strategy import AccumulateByRun


class RecordingReader:
    def __init__(self, value: str) -> None:
        self._value = value

    def read(self) -> Dataset:
        return Dataset.from_pandas(pd.DataFrame({"value": [self._value]}))


class CapturingWriter:
    def __init__(self) -> None:
        self.written: list[Dataset] = []

    def write(self, dataset: Dataset) -> None:
        self.written.append(dataset)


class BrokenReader:
    def read(self) -> Dataset:
        raise RuntimeError("source unavailable")


def test_run_for_each_executes_one_pipeline_per_item():
    writer = CapturingWriter()

    def build_pipeline(item: str, context) -> Pipeline:
        return Pipeline(f"feed-{item}", RecordingReader(item)).write_to(writer)

    results = run_for_each(["a", "b"], build_pipeline)

    assert [dataset.to_pandas()["value"].iloc[0] for dataset in results] == ["a", "b"]
    assert [dataset.to_pandas()["value"].iloc[0] for dataset in writer.written] == [
        "a",
        "b",
    ]


def test_run_for_each_builds_a_fresh_pipeline_for_each_item():
    pipelines: list[Pipeline] = []

    def build_pipeline(item: str, context) -> Pipeline:
        pipeline = Pipeline(f"feed-{item}", RecordingReader(item)).write_to(
            CapturingWriter()
        )
        pipelines.append(pipeline)
        return pipeline

    run_for_each(["a", "b"], build_pipeline)

    assert len(pipelines) == 2
    assert pipelines[0] is not pipelines[1]


def test_run_for_each_stops_at_first_failed_item_and_names_it():
    completed: list[str] = []

    def build_pipeline(item: str, context) -> Pipeline:
        if item == "bad":
            return Pipeline(f"feed-{item}", BrokenReader())

        class RecordingWriter:
            def write(self, dataset: Dataset) -> None:
                completed.append(item)

        return Pipeline(f"feed-{item}", RecordingReader(item)).write_to(RecordingWriter())

    with pytest.raises(ForEachPipelineError, match="bad"):
        run_for_each(["first", "bad", "never"], build_pipeline)

    assert completed == ["first"]


def test_run_for_each_passes_per_item_context_with_derived_logical_run_id():
    contexts: list[RunContext] = []
    parent = RunContext(
        run_date=dt.date(2026, 6, 9),
        logical_run_id="selection:2026-06-09",
        load_date="2026-06-09",
    )

    def logical_run_id(item: str, index: int, context: RunContext) -> str:
        return f"{context.logical_run_id}:{index}:{item}"

    def build_pipeline(item: str, context: RunContext) -> Pipeline:
        contexts.append(context)
        return Pipeline(f"feed-{item}", RecordingReader(item)).write_to(
            CapturingWriter()
        )

    run_for_each(
        ["a", "b"],
        build_pipeline,
        context=parent,
        logical_run_id=logical_run_id,
    )

    assert [context.logical_run_id for context in contexts] == [
        "selection:2026-06-09:0:a",
        "selection:2026-06-09:1:b",
    ]
    assert [context.load_date for context in contexts] == ["2026-06-09", "2026-06-09"]
    assert contexts[0].execution_id != contexts[1].execution_id


def test_run_for_each_context_supports_per_item_accumulate_by_run_writes(tmp_path):
    store = Store(tmp_path / "cases")
    parent = RunContext(logical_run_id="selection:2026-06-09", load_date="2026-06-09")

    def logical_run_id(item: str, index: int, context: RunContext) -> str:
        return f"{context.logical_run_id}:{item}"

    def build_pipeline(item: str, context: RunContext) -> Pipeline:
        writer = store.writer(
            "gold", "selection_pool", AccumulateByRun.from_context(context)
        )
        return Pipeline(f"feed-{item}", RecordingReader(item)).write_to(writer)

    run_for_each(
        ["file-a", "file-b"],
        build_pipeline,
        context=parent,
        logical_run_id=logical_run_id,
    )

    frame = store.reader("gold", "selection_pool").read().to_pandas()
    assert set(frame["logical_run_id"]) == {
        "selection:2026-06-09:file-a",
        "selection:2026-06-09:file-b",
    }
    assert frame.groupby("logical_run_id")["execution_id"].nunique().to_dict() == {
        "selection:2026-06-09:file-a": 1,
        "selection:2026-06-09:file-b": 1,
    }
