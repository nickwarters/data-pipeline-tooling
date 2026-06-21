```python
"""Validators: fail-fast checks over a ``Dataset`` at a layer boundary.

A ``Validator`` states an expectation about a feed's data and raises
``ValidationError`` when the data breaks it. Validators are attached to the
builder as **pre** (input) or **post** (output) checks; the builder owns the
*severity* of each attachment (``error`` aborts the run, ``warn`` logs and
continues) and the run ordering, so a Validator itself only knows how to check,
not what to do about a failure.

Checks read the dataset's public shape (``columns`` / ``len``) and never name the
concrete engine, so they stay behind the Dataset seam. Some take an extra narrow
seam for a run-over-run comparison the in-flight dataset can't supply:
``VolumeAnomalyValidator`` reads a ``RunHistory`` baseline, and
``SchemaDriftValidator`` reads a ``PriorColumns`` source — the prior run's landed
columns — to warn on raw-boundary source drift. Schema/dtype enforcement at
silver and gold is a later, richer Validator of the same shape.
"""

from __future__ import annotations

import statistics
from typing import Iterable, Protocol

from framework._internal.describe import render
from framework.core.dataset import Dataset
from framework.core.errors import PipelineError


class ValidationError(PipelineError):
    """Raised by a Validator when the data fails its check."""


class ColumnValidator:
    """Assert the dataset carries every required column (presence, not dtype)."""

    def __init__(self, required_columns: Iterable[str]) -> None:
        self._required = tuple(required_columns)

    def validate(self, dataset: Dataset) -> None:
        present = set(dataset.columns)
        missing = [c for c in self._required if c not in present]
        if missing:
            raise ValidationError(f"missing required column(s): {', '.join(missing)}")

    def describe(self) -> str:
        return render(self, required_columns=list(self._required))


class RowCountValidator:
    """Assert the dataset's row count sits within an inclusive ``[min, max]``.

    Either bound is optional: ``minimum`` guards against a truncated/empty feed,
    ``maximum`` against an unexpectedly large one. ``None`` leaves that side open.
    """

    def __init__(self, minimum: int | None = None, maximum: int | None = None) -> None:
        self._minimum = minimum
        self._maximum = maximum

    def validate(self, dataset: Dataset) -> None:
        rows = len(dataset)
        if self._minimum is not None and rows < self._minimum:
            raise ValidationError(f"row count {rows} below minimum {self._minimum}")
        if self._maximum is not None and rows > self._maximum:
            raise ValidationError(f"row count {rows} above maximum {self._maximum}")

    def describe(self) -> str:
        return render(self, minimum=self._minimum, maximum=self._maximum)


class RunHistory(Protocol):
    """The slice of the run registry a volume baseline needs.

    Anything that can answer "what did the recent runs of this feed read?" is a
    baseline source; ``RunRegistry`` is the production one. Stated as a Protocol
    so the band logic stays behind a narrow seam and is exercised in isolation.
    """

    def recent_row_counts(
        self, pipeline: str, limit: int = ..., step: str = ...
    ) -> list[int]: ...


class VolumeAnomalyValidator:
    """Trip when a run's row count deviates wildly from its recent history.

    Per-row and value-level checks cannot see a half-written source export where
    every row is valid yet thousands are missing; only run-over-run **volume**
    can. This compares the dataset's row count against a baseline derived from
    the feed's recent runs (the median of their read volumes, robust to a single
    prior outlier) and raises when the count falls outside
    ``median × (1 ± tolerance)`` in either direction.

    The baseline is sourced from run history (``RunHistory``), not a hand-set
    per-feed threshold. An optional absolute ``floor`` is an independent,
    **always-on** guard that holds even before any history exists. With fewer
    than ``min_history`` prior successful runs the relative band is skipped so a
    feed's first nights don't trip spuriously; only the floor, if set,
    applies. Severity and recording the trip to the ``RunLog`` are owned by the
    builder where this is attached, like any Validator.
    """

    def __init__(
        self,
        history: RunHistory,
        pipeline: str,
        *,
        tolerance: float = 0.5,
        floor: int | None = None,
        min_history: int = 3,
        lookback: int = 10,
    ) -> None:
        self._history = history
        self._pipeline = pipeline
        self._tolerance = tolerance
        self._floor = floor
        self._min_history = min_history
        self._lookback = lookback

    def validate(self, dataset: Dataset) -> None:
        rows = len(dataset)

        # The absolute floor is always on, independent of history.
        if self._floor is not None and rows < self._floor:
            raise ValidationError(f"row count {rows} below floor {self._floor}")

        counts = self._history.recent_row_counts(self._pipeline, limit=self._lookback)
        # Insufficient history degrades gracefully: no relative baseline, no
        # spurious trip. The floor above still applied.
        if len(counts) < self._min_history:
            return

        baseline = statistics.median(counts)
        low = baseline * (1 - self._tolerance)
        high = baseline * (1 + self._tolerance)
        if rows < low or rows > high:
            raise ValidationError(
                f"row count {rows} deviates from recent baseline "
                f"{baseline:g} (tolerance ±{self._tolerance:g}; "
                f"expected {low:g}–{high:g} over last {len(counts)} runs)"
            )

    def describe(self) -> str:
        return render(
            self,
            pipeline=self._pipeline,
            tolerance=self._tolerance,
            floor=self._floor,
            min_history=self._min_history,
            lookback=self._lookback,
        )


class PriorColumns(Protocol):
    """The slice of the raw layer a drift check needs: last landing's columns.

    Anything that can answer "what columns did the prior run land for this
    table, and what is the table called?" is a prior-columns source;
    ``Store.columns_of`` is the production one (a ``PRAGMA`` over the live raw
    table). Stated as a Protocol so the drift diff stays behind a narrow seam
    and is exercised in isolation (mirrors ``RunHistory``).
    """

    label: str

    def columns(self) -> tuple[str, ...] | None:
        """The prior run's landed columns, or ``None`` if there is no prior."""
        ...


class SchemaDriftValidator:
    """Warn when a feed's incoming columns drift from the prior run's.

    Raw is schema-light: an owner-controlled source can silently add or drop a
    column between snapshots, and that may only surface a layer later as a silver
    schema breach. This catches it at the door by diffing the incoming
    :class:`Dataset`'s columns against the prior run's landed columns and raising
    with the added/dropped columns named.

    The diff is **names-only** (a dtype change on a surviving column stays a
    silver concern) and a **case-sensitive set** difference (order is
    not drift; an upstream rename surfaces honestly as one drop + one add). The
    first-ever run has no prior (``columns()`` returns ``None``) and is a clean
    no-op. Severity is the builder's call like any Validator.
    """

    def __init__(self, prior: PriorColumns) -> None:
        self._prior = prior

    def validate(self, dataset: Dataset) -> None:
        prior = self._prior.columns()
        if prior is None:
            return  # first-ever run: no baseline to drift from
        incoming = set(dataset.columns)
        baseline = set(prior)
        added = [c for c in dataset.columns if c not in baseline]
        dropped = [c for c in prior if c not in incoming]
        if not added and not dropped:
            return
        parts = []
        if added:
            parts.append(f"added [{', '.join(added)}]")
        if dropped:
            parts.append(f"dropped [{', '.join(dropped)}]")
        raise ValidationError(
            f"schema drift in {self._prior.label} vs prior run: " + "; ".join(parts)
        )

    def describe(self) -> str:
        return render(self, prior=self._prior.label)


class UniqueValidator:
    """Assert that a column (or column set) is unique across the dataset.

    Attached at the gold boundary it enforces the one-row-per-Case grain,
    aborting the run before duplicated-grain gold is written.

    ``columns`` may be a single column name (str) or a list of column names for
    a composite key.
    """

    def __init__(self, columns: str | Iterable[str]) -> None:
        if isinstance(columns, str):
            self._columns = [columns]
        else:
            self._columns = list(columns)

    def validate(self, dataset: Dataset) -> None:
        frame = dataset.to_pandas()
        mask = frame.duplicated(subset=self._columns, keep=False)
        duplicated = frame.loc[mask, self._columns].drop_duplicates()
        if not duplicated.empty:
            dup_values = duplicated.apply(
                lambda row: (
                    str(row.iloc[0]) if len(self._columns) == 1 else str(tuple(row))
                ),
                axis=1,
            ).tolist()
            keys_str = ", ".join(dup_values)
            col_str = (
                self._columns[0] if len(self._columns) == 1 else str(self._columns)
            )
            raise ValidationError(f"duplicate key(s) on {col_str!r}: {keys_str}")

    def describe(self) -> str:
        return render(self, columns=list(self._columns))

```
