"""Execution state for one deferred ``Pipeline`` run."""

from __future__ import annotations

from functools import partial
from typing import Any

from framework.run.run_context import RunContext
from framework.run.trace import RowTrace
from tools.observability.run_log import RunLog

#: Record fields whose per-execution values add up across a folded step. Every
#: one is a count of rows or of seconds, so the sum of the parts is the figure
#: the step would have reported had it run once over the whole source.
_SUMMED_FIELDS = (
    "rows_in",
    "rows_out",
    "rows_quarantined",
    "rows_excluded",
    "duration",
)

#: List-valued record fields: merged, keeping first-seen order and dropping an
#: entry already present, so the same warn raised on every chunk reads once
#: rather than fifty times — and the one file every chunk came from likewise.
_CONCATENATED_FIELDS = ("errors", "warn_hits", "data_locations")


class _FoldedSteps:
    """Many executions of one step, collapsed into the one record it emits.

    A streamed source drives its sub-graph once per chunk, so each step below it
    executes many times. Emitting a record per execution would turn a fifty-chunk
    read into fifty records per step and make a run log unreadable — and it would
    break the rule that a step is recorded exactly once. So the records are folded
    here instead: counts add up, notes concatenate, a single failure makes the
    step a failure, and the step's identity (its address) is whatever it was
    every time.

    Insertion order is kept, so the flushed records come out in the order the
    steps first ran — the order they would have appeared in for a one-shot read.
    """

    def __init__(self) -> None:
        self._steps: dict[str, tuple[str, dict[str, Any]]] = {}

    def add(self, step: str, status: str, fields: dict[str, Any]) -> None:
        held = self._steps.get(step)
        if held is None:
            self._steps[step] = (status, dict(fields))
            return
        held_status, held_fields = held
        for key, value in fields.items():
            if key in _SUMMED_FIELDS:
                held_fields[key] = _add(held_fields.get(key), value)
            elif key in _CONCATENATED_FIELDS:
                held_fields[key] = _merge_unique(held_fields.get(key), value)
            elif key == "committed":
                held_fields[key] = bool(held_fields.get(key)) or bool(value)
            elif value is not None or key not in held_fields:
                # Everything else is a property of the step rather than a tally:
                # its address, its error category, the profile payload. The last
                # non-empty value stands, and an execution that has nothing to
                # say about it does not erase what an earlier one did.
                held_fields[key] = value
        # One failed chunk failed the step; a later chunk cannot succeed it back.
        self._steps[step] = (
            "error" if "error" in (held_status, status) else status,
            held_fields,
        )

    def flush(self) -> list[tuple[str, str, dict[str, Any]]]:
        """Take the folded steps as ``(step, status, fields)``, in first-run order."""
        folded = [
            (step, status, fields) for step, (status, fields) in self._steps.items()
        ]
        self._steps = {}
        return folded


def _add(held: Any, value: Any) -> Any:
    """Sum two tallies, treating "this execution had nothing to report" as zero.

    Two ``None``s stay ``None`` — the field genuinely does not apply to this step
    — but once any execution reports a number the total is a number, so a step
    that counted rows in some chunks and not others is not silently blanked.
    """
    if held is None and value is None:
        return None
    return (held or 0) + (value or 0)


def _merge_unique(held: Any, value: Any) -> list:
    merged = list(held or [])
    for entry in value or []:
        if entry not in merged:
            merged.append(entry)
    return merged


class PipelineExecution:
    """Mutable state for one ``Pipeline.run()`` execution."""

    def __init__(
        self,
        *,
        pipeline_name: str,
        context: RunContext,
        run_log: RunLog,
    ) -> None:
        self.pipeline_name = pipeline_name
        self.context = context
        self.run_log = run_log
        self.warn_hits: list[str] = []
        self.trace: RowTrace | None = None
        # Rows the graph's leaves produced across a streamed drive, which the run
        # summary reports instead of the size of whichever chunk was last.
        self.streamed_rows_out: int = 0
        self._fold: _FoldedSteps | None = None
        self.step = partial(
            run_log.step,
            context.pipeline_run_id,
            pipeline_name,
            logical_run_id=context.logical_run_id,
        )

    def record(self, step: str, status: str, **fields: Any) -> None:
        """Emit one run-log record for ``step`` — or fold it into the step's.

        The single sink every node's record goes through. Normally it writes
        straight out; while a streamed source is being driven it folds instead,
        so the step's many executions still produce the one record the run log
        promises per step.
        """
        if self._fold is not None:
            self._fold.add(step, status, fields)
            return
        self.run_log.record(
            self.context.pipeline_run_id,
            self.pipeline_name,
            step,
            status,
            logical_run_id=self.context.logical_run_id,
            **fields,
        )

    def begin_folding(self) -> None:
        """Hold each step's records back, to be summed rather than emitted."""
        self._fold = _FoldedSteps()

    def end_folding(self) -> None:
        """Stop folding and emit each step's summed record, in first-run order.

        Called however the drive ends, so a stream that aborts part-way still
        logs what every step managed before it stopped — including the failing
        step's own error record — rather than losing the run's whole account of
        itself to the exception.
        """
        fold, self._fold = self._fold, None
        if fold is None:
            return
        for step, status, fields in fold.flush():
            self.record(step, status, **fields)

    def materialize_dependencies(self, processors: list[object]) -> None:
        seen: set[int] = set()
        for processor in processors:
            dependencies = getattr(processor, "dependencies", [])
            for dependency in dependencies:
                read = getattr(dependency, "read", None)
                if not callable(read):
                    continue
                identity = id(dependency)
                if identity in seen or getattr(dependency, "materialized", False):
                    seen.add(identity)
                    continue
                seen.add(identity)
                name = getattr(dependency, "name", "dependency")
                with self.step(f"dependency:{name}") as metrics:
                    dataset = read()
                    metrics.rows_out = len(dataset)
