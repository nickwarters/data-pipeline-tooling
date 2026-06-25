```python
"""Dry-run preview: a per-step record of what a pipeline *would* do (issue #102).

A ``Pipeline.run()`` carried out under ``RunContext(dry_run=True)`` reads,
processes, and validates real data but commits nothing. As each node executes it
contributes a :class:`StepPreview` to the run context's :class:`DryRunReport`,
giving an author a local-development view of the pipeline's shape — columns,
dtypes, row counts, a bounded row sample, and the intent of any skipped
commit — without landing artifacts.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from framework.core.dataset import Dataset

# How many leading rows a step preview keeps. Bounded so a dry run summarises a
# dataset rather than dumping it.
SAMPLE_ROWS = 5
# How many of those rows the compact rendering shows, and the per-line width it
# truncates to — a preview, not a dump.
RENDER_SAMPLE_ROWS = 3
RENDER_LINE_WIDTH = 100


@dataclass(frozen=True)
class StepPreview:
    """The preview of one executed node in a dry run."""

    name: str
    node_type: str
    columns: list[str] = field(default_factory=list)
    dtypes: dict[str, str] = field(default_factory=dict)
    row_count: int | None = None
    sample: list[dict[str, object]] = field(default_factory=list)
    # A human-readable note: the intent of a skipped commit, a quarantine count,
    # or a reported validation failure.
    note: str | None = None


class DryRunReport:
    """An ordered collection of :class:`StepPreview` records for one dry run."""

    def __init__(self) -> None:
        self.steps: list[StepPreview] = []
        # Set when the previewed run stopped on a fail-fast error (e.g. an
        # error-severity validation failure). The preview still holds every
        # step up to the stop.
        self.error: Exception | None = None

    @property
    def failed(self) -> bool:
        """Whether the previewed run stopped on a fail-fast error."""
        return self.error is not None

    def mark_failed(self, error: Exception) -> None:
        """Record that the previewed run stopped on ``error``."""
        self.error = error

    def observe(
        self,
        name: str,
        node_type: str,
        result: object = None,
        *,
        note: str | None = None,
    ) -> StepPreview:
        """Record a step's preview, deriving shape from a ``Dataset`` result."""
        if isinstance(result, Dataset):
            preview = StepPreview(
                name=name,
                node_type=node_type,
                columns=result.columns,
                dtypes=result.dtypes,
                row_count=len(result),
                sample=result.sample(SAMPLE_ROWS),
                note=note,
            )
        else:
            preview = StepPreview(name=name, node_type=node_type, note=note)
        self.steps.append(preview)
        return preview

    def step(self, name: str) -> StepPreview:
        """Return the (last) preview recorded for ``name``."""
        for preview in reversed(self.steps):
            if preview.name == name:
                return preview
        raise KeyError(name)

    def render(self) -> str:
        """A compact, human-readable rendering of the whole preview.

        One block per step: a header line with the row count, the columns with
        their dtypes, up to :data:`RENDER_SAMPLE_ROWS` truncated sample rows, and
        any note. Bounded on purpose — it summarises, it does not dump.
        """
        lines = ["dry run — no artifacts were written"]
        for step in self.steps:
            header = f"  [{step.node_type}] {step.name}"
            if step.row_count is not None:
                header += f": {step.row_count} rows"
            lines.append(header)
            if step.columns:
                cols = ", ".join(f"{c}:{step.dtypes.get(c, '?')}" for c in step.columns)
                lines.append(f"      columns: {_truncate(cols)}")
            for row in step.sample[:RENDER_SAMPLE_ROWS]:
                lines.append(f"      {_format_row(row)}")
            if step.note:
                lines.append(f"      {step.note}")
        if self.error is not None:
            lines.append(f"  stopped: {self.error}")
        return "\n".join(lines)


def _format_row(row: dict[str, object]) -> str:
    """A single, width-bounded ``key=value, ...`` line for one sample row."""
    parts = [f"{key}={_truncate(str(value), 30)}" for key, value in row.items()]
    return _truncate(", ".join(parts))


def _truncate(text: str, width: int = RENDER_LINE_WIDTH) -> str:
    return text if len(text) <= width else text[: width - 1] + "…"

```
