"""Small framework protocols shared across the implementation.

These protocols are the dependency boundary between the public facades: ``io``
implements readers/writers, ``core`` implements validators, ``transform``
implements processors, and ``run`` composes them. Keeping the shapes here
prevents feature modules from importing sibling implementations only to name a
type.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Literal, Protocol, runtime_checkable

from framework.core.dataset import Dataset

Severity = Literal["error", "warn"]

# The reserved column every table-backed Writer stamps with the run that wrote
# the row — the row-level counterpart of the run record's ``data_locations``.
# Declared here, with the :class:`Writer` contract, because the stamp is a
# *Writer's* rule: the framework has no notion of raw/silver/gold, and a Writer
# knows only that it is writing. The value is read from the ambient run context,
# so no feed wires anything and no ``Store.writer(...)`` signature changes; it is
# never part of a load strategy's value comparison.
RUN_PROVENANCE_COLUMN = "pipeline_run_id"


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


@runtime_checkable
class DatasetProfiler(Protocol):
    """A read-only observer that profiles a feed's shape for the run log.

    The injected port behind ``Pipeline.profile``: given a dataset it returns the
    structured payload to record on the step (a JSON-serialisable ``dict``, or
    ``None``) and a list of warn-severity messages for the step's ``warn_hits``,
    and may *raise* to abort the run on a fail-severity breach. The concrete
    statistical computation lives in the application/observability layer
    (``tools.observability.profile.DataProfiler``); the framework only drives this
    port — it never names the engine or the metrics, exactly as it injects a
    ``RunLog`` rather than owning a log format.
    """

    def profile(self, dataset: Dataset) -> "tuple[dict | None, list[str]]":
        """Return ``(payload, warnings)`` for ``dataset``; raise to abort."""
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
