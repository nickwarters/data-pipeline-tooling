```python
import datetime as dt

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.io.store import Store
from framework.io.strategy import AccumulateByRun
from framework.run.builder import Pipeline
from framework.run.run_context import RunContext
from tools.orchestration import ForEach, ForEachPipelineError


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


def test_for_each_executes_one_pipeline_per_item():
    writer = CapturingWriter()

    def build_pipeline(item: str, context) -> Pipeline:
        p = Pipeline(f"feed-{item}")
        r = p.read(RecordingReader(item), name="read")
        p.write(writer, r, name="write")
        return p

    results = ForEach(["a", "b"], build_pipeline).run()

    assert [dataset.to_pandas()["value"].iloc[0] for dataset in results] == ["a", "b"]
    assert [dataset.to_pandas()["value"].iloc[0] for dataset in writer.written] == [
        "a",
        "b",
    ]


def test_for_each_builds_a_fresh_pipeline_for_each_item():
    pipelines: list[Pipeline] = []

    def build_pipeline(item: str, context) -> Pipeline:
        pipeline = Pipeline(f"feed-{item}")
        r = pipeline.read(RecordingReader(item), name="read")
        pipeline.write(CapturingWriter(), r, name="write")
        pipelines.append(pipeline)
        return pipeline

    ForEach(["a", "b"], build_pipeline).run()

    assert len(pipelines) == 2
    assert pipelines[0] is not pipelines[1]


def test_for_each_stops_at_first_failed_item_and_names_it():
    completed: list[str] = []

    def build_pipeline(item: str, context) -> Pipeline:
        if item == "bad":
            p = Pipeline(f"feed-{item}")
            p.read(BrokenReader(), name="read")
            return p

        class RecordingWriter:
            def write(self, dataset: Dataset) -> None:
                completed.append(item)

        p = Pipeline(f"feed-{item}")
        r = p.read(RecordingReader(item), name="read")
        p.write(RecordingWriter(), r, name="write")
        return p

    with pytest.raises(ForEachPipelineError, match="bad"):
        ForEach(["first", "bad", "never"], build_pipeline).run()

    assert completed == ["first"]


def test_for_each_best_effort_records_mixed_success_and_failure_outcomes():
    completed: list[str] = []

    def build_pipeline(item: str, context) -> Pipeline:
        if item == "bad":
            p = Pipeline(f"feed-{item}")
            p.read(BrokenReader(), name="read")
            return p

        class RecordingWriter:
            def write(self, dataset: Dataset) -> None:
                completed.append(item)

        p = Pipeline(f"feed-{item}")
        r = p.read(RecordingReader(item), name="read")
        p.write(RecordingWriter(), r, name="write")
        return p

    outcomes = ForEach(
        ["first", "bad", "last"],
        build_pipeline,
        continue_on_error=True,
    ).run()

    assert [outcome.item for outcome in outcomes] == ["first", "bad", "last"]
    assert [outcome.succeeded for outcome in outcomes] == [True, False, True]
    assert [outcome.dataset is not None for outcome in outcomes] == [True, False, True]
    assert isinstance(outcomes[1].exception, RuntimeError)
    assert str(outcomes[1].exception) == "source unavailable"
    assert completed == ["first", "last"]


def test_for_each_best_effort_records_all_failure_outcomes_without_raising():
    def build_pipeline(item: str, context) -> Pipeline:
        p = Pipeline(f"feed-{item}")
        p.read(BrokenReader(), name="read")
        return p

    outcomes = ForEach(
        ["bad-a", "bad-b"],
        build_pipeline,
        continue_on_error=True,
    ).run()

    assert [outcome.item for outcome in outcomes] == ["bad-a", "bad-b"]
    assert [outcome.index for outcome in outcomes] == [0, 1]
    assert [outcome.succeeded for outcome in outcomes] == [False, False]
    assert [type(outcome.exception) for outcome in outcomes] == [
        RuntimeError,
        RuntimeError,
    ]


def test_for_each_best_effort_outcomes_include_summary_identity():
    parent = RunContext(logical_run_id="ingest:2026-06-09")

    def logical_run_id(item: str, index: int, context: RunContext) -> str:
        return f"{context.logical_run_id}:{item}"

    def build_pipeline(item: str, context) -> Pipeline:
        if item == "bad":
            p = Pipeline(f"feed-{item}")
            p.read(BrokenReader(), name="read")
            return p
        p = Pipeline(f"feed-{item}")
        r = p.read(RecordingReader(item), name="read")
        p.write(CapturingWriter(), r, name="write")
        return p

    outcomes = ForEach(
        ["good", "bad"],
        build_pipeline,
        logical_run_id=logical_run_id,
        continue_on_error=True,
    ).run(parent)

    assert [outcome.status for outcome in outcomes] == ["success", "failure"]
    assert [outcome.logical_run_id for outcome in outcomes] == [
        "ingest:2026-06-09:good",
        "ingest:2026-06-09:bad",
    ]


def test_for_each_passes_per_item_context_with_derived_logical_run_id():
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
        p = Pipeline(f"feed-{item}")
        r = p.read(RecordingReader(item), name="read")
        p.write(CapturingWriter(), r, name="write")
        return p

    ForEach(
        ["a", "b"],
        build_pipeline,
        logical_run_id=logical_run_id,
    ).run(parent)

    assert [context.logical_run_id for context in contexts] == [
        "selection:2026-06-09:0:a",
        "selection:2026-06-09:1:b",
    ]
    assert [context.load_date for context in contexts] == ["2026-06-09", "2026-06-09"]
    assert contexts[0].execution_id != contexts[1].execution_id


def test_for_each_context_supports_per_item_accumulate_by_run_writes(tmp_path):
    store = Store(tmp_path / "cases.db")
    parent = RunContext(logical_run_id="selection:2026-06-09", load_date="2026-06-09")

    def logical_run_id(item: str, index: int, context: RunContext) -> str:
        return f"{context.logical_run_id}:{item}"

    def build_pipeline(item: str, context: RunContext) -> Pipeline:
        writer = store.writer("selection_pool", AccumulateByRun.from_context(context))
        p = Pipeline(f"feed-{item}")
        r = p.read(RecordingReader(item), name="read")
        p.write(writer, r, name="write")
        return p

    ForEach(
        ["file-a", "file-b"],
        build_pipeline,
        logical_run_id=logical_run_id,
    ).run(parent)

    frame = store.reader("selection_pool").read().to_pandas()
    assert set(frame["logical_run_id"]) == {
        "selection:2026-06-09:file-a",
        "selection:2026-06-09:file-b",
    }
    assert frame.groupby("logical_run_id")["execution_id"].nunique().to_dict() == {
        "selection:2026-06-09:file-a": 1,
        "selection:2026-06-09:file-b": 1,
    }

```
