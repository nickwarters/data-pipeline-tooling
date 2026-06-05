```python
"""Load strategy value types — the explicit _how_ for a Writer.

A strategy is passed to ``Store.writer`` to declare the load behaviour for a
feed, independent of which medallion layer it targets. The Store resolves only
the *location* (which ``<subject>/<layer>.db``); the Writer owns both location
and strategy (ADR-0003, ADR-0006 amendment).

Two strategies exist:

- :class:`Refresh` — truncate + reload each run; the table mirrors the current
  source snapshot after every run.
- :class:`AccumulateByRun` — accumulate rows stamped by ``run_id`` /
  ``load_date``; a re-driven run is idempotent via delete-by-run then insert
  (ADR-0006).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Refresh:
    """Truncate + reload on each run (current-state snapshot)."""


@dataclass(frozen=True)
class AccumulateByRun:
    """Accumulate rows per run, stamped with ``run_id`` and ``load_date``."""

    run_id: str
    load_date: str

    def __post_init__(self) -> None:
        if not self.run_id:
            raise ValueError("AccumulateByRun requires a non-empty run_id")
        if not self.load_date:
            raise ValueError("AccumulateByRun requires a non-empty load_date")

```
