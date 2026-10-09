"""How long a step spent waiting on things outside it.

A step that takes ten minutes may be doing ten minutes of work, or waiting nine
of them on a slow service or on retries of a flaky one. The run record keeps
the two apart with four counters, gathered here:

* ``retry_attempts`` / ``retry_wait_seconds`` -- attempts a
  :class:`~tools.retry.RetryPolicy` retried, and the time those failed attempts
  and their backoff took.
* ``external_calls`` / ``external_wait_seconds`` -- calls made inside an
  :func:`external_call` block, and the time spent in them.

Whatever records a step opens :func:`measure_waits` around it; retries and
external calls anywhere beneath it count towards it, however deep. A measured
block nested in another (a step inside a run) also adds to the outer one when it
closes, so a run's totals cover all its steps.

The tally is held in a context variable, so it follows the code that is
running. Work handed to another thread is not counted unless that thread was
started with the caller's context (``contextvars.copy_context().run``).
"""

from __future__ import annotations

import contextvars
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass


@dataclass
class Waits:
    """The waits one measured block has seen so far."""

    retry_attempts: int = 0
    retry_wait_seconds: float = 0.0
    external_calls: int = 0
    external_wait_seconds: float = 0.0

    def add(self, other: Waits) -> None:
        self.retry_attempts += other.retry_attempts
        self.retry_wait_seconds += other.retry_wait_seconds
        self.external_calls += other.external_calls
        self.external_wait_seconds += other.external_wait_seconds

    def fields(self) -> dict[str, int | float]:
        """The tally as run-record fields."""
        return {
            "retry_attempts": self.retry_attempts,
            "retry_wait_seconds": round(self.retry_wait_seconds, 6),
            "external_calls": self.external_calls,
            "external_wait_seconds": round(self.external_wait_seconds, 6),
        }


_CURRENT: contextvars.ContextVar[Waits | None] = contextvars.ContextVar(
    "measured_waits", default=None
)
# Set while inside an external call, so a wrapped call that makes another
# wrapped call is counted once.
_IN_EXTERNAL_CALL: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "in_external_call", default=False
)


@contextmanager
def measure_waits() -> Iterator[Waits]:
    """Tally the retries and external calls made inside the block."""
    waits = Waits()
    token = _CURRENT.set(waits)
    try:
        yield waits
    finally:
        _CURRENT.reset(token)
        outer = _CURRENT.get()
        if outer is not None:
            outer.add(waits)


def note_retry(seconds: float) -> None:
    """Count one retried attempt that cost ``seconds``."""
    waits = _CURRENT.get()
    if waits is not None:
        waits.retry_attempts += 1
        waits.retry_wait_seconds += seconds


@contextmanager
def external_call(clock: Callable[[], float] = time.perf_counter) -> Iterator[None]:
    """Count the block as one call to a service outside the pipeline.

    Wrap the call itself, not the work around it, so the time recorded is time
    spent waiting on the service::

        with external_call():
            response = client.fetch(...)

    A failed call is counted too: its time was still spent waiting.
    """
    if _IN_EXTERNAL_CALL.get():
        yield
        return
    token = _IN_EXTERNAL_CALL.set(True)
    started = clock()
    try:
        yield
    finally:
        _IN_EXTERNAL_CALL.reset(token)
        waits = _CURRENT.get()
        if waits is not None:
            waits.external_calls += 1
            waits.external_wait_seconds += clock() - started
