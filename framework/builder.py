"""The deferred fluent builder — describes a pipeline; executes on ``.run()``.

A ``Pipeline`` composes a feed's reader, its validators and processors, and its
destination Writer without running anything. Execution
happens only at the ``.run()`` terminus, which owns the cross-cutting concerns
— timing, logging, lineage, error handling — for every stage. The builder makes
**no** write decisions: it hands the read ``Dataset`` to the composed Writer,
which owns its own location and load strategy (ADR-0003, ADR-0006).
"""

from __future__ import annotations

import logging
import re
import time
from pathlib import Path

from framework.dataset import Dataset
from framework.pipeline_steps import (
    CheckpointStep,
    ExplainWriteStep,
    PipelineExecution,
    PipelineStep,
    ProcessorStep,
    QuarantineStep,
    ReadStep,
    TraceStartStep,
    ValidatorStep,
    WriteStep,
    ordered,
)
from framework.processors import Processor
from framework.readers import Reader
from framework.run_context import RunContext
from framework.run_log import NULL_RUN_LOG, RunLog
from framework.validators import Severity, Validator
from framework.writers import Writer

log = logging.getLogger(__name__)


class Pipeline:
    """A deferred pipeline for one feed: read, then hand off to a Writer."""

    def __init__(
        self, name: str, reader: Reader, run_log: RunLog | None = None
    ) -> None:
        # `name` labels the feed/pipeline (for lineage in later slices); it is
        # not a write decision — the Writer owns the target table. Nothing runs
        # at construction.
        self._name = name
        self._reader = reader
        self._writer: Writer | None = None
        # The run-log sink (ADR-0007); when none is composed, a null sink lets
        # `.run()` drive the same branch-free code path while emitting nothing.
        # `run_id` is the execution identity of the most recent `.run()` and
        # correlates every RunLog/RunRegistry record for that execution.
        self._run_log = run_log or NULL_RUN_LOG
        self.run_id: str | None = None
        # Validators are attached with their severity and run in attach order:
        # pre-validators gate the input, post-validators gate the output that is
        # about to be written.
        self._pre_validators: list[tuple[Validator, Severity]] = []
        self._post_validators: list[tuple[Validator, Severity]] = []
        # Stages are processors and checkpoints in attach order; they run
        # between pre- and post-validators. A "processor" stage transforms the
        # dataset; a "checkpoint" stage writes a snapshot and passes through.
        self._stages: list[tuple[str, Processor | Writer]] = []
        # Optional row-level quarantine (issue #50): value-rule-failing rows are
        # routed to the reject writer; good rows continue through the pipeline.
        self._quarantine_validator = None
        self._quarantine_writer: Writer | None = None
        # Optional row-level explainability: a per-row trace of why each
        # considered row survived or was excluded, routed to a caller-chosen table.
        self._explain_writer: Writer | None = None
        self._explain_id_column: str | None = None
        self._explain_score_column: str | None = None

    def with_validator(
        self, validator: Validator, severity: Severity = "error"
    ) -> "Pipeline":
        """Attach a pre-validator (checks the input). Deferred — nothing runs."""
        self._pre_validators.append((validator, severity))
        return self

    def with_post_validator(
        self, validator: Validator, severity: Severity = "error"
    ) -> "Pipeline":
        """Attach a post-validator (checks the output). Deferred."""
        self._post_validators.append((validator, severity))
        return self

    def with_processor(self, processor: Processor) -> "Pipeline":
        """Attach a processor (transforms the dataset mid-run). Deferred."""
        self._stages.append(("processor", processor))
        return self

    def quarantine(self, row_validator, reject_writer: Writer) -> "Pipeline":
        """Configure opt-in row-level quarantine. Deferred — nothing runs until .run().

        After pre-validation, value-rule-failing rows are routed to
        ``reject_writer`` with the current context's run metadata; good rows
        continue through the pipeline. Structural breaches (missing columns,
        wrong dtypes) still abort via the pre-validators — quarantine is only
        for value-rule breaches (ADR-0007 §2).
        """
        self._quarantine_validator = row_validator
        self._quarantine_writer = reject_writer
        return self

    def explain(
        self,
        writer: Writer,
        *,
        id_column: str,
        score_column: str | None = None,
    ) -> "Pipeline":
        """Configure row-level explainability. Deferred — nothing runs until .run().

        When configured, ``.run()`` follows each considered row (identified by
        ``id_column``) across the processor stages and writes a per-row verdict
        to ``writer``. Application code gives the trace its domain meaning by
        choosing the writer, table name, id column, and processor labels.
        """
        self._explain_writer = writer
        self._explain_id_column = id_column
        self._explain_score_column = score_column
        return self

    def checkpoint(self, writer: Writer) -> "Pipeline":
        """Attach a mid-run lineage write. Deferred — nothing runs until .run().

        The writer receives the current dataset at this point in the stage
        sequence and the dataset passes through unchanged so the pipeline
        continues. A checkpoint failure aborts the run (ADR-0007 fail-fast).
        """
        self._stages.append(("checkpoint", writer))
        return self

    def write_to(self, writer: Writer) -> "Pipeline":
        """Compose in the destination Writer. Deferred — nothing runs yet."""
        self._writer = writer
        return self

    def describe(self) -> str:
        """Return a human-readable plan of the deferred run.

        The plan is an authoring/debugging aid: it reports the components that
        will participate in execution, in execution order, without touching the
        Reader, processors, checkpoints, or Writer. Configuration values are
        best-effort and scrubbed so obvious credentials do not leak into logs or
        test output.
        """
        plan = self._execution_plan()
        lines = [f"Pipeline {self._name}"]
        reader = _first_step(plan, "read")
        lines.append(f"  reader: {_describe_component(reader.component)}")
        pre = _first_named_step(plan, "pre-validate")
        lines.extend(_describe_validators("pre-validators", pre.validators))

        lines.append("  stages:")
        stages = [step for step in plan if step.kind in {"processor", "checkpoint"}]
        if stages:
            for step in stages:
                kind = "processor" if step.kind == "processor" else "checkpoint"
                lines.append(f"    - {kind}: {_describe_component(step.component)}")
        else:
            lines.append("    - none")

        post = _first_named_step(plan, "post-validate")
        lines.extend(_describe_validators("post-validators", post.validators))

        quarantine = _first_step(plan, "quarantine", required=False)
        if quarantine is None:
            lines.append("  quarantine: none")
        else:
            lines.append(
                "  quarantine: "
                f"{_describe_component(quarantine.component)} -> "
                f"{_describe_component(quarantine.reject_writer)}"
            )

        explain = _first_step(plan, "explain", required=False)
        trace = _first_step(plan, "trace", required=False)
        if explain is None:
            lines.append("  explain: none")
        else:
            parts = [f"writer={_describe_component(explain.component)}"]
            parts.append(f"id_column={trace.id_column!r}")
            if trace.score_column is not None:
                parts.append(f"score_column={trace.score_column!r}")
            lines.append(f"  explain: {', '.join(parts)}")

        write = _first_step(plan, "write", required=False)
        writer = _describe_component(write.component) if write is not None else "none"
        lines.append(f"  writer: {writer}")
        lines.append(f"  run-log: {_describe_run_log(self._run_log)}")
        return "\n".join(lines)

    def _execution_plan(self) -> list[PipelineStep]:
        """Build the ordered internal step plan used by ``describe`` and ``run``."""
        steps: list[PipelineStep] = [
            ReadStep(self._reader),
            ValidatorStep(name="pre-validate", validators=self._pre_validators),
        ]
        if self._quarantine_validator is not None:
            steps.append(
                QuarantineStep(self._quarantine_validator, self._quarantine_writer)
            )
        if self._explain_writer is not None:
            steps.append(
                TraceStartStep(
                    id_column=self._explain_id_column,
                    score_column=self._explain_score_column,
                )
            )

        checkpoint_idx = 0
        for kind, component in self._stages:
            if kind == "processor":
                steps.append(ProcessorStep(component))
            else:
                steps.append(
                    CheckpointStep(
                        name=f"checkpoint:{checkpoint_idx}",
                        writer=component,
                    )
                )
                checkpoint_idx += 1

        steps.append(
            ValidatorStep(name="post-validate", validators=self._post_validators)
        )
        if self._explain_writer is not None:
            steps.append(ExplainWriteStep(self._explain_writer))
        if self._writer is not None:
            steps.append(WriteStep(self._writer))
        return ordered(steps)

    def run(self, context: RunContext | None = None) -> Dataset:
        """Execute: read, validate, hand the dataset to the Writer, return it.

        Fail-fast and atomic (ADR-0007): an error-severity validator aborts the
        run *before* the Writer is called, so nothing partial lands; a
        warn-severity failure logs and continues. The write itself is a single
        SQLite transaction owned by the Writer. Returns the bulk-tier
        ``Dataset`` (ADR-0003).

        ``.run()`` is also the home of cross-cutting observability: it uses the
        supplied :class:`RunContext` or creates one for ad hoc builder execution.
        The context's execution id is exposed as :attr:`run_id` and drives the
        composed :class:`RunLog` per step plus a final ``run`` summary, so every
        record of this execution correlates and an abort is still recorded before
        it raises.
        """
        context = context or RunContext(pipeline=self._name, run_log=self._run_log)
        run_log = (
            context.run_log
            if context.run_log is not NULL_RUN_LOG
            else self._run_log
        )
        self.run_id = context.execution_id
        session = PipelineExecution(
            pipeline_name=self._name,
            context=context,
            run_log=run_log,
        )
        started = time.perf_counter()
        dataset: Dataset | None = None
        try:
            for plan_step in self._execution_plan():
                dataset = plan_step.execute(dataset, session)
        except Exception as exc:
            # Fail-fast (ADR-0007): the failing step already logged its own
            # `error` record; the run summary closes the run as aborted before
            # the exception propagates to the caller.
            session.record(
                "run",
                "error",
                duration=time.perf_counter() - started,
                errors=[str(exc)],
            )
            context.mark_run_summary_recorded()
            raise

        assert dataset is not None
        session.record(
            "run",
            "ok",
            rows_in=len(dataset),
            rows_out=len(dataset),
            duration=time.perf_counter() - started,
            warn_hits=session.warn_hits,
        )
        context.mark_run_summary_recorded()
        return dataset


def _describe_validators(
    label: str, validators: list[tuple[Validator, Severity]]
) -> list[str]:
    lines = [f"  {label}:"]
    if not validators:
        lines.append("    - none")
        return lines
    for validator, severity in validators:
        lines.append(f"    - {_describe_component(validator)} severity={severity}")
    return lines


def _first_step(
    plan: list[PipelineStep], kind: str, *, required: bool = True
) -> PipelineStep | None:
    for step in plan:
        if step.kind == kind:
            return step
    if required:
        raise ValueError(f"execution plan has no {kind!r} step")
    return None


def _first_named_step(plan: list[PipelineStep], name: str) -> PipelineStep:
    for step in plan:
        if step.name == name:
            return step
    raise ValueError(f"execution plan has no {name!r} step")


def _describe_run_log(run_log: RunLog) -> str:
    if run_log is NULL_RUN_LOG:
        return "none"
    return _describe_component(run_log)


def _describe_component(component: object) -> str:
    if component is None:
        return "none"
    describer = getattr(component, "describe", None)
    if callable(describer):
        description = str(describer())
        return _scrub(description)

    attrs = _safe_attrs(component)
    if not attrs:
        return type(component).__name__
    rendered = ", ".join(f"{key}={value}" for key, value in attrs)
    return f"{type(component).__name__}({rendered})"


def _safe_attrs(component: object) -> list[tuple[str, str]]:
    attrs = getattr(component, "__dict__", {})
    safe: list[tuple[str, str]] = []
    for raw_name, value in attrs.items():
        name = raw_name.removeprefix("_")
        if name.endswith("count") or name in {"dataset", "written"}:
            continue
        safe_value = _safe_value(name, value)
        if safe_value is None:
            continue
        safe.append((_display_name(name), safe_value))
    return safe


def _display_name(name: str) -> str:
    return {
        "db_path": "db_path",
        "path": "path",
        "required": "required_columns",
    }.get(name, name)


def _safe_value(name: str, value: object) -> str | None:
    if _looks_sensitive(name):
        return "'<redacted>'"
    if isinstance(value, Path):
        return repr(_scrub(str(value)))
    if isinstance(value, str):
        return repr(_scrub(value))
    if isinstance(value, (int, float, bool)) or value is None:
        return repr(value)
    if isinstance(value, tuple):
        values = [_safe_value(name, item) for item in value]
        if any(item is None for item in values):
            return None
        return "[" + ", ".join(values) + "]"
    if isinstance(value, list):
        values = [_safe_value(name, item) for item in value]
        if any(item is None for item in values):
            return None
        return "[" + ", ".join(values) + "]"
    if isinstance(value, dict):
        parts = []
        for key, item in value.items():
            key_text = str(key)
            if _looks_sensitive(key_text):
                parts.append(f"{key_text!r}: '<redacted>'")
                continue
            item_text = _safe_value(key_text, item)
            if item_text is None:
                return None
            parts.append(f"{key_text!r}: {item_text}")
        return "{" + ", ".join(parts) + "}"
    return None


def _looks_sensitive(name: str) -> bool:
    lowered = name.lower()
    return any(
        marker in lowered
        for marker in (
            "auth",
            "credential",
            "password",
            "secret",
            "token",
            "api_key",
            "apikey",
        )
    )


def _scrub(text: str) -> str:
    scrubbed = re.sub(r"(://)[^/@:\s]+:[^/@\s]+@", r"\1<redacted>@", text)
    scrubbed = re.sub(
        r"(?i)(password|secret|token|api_key|apikey)=([^&\s]+)",
        r"\1=<redacted>",
        scrubbed,
    )
    return scrubbed
