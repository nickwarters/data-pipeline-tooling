"""How long a step spent waiting on retries.

A step that takes ten minutes may be doing ten minutes of work, or waiting nine
of them on retries of a flaky source. The run record keeps the two apart with
two counters, gathered here: ``retry_attempts`` and ``retry_wait_seconds`` --
attempts a :class:`~tools.retry.RetryPolicy` retried, and the time those failed
attempts and their backoff took. A step's own work is its duration less
``retry_wait_seconds``.

Whatever records a step opens :func:`measure_waits` around it; retries anywhere
beneath it count towards it, however deep. A measured block nested in another (a
step inside a run) also adds to the outer one when it closes, so a run's totals
cover all its steps.

The tally is held in a context variable, so it follows the code that is
running. Work handed to another thread is not counted unless that thread was
started with the caller's context (``contextvars.copy_context().run``).
"""

from __future__ import annotations

import contextvars
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass


@dataclass
class Waits:
    """The retries one measured block has seen so far."""

    retry_attempts: int = 0
    retry_wait_seconds: float = 0.0

    def add(self, other: Waits) -> None:
        self.retry_attempts += other.retry_attempts
        self.retry_wait_seconds += other.retry_wait_seconds

    def fields(self) -> dict[str, int | float]:
        """The tally as run-record fields."""
        return {
            "retry_attempts": self.retry_attempts,
            "retry_wait_seconds": round(self.retry_wait_seconds, 6),
        }


_CURRENT: contextvars.ContextVar[Waits | None] = contextvars.ContextVar(
    "measured_waits", default=None
)


@contextmanager
def measure_waits() -> Iterator[Waits]:
    """Tally the retries made inside the block."""
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
