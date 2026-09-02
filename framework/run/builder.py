"""The deferred fluent DAG builder: describes a pipeline; executes on ``.run()``.

A ``Pipeline`` composes a graph of readers, transformers, validators, and writers
without running anything. Execution happens only at the ``.run()`` terminus, which
walks the graph from its leaves, executing each node after its inputs, and owns
the cross-cutting concerns of timing, logging, lineage, and error handling.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from framework.core.dataset import Dataset
from framework.core.errors import ErrorCategory, PipelineError
from framework.core.protocols import (
    DatasetProfiler,
    Processor,
    Reader,
    Validator,
    Writer,
)
from framework.core.validators import ValidationError
from framework.run.address import RunAddress
from framework.run.execution import PipelineExecution
from framework.run.run_context import RunContext, active_context, current_context
from tools.observability.run_log import NULL_RUN_LOG, RunLog

log = logging.getLogger(__name__)


class PipelineGraphError(PipelineError):
    """The wired graph cannot be executed — the fix is in the wiring, not the data."""

    category = ErrorCategory.CONFIG


@dataclass
class StepResult:
    """What a node produced and what it measured, handed back to the wrapper.

    A node never writes to the run log. It returns its dataset (``None`` for a
    node that produces none), any counts only it could know — ``rows_quarantined``,
    ``rows_excluded``, a profile payload — and whether it durably committed an
    artifact. ``Node.execute`` turns that into exactly one record, so a new node
    type gets correct recording without writing any, and cannot record twice.

    ``metrics`` keys are run-log record field names. They override the generic
    row counts the wrapper derives, which is how a step whose meaningful
    ``rows_in``/``rows_out`` are not simply its input and output sizes states its
    own. An unknown key is a ``TypeError`` from the run log's explicit keyword
    contract rather than a field that silently never lands.
    """

    dataset: Dataset | None = None
    metrics: dict[str, Any] = field(default_factory=dict)
    committed: bool = False


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

    def describe(self) -> str:
        deps = [n.name for n in self.inputs]
        dep_str = f" (depends on: {', '.join(deps)})" if deps else ""
        return f"[{self.node_type}] {self.name}{dep_str}"

    def execute(self, session: PipelineExecution, context: RunContext) -> Any:
        if self._executed:
            return self._result

        input_results = [node.execute(session, context) for node in self.inputs]

        started = time.perf_counter()
        try:
            step = self._do_execute(session, context, *input_results)
            self._result = step.dataset
            self._executed = True

            rows_in = None
            if input_results:
                datasets_in = [r for r in input_results if isinstance(r, Dataset)]
                if datasets_in:
                    rows_in = sum(len(ds) for ds in datasets_in)

            rows_out = None
            if isinstance(self._result, Dataset):
                rows_out = len(self._result)

            # The one place a step is recorded. The wrapper owns what it can see
            # for every node — the timing, the warn hits, the row counts either
            # side, the stable address — and the node's own metrics are layered
            # over the top, so a node reports numbers instead of logging them.
            measured = {
                "rows_in": rows_in,
                "rows_out": rows_out,
                **step.metrics,
            }
            session.record(
                self.name,
                "ok",
                duration=time.perf_counter() - started,
                warn_hits=self.warn_hits,
                committed=step.committed,
                step_address=self.address.label if self.address is not None else None,
                **measured,
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
            # shape so far and the clear reason it stopped.
            if context.dry_run and context.dry_run_report is not None:
                context.dry_run_report.observe(
                    self.name, self.node_type, note=f"FAILED: {exc}"
                )
            raise

    def _do_execute(
        self, session: PipelineExecution, context: RunContext, *inputs: Any
    ) -> StepResult:
        """Do the node's work and return what it produced and measured.

        Never records: :meth:`execute` writes the single record from what this
        returns.
        """
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
    ) -> StepResult:
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
        return StepResult(dataset, _location_metrics(self.reader))


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
    ) -> StepResult:
        before = datasets[0] if datasets else None

        processor = getattr(self.func, "__self__", self.func)
        if processor is not None:
            session.materialize_dependencies([processor])

        after = self.func(*datasets)
        if session.trace is not None and before is not None:
            # Preserve optional processor trace metadata.
            role = getattr(processor, "trace_role", None)
            name = getattr(
                processor,
                "trace_name",
                type(processor).__name__ if processor else self.name,
            )
            session.trace.observe(role, name, before, after)
        return StepResult(after)


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
    ) -> StepResult:
        # A validator's contract is raise-or-nothing: a breach it is designed to
        # detect arrives as a ValidationError, and that is the only failure a
        # warn severity may downgrade. Anything else — a typo'd column name, a
        # half-finished validator, a source that won't open — is a bug or an
        # environment fault, and propagates with its traceback so the run never
        # reports success for a check that did not actually happen.
        try:
            self.validator.validate(dataset)
        except ValidationError as exc:
            if self.severity == "warn":
                msg = f"{self.name}: {exc}"
                self.warn_hits.append(msg)
                session.warn_hits.append(msg)
            else:
                raise ValidationError(
                    f"{session.pipeline_name} {self.name} failed: {exc}"
                ) from exc
        return StepResult(dataset)


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
    ) -> StepResult:
        if session.trace is None:
            # Nothing traced this run, so there is no verdict to write.
            return StepResult(dataset)

        trace_ds = session.trace.finalize(dataset)
        committed = False
        if context.dry_run:
            # Dry-run: build the trace to report its shape, but commit nothing.
            self.dry_run_note = (
                f"would write trace: {len(trace_ds)} row(s) "
                f"({session.trace.selected} selected, "
                f"{session.trace.excluded} excluded)"
            )
        else:
            self.writer.write(trace_ds)
            committed = True

        # The governance counts are the trace's, not this node's inputs and
        # outputs: how many Cases were considered, how many survived, how many a
        # gate excluded. They stand in for the generic row counts.
        return StepResult(
            dataset,
            {
                "rows_in": session.trace.considered,
                "rows_out": session.trace.selected,
                "rows_excluded": session.trace.excluded,
            },
            committed=committed,
        )


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
    ) -> StepResult:
        good, rejected = self.validator.partition(dataset)
        measured = {"rows_quarantined": len(rejected)}

        if context.dry_run:
            # Dry-run: report the quarantine count, but commit no rejects.
            self.dry_run_note = f"would quarantine {len(rejected)} row(s)"
            return StepResult(good, measured)

        committed = False
        if len(rejected) > 0:
            # The pipeline supplies logical_run_id and load_date; QuarantineWriter
            # supplies the reserved provenance column.
            frame = rejected.to_pandas()
            frame["logical_run_id"] = context.logical_run_id
            frame["load_date"] = context.load_date
            enriched_rejected = Dataset.from_pandas(frame)
            self.writer.write(enriched_rejected)
            committed = True

        return StepResult(good, measured, committed=committed)


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
    ) -> StepResult:
        if context.dry_run:
            # Dry-run: skip the commit, report intent only.
            self.dry_run_note = f"would write {len(dataset)} row(s)"
            return StepResult(dataset)
        try:
            self.writer.write(dataset)
        finally:
            if hasattr(self.writer, "retry_attempts"):
                self.warn_hits.extend(self.writer.retry_attempts)
                session.warn_hits.extend(self.writer.retry_attempts)
        return StepResult(dataset, _location_metrics(self.writer), committed=True)


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
    ) -> StepResult:
        if context.dry_run:
            # An action exists only for its side effect, and the framework cannot
            # see what that effect touches — a mail, a remote job, a file. So a
            # preview cannot let it fire and still promise it commits nothing;
            # like every other side-effecting node it reports its intent instead.
            # A lambda or a callable object has no useful ``__name__``, so fall
            # back to something an operator can still read.
            label = getattr(self.action, "__name__", None) or repr(self.action)
            self.dry_run_note = f"would run action {label}"
            return StepResult()
        self.action()
        return StepResult()


class ProfileNode(Node):
    """Drive an injected profiler, record its payload, pass the dataset through.

    A read-only *Task*: it hands the dataset to a
    :class:`~framework.core.protocols.DatasetProfiler` (the application's
    statistical computation, injected like a ``RunLog``), attaches the structured
    payload that profiler returns to this node's run-log record (so the registry
    can trend it across runs), surfaces any warn-severity messages it returns, and
    returns the dataset **unchanged** — it observes, never reshapes. A
    fail-severity breach is the profiler's own ``raise`` and simply propagates;
    the framework never names the metrics or the failure type.
    """

    def __init__(
        self,
        name: str,
        profiler: DatasetProfiler,
        input_node: Node,
        *,
        address: RunAddress | None = None,
    ):
        super().__init__(name, "Profile", [input_node], address)
        self.profiler = profiler

    def _do_execute(
        self, session: PipelineExecution, context: RunContext, dataset: Dataset
    ) -> StepResult:
        payload, warnings = self.profiler.profile(dataset)
        for message in warnings:
            located = f"{self.name}: {message}"
            self.warn_hits.append(located)
            session.warn_hits.append(located)
        return StepResult(dataset, {"profile": payload})


def _location_metrics(component: object) -> dict[str, Any]:
    """What this component reported touching, as a metric — or nothing at all.

    Copied, so a later read on the same component cannot mutate a record that
    has already been folded.
    """
    locations = getattr(component, "data_locations", None)
    return {"data_locations": list(locations)} if locations else {}


class Pipeline:
    """A deferred DAG pipeline context."""

    def __init__(self, name: str, run_log: RunLog | None = None) -> None:
        self._name = name
        self._run_log = run_log or NULL_RUN_LOG
        self.pipeline_run_id: str | None = None
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

    def profile(
        self,
        profiler: DatasetProfiler,
        input_node: Node,
        *,
        name: str = "profile",
    ) -> Node:
        """Wire a read-only profiling Task over ``input_node``.

        ``profiler`` is an injected
        :class:`~framework.core.protocols.DatasetProfiler` — the application's
        statistical computation (``tools.observability.profile.DataProfiler`` in
        practice, which bounds cost via ``top_n`` / a column allow-list and opts
        into run-over-run drift detection). The node records the profiler's payload
        on the run log and passes the dataset through unchanged; the framework owns
        none of the metrics. Mirrors how ``explain`` / ``write`` take an injected
        component rather than embedding the logic.
        """
        node = ProfileNode(
            name,
            profiler,
            input_node,
            address=self._step_address(name),
        )
        self._nodes.append(node)
        return node

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
        # An explicit context wins. Otherwise inherit the ambient run context —
        # set by the runner around a handler, or by a dry run — as a child, so a
        # bare ``p.run()`` records under the attempt's shared ``pipeline_run_id``
        # (and stamps the rows it writes with it) instead of minting a fresh id
        # that would orphan this pipeline's records. With no ambient context at all
        # (an author running a lone pipeline) mint a fresh default.
        if context is None:
            ambient = current_context()
            context = (
                ambient.for_nested_pipeline(self._name)
                if ambient is not None
                else RunContext(pipeline=self._name, run_log=self._run_log)
            )
        run_log = (
            context.run_log if context.run_log is not NULL_RUN_LOG else self._run_log
        )
        self.pipeline_run_id = context.pipeline_run_id

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
            if self._nodes and not leaf_nodes:
                # Every node is some other node's input, so the walk has nowhere
                # to start: without this guard the run would execute nothing at
                # all and still report success.
                raise PipelineGraphError(
                    f"pipeline {self._name!r} graph has a cycle: every node is an "
                    "input to another node, so there is no node to execute from"
                )
            results = self._execute(session, context, leaf_nodes)

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

    def _execute(
        self, session: PipelineExecution, context: RunContext, leaf_nodes: list[Node]
    ) -> list[Any]:
        """Drive the graph once.

        The context this run resolved to is made **ambient** for the duration of
        the walk. The runner already does that around a handler, but a pipeline
        run with an *explicit* context — a script, a test, a stage invoked
        directly — would otherwise execute with no ambient context at all, and a
        component that reads one (a Writer stamping the run that wrote the row)
        would silently see nothing. One rule instead: while a pipeline is
        executing, its context is the ambient one.
        """
        with active_context(context):
            return [node.execute(session, context) for node in leaf_nodes]

    def _step_address(self, step_name: str) -> RunAddress:
        subject, pipeline = self._address_parts()
        return RunAddress.for_step(pipeline, step_name, subject=subject)

    def _pipeline_address(self) -> RunAddress:
        subject, pipeline = self._address_parts()
        return RunAddress.for_pipeline(pipeline, subject=subject)

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
