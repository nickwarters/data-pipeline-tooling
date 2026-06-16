"""Small framework protocols shared across the implementation.

These protocols are the dependency boundary between the public task facades:
``io`` implements readers/writers, ``transform`` implements processors,
``validate`` implements validators, and ``run`` composes them. Keeping the
shapes here prevents feature modules from importing sibling implementations
only to name a type.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Literal, Protocol, runtime_checkable

from framework.core.dataset import Dataset

Severity = Literal["error", "warn"]


@runtime_checkable
class Reader(Protocol):
    """A source of one feed's data."""

    def read(self) -> Dataset:
        """Read the source and return its rows as a Dataset."""
        ...


@runtime_checkable
class Writer(Protocol):
    """A destination for one feed's data."""

    def write(self, dataset: Dataset) -> None:
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
