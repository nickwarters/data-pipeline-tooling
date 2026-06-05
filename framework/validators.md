```python
"""Validators — fail-fast checks over a ``Dataset`` at a layer boundary.

A ``Validator`` states an expectation about a feed's data and raises
``ValidationError`` when the data breaks it. Validators are attached to the
builder as **pre** (input) or **post** (output) checks; the builder owns the
*severity* of each attachment (``error`` aborts the run, ``warn`` logs and
continues — ADR-0007) and the run ordering, so a Validator itself only knows
how to check, not what to do about a failure.

Checks read the dataset's public shape (``columns`` / ``len``) and never name the
concrete engine, so they stay behind the Dataset seam (ADR-0002). Schema /
dtype enforcement at silver & gold (ADR-0008) is a later, richer Validator of
the same shape.
"""

from __future__ import annotations

import statistics
from typing import Iterable, Literal, Protocol, runtime_checkable

from framework.dataset import Dataset

# Severity is set where a Validator is *attached* to the builder, not on the
# Validator itself (ADR-0007: validators default to error/abort; warn is the
# explicit, deliberate escape hatch).
Severity = Literal["error", "warn"]


class ValidationError(Exception):
    """Raised by a Validator when the data fails its check."""


@runtime_checkable
class Validator(Protocol):
    """A fail-fast expectation about one feed's data."""

    def validate(self, dataset: Dataset) -> None:
        """Raise :class:`ValidationError` if ``dataset`` breaks the expectation."""
        ...


class ColumnValidator:
    """Assert the dataset carries every required column (presence, not dtype)."""

    def __init__(self, required_columns: Iterable[str]) -> None:
        self._required = tuple(required_columns)

    def validate(self, dataset: Dataset) -> None:
        present = set(dataset.columns)
        missing = [c for c in self._required if c not in present]
        if missing:
            raise ValidationError(
                f"missing required column(s): {', '.join(missing)}"
            )


class RowCountValidator:
    """Assert the dataset's row count sits within an inclusive ``[min, max]``.

    Either bound is optional: ``minimum`` guards against a truncated/empty feed,
    ``maximum`` against an unexpectedly large one. ``None`` leaves that side open.
    """

    def __init__(
        self, minimum: int | None = None, maximum: int | None = None
    ) -> None:
        self._minimum = minimum
        self._maximum = maximum

    def validate(self, dataset: Dataset) -> None:
        rows = len(dataset)
        if self._minimum is not None and rows < self._minimum:
            raise ValidationError(
                f"row count {rows} below minimum {self._minimum}"
            )
        if self._maximum is not None and rows > self._maximum:
            raise ValidationError(
                f"row count {rows} above maximum {self._maximum}"
            )


class RunHistory(Protocol):
    """The slice of the run registry a volume baseline needs (#52, #54).

    Anything that can answer "what did the recent runs of this feed read?" is a
    baseline source; ``RunRegistry`` is the production one. Stated as a Protocol
    so the band logic stays behind a narrow seam and is exercised in isolation.
    """

    def recent_row_counts(
        self, pipeline: str, limit: int = ..., step: str = ...
    ) -> list[int]:
        ...


class VolumeAnomalyValidator:
    """Trip when a run's row count deviates wildly from its recent history (#54).

    The truncated-export guardrail: per-row and value-level checks (#24) cannot
    see a half-written source export where every row is valid yet thousands are
    missing — only run-over-run **volume** can. This compares the dataset's row
    count against a baseline derived from the feed's recent runs (the median of
    their read volumes, robust to a single prior outlier) and raises when the
    count falls outside ``median × (1 ± tolerance)`` in *either* direction — a
    sudden collapse *or* a suspicious explosion.

    The baseline is sourced from run history (``RunHistory``), not a hand-set
    per-feed threshold (AC #3). An optional absolute ``floor`` is an independent,
    **always-on** guard that holds even before any history exists. With fewer
    than ``min_history`` prior successful runs the relative band is skipped so a
    feed's first nights don't trip spuriously (AC #4) — only the floor, if set,
    applies. Severity (warn vs abort) and recording the trip to the ``RunLog``
    are owned by the builder where this is attached, like any Validator
    (ADR-0007).
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

        # The absolute floor is always-on — independent of history, it guards a
        # feed's very first run (AC #3, AC #4).
        if self._floor is not None and rows < self._floor:
            raise ValidationError(
                f"row count {rows} below floor {self._floor}"
            )

        counts = self._history.recent_row_counts(
            self._pipeline, limit=self._lookback
        )
        # Insufficient history degrades gracefully: no relative baseline, no
        # spurious trip (AC #4). The floor above still applied.
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


class UniqueValidator:
    """Assert that a column (or column set) is unique across the dataset.

    Attached at the gold boundary it enforces the one-row-per-Case grain on
    ``case_id`` (ADR-0009), aborting the run before a duplicated-grain gold is
    written (fail-fast, ADR-0007).

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
                    str(row.iloc[0])
                    if len(self._columns) == 1
                    else str(tuple(row))
                ),
                axis=1,
            ).tolist()
            keys_str = ", ".join(dup_values)
            col_str = (
                self._columns[0]
                if len(self._columns) == 1
                else str(self._columns)
            )
            raise ValidationError(
                f"duplicate key(s) on {col_str!r}: {keys_str}"
            )

```
