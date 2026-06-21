```python
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
from collections.abc import Callable
from typing import TypeVar

from framework.core.dataset import Dataset
from framework.core.protocols import Reader, Writer

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

    Holds the policy and records each retried attempt as a human note on
    :attr:`retry_attempts` (reset per call), which the builder drains into the
    read/write step's run-log ``warn_hits``; every attempt is also logged for
    live console visibility. ``_edge`` names the I/O edge in those notes.
    """

    _edge = "io"

    def __init__(self, policy: RetryPolicy) -> None:
        self._policy = policy
        self.retry_attempts: list[str] = []

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
        super().__init__(policy)
        self._inner = inner

    def read(self) -> Dataset:
        return self._run(self._inner.read)


class RetryingWriter(_RetryingEdge):
    """Decorate a :class:`Writer`, retrying its ``write()`` per a policy.

    The write-side dual of :class:`RetryingReader`: only the wrapped ``write()``
    is retried, keeping retry at the sink edge.
    """

    _edge = "write"

    def __init__(self, inner: Writer, policy: RetryPolicy) -> None:
        super().__init__(policy)
        self._inner = inner

    def write(self, dataset: Dataset) -> None:
        self._run(lambda: self._inner.write(dataset))

```
