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
class Validator(Protocol):
    """A fail-fast expectation about one feed's data."""

    def validate(self, dataset: Dataset) -> None:
        """Raise if ``dataset`` breaks the expectation."""
        ...


DatasetSupplier = Callable[[], Dataset]

# The processor seam: a transform run mid-pipeline. The builder wires a processor
# to one or more upstream nodes (``Pipeline.transform(func, *inputs)``) and calls
# it with their datasets positionally (``func(*datasets)``), so a processor takes
# **one or more Datasets and returns exactly one** — a single-input reshape, or a
# fan-in (e.g. an in-DAG join) over several branches. ``Callable[..., Dataset]``
# captures the one fixed part of the contract (the single Dataset out); arity is
# per processor. (An *external* read-only side input that isn't a DAG node is
# pulled in via ``framework.transform.JoinDependency`` instead.)
#
# Defined here (not in ``framework.transform``) so ``framework.run`` can name the
# type without importing the transform implementation — the boundary this module
# exists to hold. ``framework.transform`` implements and re-exports it.
Processor = Callable[..., Dataset]
