```python
"""The deferred fluent DAG builder: describes a pipeline; executes on ``.run()``.

A ``Pipeline`` composes a graph of readers, transformers, validators, and writers
without running anything. Execution happens only at the ``.run()`` terminus, which
topologically sorts the nodes and owns the cross-cutting concerns of timing,
logging, lineage, and error handling.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Callable

from framework.core.dataset import Dataset
from framework.core.protocols import Processor, Reader, Validator, Writer
from framework.core.validators import ValidationError
from framework.run.address import RunAddress
from framework.run.execution import PipelineExecution
from framework.run.run_context import RunContext, current_context
from tools.observability.run_log import NULL_RUN_LOG, RunLog

log = logging.getLogger(__name__)


class Node:
    """A single deferred operation in the DAG."""

    def __init__(
        self,
        name: str,
        node_type: str,
        inputs: list[Node] | None = None,
        address: RunAddress | None = None,
    ):
        self.name = name
        self.node_type = node_type
        self.inputs = inputs or []
        self.address = address
        self._result: Any = None
        self._executed: bool = False
        self.warn_hits: list[str] = []
        # A dry-run note this node contributes to the preview (e.g. the intent of
        # a skipped commit). Set by side-effecting nodes; None for plain steps.
        self.dry_run_note: str | None = None
        # Set by a side-effecting node once it has durably written an artifact;
        # surfaced on this node's run-log record so the log shows independently
        # committed evidence that outlives a later failure (ADR-0005).
        self.committed: bool = False

    def describe(self) -> str:
        deps = [n.name for n in self.inputs]
        dep_str = f" (depends on: {', '.join(deps)})" if deps else ""
        return f"[{self.node_type}] {self.name}{dep_str}"

    def execute(self, session: PipelineExecution, context: RunContext) -> Any:
        if self._executed:
            return self._result

        # Ensure inputs are executed first
        input_results = [node.execute(session, context) for node in self.inputs]

        started = time.perf_counter()
        try:
            self._result = self._do_execute(session, context, *input_results)
            self._executed = True

            rows_in = None
            if input_results:
                from framework.core.dataset import Dataset

                datasets_in = [r for r in input_results if isinstance(r, Dataset)]
                if datasets_in:
                    rows_in = sum(len(ds) for ds in datasets_in)

            rows_out = None
            if self._result is not None:
                from framework.core.dataset import Dataset

                if isinstance(self._result, Dataset):
                    rows_out = len(self._result)

            # Log success for this node
            session.record(
                self.name,
                "ok",
                duration=time.perf_counter() - started,
                warn_hits=self.warn_hits,
                rows_in=rows_in,
                rows_out=rows_out,
                committed=self.committed,
                step_address=self.address.label if self.address is not None else None,
            )
            if context.dry_run and context.dry_run_report is not None:
                context.dry_run_report.observe(
                    self.name,
                    self.node_type,
                    self._result,
                    note=self.dry_run_note,
                )
            return self._result
        except Exception as exc:
            # Log failure, tagged with its triage category (None for a raw bug).
            session.record(
                self.name,
                "error",
                duration=time.perf_counter() - started,
                errors=[str(exc)],
                error_category=getattr(exc, "category", None),
                step_address=self.address.label if self.address is not None else None,
            )
            # A dry run still surfaces the failing step so the preview shows the
            # shape so far and the clear reason it stopped (issue #102).
            if context.dry_run and context.dry_run_report is not None:
                context.dry_run_report.observe(
                    self.name, self.node_type, note=f"FAILED: {exc}"
                )
            raise

    def _do_execute(
        self, session: PipelineExecution, context: RunContext, *inputs: Any
    ) -> Any:
        raise NotImplementedError


class ReadNode(Node):
    def __init__(
        self,
        name: str,
        reader: Reader,
        inputs: list[Node] | None = None,
        address: RunAddress | None = None,
    ):
        super().__init__(name, "Read", inputs, address)
        self.reader = reader

    def _do_execute(
        self, session: PipelineExecution, context: RunContext, *deps: Any
    ) -> Dataset:
        try:
            dataset = self.reader.read()
        finally:
            if hasattr(self.reader, "retry_attempts"):
                self.warn_hits.extend(self.reader.retry_attempts)
                session.warn_hits.extend(self.reader.retry_attempts)
        if session.trace is not None and not getattr(
            session, "_trace_considered", False
        ):
            session.trace.consider(dataset)
            session._trace_considered = True
        return dataset


class TransformNode(Node):
    def __init__(
        self,
        name: str,
        func: Processor,
        inputs: list[Node],
        address: RunAddress | None = None,
    ):
        super().__init__(name, "Transform", inputs, address)
        self.func = func

    def _do_execute(
        self, session: PipelineExecution, context: RunContext, *datasets: Dataset
    ) -> Dataset:
        before = datasets[0] if datasets else None

        processor = getattr(self.func, "__self__", self.func)
        if processor is not None:
            session.materialize_dependencies([processor])

        after = self.func(*datasets)
        if session.trace is not None and before is not None:
            # Extract trace_role and trace_name from the processor if it's a method
            role = getattr(processor, "trace_role", None)
            name = getattr(
                processor,
                "trace_name",
                type(processor).__name__ if processor else self.name,
            )
            session.trace.observe(role, name, before, after)
        return after


class ValidateNode(Node):
    def __init__(
        self,
        name: str,
        validator: Validator,
        input_node: Node,
        severity: str = "error",
        address: RunAddress | None = None,
    ):
        super().__init__(name, "Validate", [input_node], address)
        self.validator = validator
        self.severity = severity

    def _do_execute(
        self, session: PipelineExecution, context: RunContext, dataset: Dataset
    ) -> Dataset:
        # The validator throws or returns an error message depending on the
        # protocol (assuming it returns an error string or raises
        # ValidationError - we will handle raised ValidationErrors).
        try:
            error = self.validator.validate(dataset)
            if error:
                if self.severity == "warn":
                    msg = f"{self.name}: {error}"
                    self.warn_hits.append(msg)
                    session.warn_hits.append(msg)
                else:
                    raise ValidationError(
                        f"{session.pipeline_name} {self.name} failed: {error}"
                    )
        except Exception as exc:
            if self.severity == "warn":
                msg = f"{self.name}: {str(exc)}"
                self.warn_hits.append(msg)
                session.warn_hits.append(msg)
            else:
                if isinstance(exc, ValidationError):
                    raise ValidationError(
                        f"{session.pipeline_name} {self.name} failed: {exc}"
                    ) from exc
                raise
        return dataset


class ExplainNode(Node):
    def __init__(
        self,
        name: str,
        writer: Writer,
        id_column: str,
        input_node: Node,
        score_column: str | None = None,
        address: RunAddress | None = None,
    ):
        super().__init__(name, "Explain", [input_node], address)
        self.writer = writer
        self.id_column = id_column
        self.score_column = score_column

    def _do_execute(
        self, session: PipelineExecution, context: RunContext, dataset: Dataset
    ) -> Dataset:
        if session.trace is not None:
            trace_ds = session.trace.finalize(dataset)
            if context.dry_run:
                # Dry-run: build the trace to report its shape, but commit nothing.
                self.dry_run_note = (
                    f"would write trace: {len(trace_ds)} row(s) "
                    f"({session.trace.selected} selected, "
                    f"{session.trace.excluded} excluded)"
                )
            else:
                self.writer.write(trace_ds)
                self.committed = True

            # The original architecture recorded these counts in the metrics
            # of the explain step
            session.record(
                self.name,
                "ok",
                rows_in=session.trace.considered,
                rows_out=session.trace.selected,
                rows_excluded=session.trace.excluded,
                committed=self.committed,
                step_address=self.address.label if self.address is not None else None,
            )
        return dataset


class QuarantineNode(Node):
    def __init__(
        self,
        name: str,
        validator: Any,
        writer: Writer,
        input_node: Node,
        address: RunAddress | None = None,
    ):
        super().__init__(name, "Quarantine", [input_node], address)
        self.validator = validator
        self.writer = writer

    def _do_execute(
        self, session: PipelineExecution, context: RunContext, dataset: Dataset
    ) -> Dataset:
        good, rejected = self.validator.partition(dataset)

        if context.dry_run:
            # Dry-run: report the quarantine count, but commit no rejects.
            self.dry_run_note = f"would quarantine {len(rejected)} row(s)"
            session.record(
                self.name,
                "ok",
                rows_in=len(dataset),
                rows_out=len(good),
                rows_quarantined=len(rejected),
                committed=False,
            )
            return good

        if len(rejected) > 0:
            frame = rejected.to_pandas()
            frame["run_id"] = context.logical_run_id
            frame["logical_run_id"] = context.logical_run_id
            frame["execution_id"] = context.execution_id
            frame["load_date"] = context.load_date
            enriched_rejected = Dataset.from_pandas(frame)
            self.writer.write(enriched_rejected)
            self.committed = True

        session.record(
            self.name,
            "ok",
            rows_in=len(dataset),
            rows_out=len(good),
            rows_quarantined=len(rejected),
            committed=self.committed,
            step_address=self.address.label if self.address is not None else None,
        )
        return good


class WriteNode(Node):
    def __init__(
        self,
        name: str,
        writer: Writer,
        input_node: Node,
        address: RunAddress | None = None,
    ):
        super().__init__(name, "Write", [input_node], address)
        self.writer = writer

    def _do_execute(
        self, session: PipelineExecution, context: RunContext, dataset: Dataset
    ) -> Dataset:
        if context.dry_run:
            # Dry-run: skip the commit, report intent only (issue #102).
            self.dry_run_note = f"would write {len(dataset)} row(s)"
            return dataset
        try:
            self.writer.write(dataset)
            self.committed = True
        finally:
            if hasattr(self.writer, "retry_attempts"):
                self.warn_hits.extend(self.writer.retry_attempts)
                session.warn_hits.extend(self.writer.retry_attempts)
        return dataset


class ActionNode(Node):
    def __init__(
        self,
        name: str,
        action: Callable,
        inputs: list[Node],
        address: RunAddress | None = None,
    ):
        super().__init__(name, "Action", inputs, address)
        self.action = action

    def _do_execute(
        self, session: PipelineExecution, context: RunContext, *deps: Any
    ) -> None:
        self.action()


class Pipeline:
    """A deferred DAG pipeline context."""

    def __init__(self, name: str, run_log: RunLog | None = None) -> None:
        self._name = name
        self._run_log = run_log or NULL_RUN_LOG
        self.run_id: str | None = None
        self._nodes: list[Node] = []

    def read(
        self, reader: Reader, *, name: str, depends_on: list[Node] | None = None
    ) -> Node:
        node = ReadNode(
            name, reader, inputs=depends_on, address=self._step_address(name)
        )
        self._nodes.append(node)
        return node

    def transform(self, func: Processor, *inputs: Node, name: str) -> Node:
        node = TransformNode(name, func, list(inputs), address=self._step_address(name))
        self._nodes.append(node)
        return node

    def task(self, name: str, func: Processor, *inputs: Node) -> Node:
        return self.transform(func, *inputs, name=name)

    def validate(
        self,
        validator: Validator,
        input_node: Node,
        *,
        name: str,
        severity: str = "error",
    ) -> Node:
        node = ValidateNode(
            name,
            validator,
            input_node,
            severity=severity,
            address=self._step_address(name),
        )
        self._nodes.append(node)
        return node

    def write(self, writer: Writer, input_node: Node, *, name: str) -> Node:
        node = WriteNode(
            writer=writer,
            name=name,
            input_node=input_node,
            address=self._step_address(name),
        )
        self._nodes.append(node)
        return node

    def action(self, func: Callable, *inputs: Node, name: str) -> Node:
        node = ActionNode(name, func, list(inputs), address=self._step_address(name))
        self._nodes.append(node)
        return node

    def explain(
        self,
        writer: Writer,
        input_node: Node,
        *,
        id_column: str,
        score_column: str | None = None,
        name: str = "explain",
    ) -> Node:
        self._explain_config = {"id_column": id_column, "score_column": score_column}
        node = ExplainNode(
            name,
            writer,
            id_column,
            input_node,
            score_column,
            address=self._step_address(name),
        )
        self._nodes.append(node)
        return node

    def quarantine(
        self, validator: Any, writer: Writer, input_node: Node, name: str = "quarantine"
    ) -> Node:
        node = QuarantineNode(
            name, validator, writer, input_node, address=self._step_address(name)
        )
        self._nodes.append(node)
        return node

    def describe(self) -> str:
        """Return a human-readable execution plan of the DAG."""
        lines = [f"Pipeline: {self._name}"]
        for node in self._nodes:
            lines.append(f"  {node.describe()}")
        return "\n".join(lines)

    def run(self, context: RunContext | None = None) -> Any:
        # Fall back to the ambient run context (set by a dry run, say) before
        # minting a fresh default, so an author's bare ``p.run()`` inherits it.
        context = (
            context
            or current_context()
            or RunContext(pipeline=self._name, run_log=self._run_log)
        )
        run_log = (
            context.run_log if context.run_log is not NULL_RUN_LOG else self._run_log
        )
        self.run_id = context.execution_id

        session = PipelineExecution(
            pipeline_name=self._name,
            context=context,
            run_log=run_log,
        )
        if getattr(self, "_explain_config", None):
            from framework.run.trace import RowTrace

            session.trace = RowTrace(
                self._explain_config["id_column"],
                score_column=self._explain_config["score_column"],
            )

        started = time.perf_counter()
        try:
            # Execute leaf nodes (nodes that nothing else depends on).
            leaf_nodes = self._get_leaf_nodes()
            results = [node.execute(session, context) for node in leaf_nodes]

            # Compute total rows in/out for the summary if possible
            rows_in = None
            rows_out = None
            if self._nodes:
                from framework.core.dataset import Dataset

                read_nodes = [
                    n
                    for n in self._nodes
                    if isinstance(n, ReadNode) and n._result is not None
                ]
                if read_nodes:
                    rows_in = sum(
                        len(n._result)
                        for n in read_nodes
                        if isinstance(n._result, Dataset)
                    )

                # Assume the leaf nodes are the output nodes
                if results and isinstance(results[0], Dataset):
                    rows_out = sum(len(r) for r in results if isinstance(r, Dataset))

            session.record(
                "run",
                "ok",
                duration=time.perf_counter() - started,
                warn_hits=session.warn_hits,
                rows_in=rows_in,
                rows_out=rows_out,
                step_address=self._pipeline_address().label,
            )

            if len(results) == 1:
                return results[0]
            return results
        except Exception as exc:
            session.record(
                "run",
                "error",
                duration=time.perf_counter() - started,
                errors=[str(exc)],
                error_category=getattr(exc, "category", None),
                step_address=self._pipeline_address().label,
            )
            raise
        finally:
            context.mark_run_summary_recorded()

    def _step_address(self, step_name: str) -> RunAddress:
        subject, pipeline = self._address_parts()
        return RunAddress.step(pipeline, step_name, subject=subject)

    def _pipeline_address(self) -> RunAddress:
        subject, pipeline = self._address_parts()
        return RunAddress.pipeline(pipeline, subject=subject)

    def _address_parts(self) -> tuple[str | None, str]:
        if "/" not in self._name:
            return None, self._name
        subject, pipeline = self._name.split("/", 1)
        return subject, pipeline

    def _get_leaf_nodes(self) -> list[Node]:
        """Find nodes that no other node depends on to trigger execution."""
        all_deps = set()
        for node in self._nodes:
            all_deps.update(node.inputs)
        return [node for node in self._nodes if node not in all_deps]

```
