"""Validators — fail-fast checks over a ``DataHandle`` at a layer boundary.

A ``Validator`` states an expectation about a feed's data and raises
``ValidationError`` when the data breaks it. Validators are attached to the
builder as **pre** (input) or **post** (output) checks; the builder owns the
*severity* of each attachment (``error`` aborts the run, ``warn`` logs and
continues — ADR-0007) and the run ordering, so a Validator itself only knows
how to check, not what to do about a failure.

Checks read the handle's public shape (``columns`` / ``len``) and never name the
concrete engine, so they stay behind the DataHandle seam (ADR-0002). Schema /
dtype enforcement at silver & gold (ADR-0008) is a later, richer Validator of
the same shape.
"""

from __future__ import annotations

from typing import Iterable, Literal, Protocol, runtime_checkable

from framework.data_handle import DataHandle

# Severity is set where a Validator is *attached* to the builder, not on the
# Validator itself (ADR-0007: validators default to error/abort; warn is the
# explicit, deliberate escape hatch).
Severity = Literal["error", "warn"]


class ValidationError(Exception):
    """Raised by a Validator when the data fails its check."""


@runtime_checkable
class Validator(Protocol):
    """A fail-fast expectation about one feed's data."""

    def validate(self, handle: DataHandle) -> None:
        """Raise :class:`ValidationError` if ``handle`` breaks the expectation."""
        ...


class ColumnValidator:
    """Assert the handle carries every required column (presence, not dtype)."""

    def __init__(self, required_columns: Iterable[str]) -> None:
        self._required = tuple(required_columns)

    def validate(self, handle: DataHandle) -> None:
        present = set(handle.columns)
        missing = [c for c in self._required if c not in present]
        if missing:
            raise ValidationError(
                f"missing required column(s): {', '.join(missing)}"
            )


class RowCountValidator:
    """Assert the handle's row count sits within an inclusive ``[min, max]``.

    Either bound is optional: ``minimum`` guards against a truncated/empty feed,
    ``maximum`` against an unexpectedly large one. ``None`` leaves that side open.
    """

    def __init__(
        self, minimum: int | None = None, maximum: int | None = None
    ) -> None:
        self._minimum = minimum
        self._maximum = maximum

    def validate(self, handle: DataHandle) -> None:
        rows = len(handle)
        if self._minimum is not None and rows < self._minimum:
            raise ValidationError(
                f"row count {rows} below minimum {self._minimum}"
            )
        if self._maximum is not None and rows > self._maximum:
            raise ValidationError(
                f"row count {rows} above maximum {self._maximum}"
            )
