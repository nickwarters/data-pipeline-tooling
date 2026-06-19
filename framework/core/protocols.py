"""Small framework protocols shared across the implementation.

These protocols are the dependency boundary between the public task facades:
``io`` implements readers/writers, ``transform`` implements processors,
``validate`` implements validators, and ``run`` composes them. Keeping the
shapes here prevents feature modules from importing sibling implementations
only to name a type.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable

from framework.core.dataset import Dataset

Severity = Literal["error", "warn"]


@dataclass(frozen=True)
class WriteOutcome:
    """The result of a single ``Writer.write()`` call.

    ``rows_written`` is the number of rows from the input dataset that were
    persisted. ``replaced`` is ``True`` when an accumulate writer detected prior
    rows for the same logical run id and replaced them (idempotent re-run), or
    ``False`` when this was a fresh insert with no prior rows for that run id.
    Non-accumulate writers (``Refresh``, ``Upsert``, ``StdoutWriter``, …) always
    return ``replaced=False``.
    """

    rows_written: int
    replaced: bool


@runtime_checkable
class Reader(Protocol):
    """A source of one feed's data."""

    def read(self) -> Dataset:
        """Read the source and return its rows as a Dataset."""
        ...


@runtime_checkable
class Writer(Protocol):
    """A destination for one feed's data."""

    def write(self, dataset: Dataset) -> WriteOutcome:
        """Persist the dataset to this Writer's target."""
        ...


@runtime_checkable
class Processor(Protocol):
    """An engine-confined transform of one feed's data, run mid-pipeline."""

    def process(self, dataset: Dataset) -> Dataset:
        """Return a transformed dataset; raise on a value it cannot transform."""
        ...


@runtime_checkable
class Validator(Protocol):
    """A fail-fast expectation about one feed's data."""

    def validate(self, dataset: Dataset) -> None:
        """Raise if ``dataset`` breaks the expectation."""
        ...


DatasetSupplier = Callable[[], Dataset]
