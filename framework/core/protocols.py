"""Small framework protocols shared across the implementation.

These protocols are the dependency boundary between the public task facades:
``io`` implements readers/writers, ``transform`` implements processors,
``validate`` implements validators, and ``run`` composes them. Keeping the
shapes here prevents feature modules from importing sibling implementations
only to name a type.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager
from typing import Literal, Protocol, runtime_checkable

from framework.core.dataset import Dataset

Severity = Literal["error", "warn"]

# The default chunk size for a streaming :class:`ChunkReader` — a sensible bound
# for a feed-shaped row, big enough to amortise per-chunk overhead yet small
# enough that hundreds of them never approach the memory a whole source would.
# Defined here with the contract so both the protocol default and every concrete
# reader share one source of truth (``framework.io`` re-exports it).
DEFAULT_CHUNK_SIZE = 10_000


@runtime_checkable
class Reader(Protocol):
    """A source of one feed's data."""

    def read(self) -> Dataset:
        """Read the source and return its rows as a Dataset."""
        ...


@runtime_checkable
class ChunkReader(Protocol):
    """A source read as a *sequence of bounded Datasets* (streaming).

    The streaming dual of :class:`Reader`: where ``read() -> Dataset`` lands a
    whole source in memory at once, ``chunks(size)`` yields a lazy iterator of
    bounded :class:`Dataset`s so a source far too large to materialise (hundreds
    of GB) can be processed with bounded memory. The in-memory ``Dataset``
    contract holds *per chunk*, never for the whole source; the
    concrete chunking engine (pandas ``chunksize``) stays behind the seam and
    never appears in this signature.
    """

    def chunks(self, size: int = DEFAULT_CHUNK_SIZE) -> Iterator[Dataset]:
        """Yield the source as bounded Datasets of at most ``size`` rows each."""
        ...


@runtime_checkable
class Writer(Protocol):
    """A destination for one feed's data."""

    def write(self, dataset: Dataset) -> None:
        """Persist the dataset to this Writer's target."""
        ...


@runtime_checkable
class ChunkWritable(Protocol):
    """A Writer that can also take one source's rows as a *sequence* of writes.

    The write-side dual of :class:`ChunkReader`. Handing a plain Writer one chunk
    at a time is not generally safe: a Writer that replaces its target (a
    truncate-and-reload, or a delete-then-append keyed by the run) does that
    replacement on *every* ``write``, so the second chunk would wipe the first.
    A Writer that can express "these many writes are one logical load" says so by
    implementing this: ``writing_chunks()`` opens a session and yields the Writer
    to use for the duration, doing any once-per-load work (the delete of the
    run's prior rows) exactly once on entry rather than once per chunk.

    Deliberately opt-in and separate from :class:`Writer`. A Writer that cannot
    express it simply does not implement it, and pairing it with a chunked read
    is refused when the graph is wired instead of corrupting the target at run
    time.
    """

    def writing_chunks(self) -> AbstractContextManager[Writer]:
        """Open a session whose many writes land as one logical load."""
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
