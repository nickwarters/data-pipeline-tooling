"""Targeted retry at the reader/writer edges.

Transient edge failures — a remote source briefly unavailable, a SharePoint/SAS
fetch dropping, a SQLite ``database is locked`` — are worth one more attempt;
schema-validation and configuration errors are not. A :class:`RetryPolicy`
encodes that distinction as an **allowlist**: it retries only the exception types
it is told to and re-raises everything else immediately. :class:`RetryingReader`
and :class:`RetryingWriter` apply a policy at the ``read()`` / ``write()`` edge,
so retry never wraps validation or business-rule failures.

The policy is a swappable collaborator in the same spirit as the load strategies
and the remote stubs: a Reader/Writer is decorated with one, not rewritten.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import TypeVar

from framework._internal.describe import component_summary
from framework.core.dataset import Dataset
from framework.core.protocols import (
    DEFAULT_CHUNK_SIZE,
    ChunkReader,
    Reader,
    Writer,
)
from framework.io.writers import supports_chunk_writes
from framework.io.writers import writing_chunks as open_chunk_writes

log = logging.getLogger(__name__)

T = TypeVar("T")


class RetryPolicy:
    """Retry a transient operation a bounded number of times.

    ``attempts`` is the total number of tries (``1`` means no retry). ``retry_on``
    is the allowlist of exception types treated as transient: an instance of one
    is retried until ``attempts`` is exhausted, then re-raised; any other
    exception propagates immediately on the first failure. ``backoff_seconds`` is
    slept between attempts via the injectable ``sleep`` (so tests stay fast and
    the wait stays cross-platform).
    """

    def __init__(
        self,
        attempts: int = 1,
        retry_on: tuple[type[BaseException], ...] = (),
        backoff_seconds: float = 0.0,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.attempts = attempts
        self.retry_on = retry_on
        self.backoff_seconds = backoff_seconds
        self._sleep = sleep

    def call(
        self,
        operation: Callable[[], T],
        *,
        on_retry: Callable[[int, BaseException], None] | None = None,
    ) -> T:
        """Run ``operation``; retry transient failures up to ``attempts`` times.

        ``on_retry`` is invoked once per retried failure with the 1-based attempt
        number that failed and the exception, before the next attempt.
        """
        for attempt in range(1, self.attempts + 1):
            try:
                return operation()
            except self.retry_on as exc:
                if attempt >= self.attempts:
                    raise
                if on_retry is not None:
                    on_retry(attempt, exc)
                if self.backoff_seconds:
                    self._sleep(self.backoff_seconds)
        # Unreachable: the loop either returns or raises on the final attempt.
        raise AssertionError("RetryPolicy.call exhausted without returning")


class _RetryingEdge:
    """Shared retry bookkeeping for the reader/writer decorators.

    Holds the component being retried and the policy, and records each retried
    attempt as a human note on :attr:`retry_attempts` (reset per call), which the
    builder drains into the read/write step's run-log ``warn_hits``; every
    attempt is also logged for live console visibility. ``_edge`` names the I/O
    edge in those notes.

    It also renders the plan line for whatever it wraps, delegating through the
    inner component's own ``describe()``. A decorator that did not would replace
    a reader's summary with its own bare class name, so applying retry — an
    operational concern that changes nothing about *what* is read — would quietly
    cost the plan the one line saying where the data comes from.
    """

    _edge = "io"

    def __init__(self, inner: object, policy: RetryPolicy) -> None:
        self._inner = inner
        self._policy = policy
        self.retry_attempts: list[str] = []

    def describe(self) -> str:
        return (
            f"Retrying({component_summary(self._inner)}, "
            f"attempts={self._policy.attempts})"
        )

    @property
    def data_locations(self) -> list[dict[str, str]]:
        """What the wrapped component reported touching, or nothing."""
        return getattr(self._inner, "data_locations", [])

    def _run(self, operation: Callable[[], T]) -> T:
        self.retry_attempts = []
        return self._policy.call(operation, on_retry=self._note)

    def _note(self, attempt: int, exc: BaseException) -> None:
        message = (
            f"retry {self._edge}: attempt {attempt}/{self._policy.attempts} "
            f"failed ({type(exc).__name__}: {exc}); retrying"
        )
        self.retry_attempts.append(message)
        log.warning("%s", message)


class RetryingReader(_RetryingEdge):
    """Decorate a :class:`Reader`, retrying its ``read()`` per a policy.

    Scoped to the source edge: only the wrapped ``read()`` is retried, so a
    transient source failure gets another attempt while a non-transient one
    (validation or configuration) aborts at once.
    """

    _edge = "read"

    def __init__(self, inner: Reader, policy: RetryPolicy) -> None:
        super().__init__(inner, policy)

    def read(self) -> Dataset:
        return self._run(self._inner.read)


class RetryingChunkReader(_RetryingEdge):
    """Decorate a :class:`ChunkReader`, retrying the *start* of its stream.

    The streaming readers are the ones most exposed to a transient failure —
    they are the ones reaching a network share or an extract dropped by a remote
    host — and until now they were the only readers retry could not cover, since
    a ``ChunkReader`` has no ``read()`` to wrap.

    **What is retried, and why only that.** A failure is retried while the stream
    has yielded *nothing*: the source is re-opened and iterated from the
    beginning. Once a chunk has been handed downstream that is no longer safe —
    the consumer has already written those rows, so restarting would land them
    twice, and a ``ChunkReader`` cannot be resumed from where it broke because
    nothing in the contract says where that was. So a mid-stream failure
    propagates and the run aborts, exactly as it does without retry.

    That is not the weak half of the bargain it sounds like: opening the source
    is where the transient failures this exists for actually happen — the share
    unreachable, the extract not yet released, the handle refused. Making a
    stream resumable is a property of a source, and a source that has one can
    offer it as its own reader.
    """

    _edge = "read"

    def __init__(self, inner: ChunkReader, policy: RetryPolicy) -> None:
        super().__init__(inner, policy)

    def chunks(self, size: int = DEFAULT_CHUNK_SIZE) -> Iterator[Dataset]:
        self.retry_attempts = []
        for attempt in range(1, self._policy.attempts + 1):
            yielded = False
            try:
                for chunk in self._inner.chunks(size):
                    yielded = True
                    yield chunk
                return
            except self._policy.retry_on as exc:
                if yielded or attempt >= self._policy.attempts:
                    raise
                self._note(attempt, exc)
                if self._policy.backoff_seconds:
                    self._policy._sleep(self._policy.backoff_seconds)

    @property
    def rows_scanned(self) -> int:
        """The wrapped reader's scan tally, when it keeps one.

        Forwarded rather than reimplemented so a filtering reader keeps
        reporting how much of the source it had to look at even through the
        decorator; a reader that keeps no tally has no attribute here either,
        which is how a caller tells the two apart.
        """
        return self._inner.rows_scanned  # type: ignore[attr-defined]

    @property
    def rows_kept(self) -> int:
        """The wrapped reader's kept tally, when it keeps one."""
        return self._inner.rows_kept  # type: ignore[attr-defined]


class RetryingWriter(_RetryingEdge):
    """Decorate a :class:`Writer`, retrying its ``write()`` per a policy.

    The write-side dual of :class:`RetryingReader`: only the wrapped ``write()``
    is retried, keeping retry at the sink edge.
    """

    _edge = "write"

    def __init__(self, inner: Writer, policy: RetryPolicy) -> None:
        super().__init__(inner, policy)
        if not supports_chunk_writes(inner):
            # Retry adds no ability to take a streamed source, so the decorator
            # must not appear to have one the wrapped Writer lacks: hiding the
            # method keeps the wire-time refusal accurate through the wrapper
            # instead of deferring the failure to the first chunk.
            self.writing_chunks = None

    def write(self, dataset: Dataset) -> None:
        self._run(lambda: self._inner.write(dataset))

    @contextmanager
    def writing_chunks(self) -> Iterator[Writer]:
        """Retry each chunk of the wrapped Writer's chunk-write session.

        Retry is per write, so it composes with a chunked load unchanged: the
        wrapped Writer decides what happens once per load, and each chunk that
        lands inside the session gets the same allowlisted retry a single write
        would.
        """
        with open_chunk_writes(self._inner) as chunk_writer:
            yield RetryingWriter(chunk_writer, self._policy)
