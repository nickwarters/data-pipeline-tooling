"""Load strategy value types — the explicit _how_ for a Writer.

A strategy is passed to ``Store.writer`` to declare the load behaviour for a
feed, independent of which medallion layer it targets. The Store resolves only
the *location* (which ``<subject>/<layer>.db``); the Writer owns both location
and strategy.

Three strategies exist:

- :class:`Refresh` — truncate + reload each run; the table mirrors the current
  source snapshot after every run.
- :class:`AccumulateByRun` — accumulate rows stamped by ``run_id`` /
  ``load_date`` plus optional ``execution_id``; a re-driven logical run is
  idempotent via delete-by-logical-run then insert.
- :class:`UpsertStrategy` — merge incoming rows into the target by a declared
  key set: matching keys are replaced, new keys are inserted, unmatched target
  rows are preserved.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Refresh:
    """Truncate + reload on each run (current-state snapshot)."""


@dataclass(frozen=True)
class AccumulateByRun:
    """Accumulate rows per logical run, stamped with run metadata."""

    run_id: str
    load_date: str
    execution_id: str | None = None

    def __post_init__(self) -> None:
        if not self.run_id:
            raise ValueError("AccumulateByRun requires a non-empty run_id")
        if not self.load_date:
            raise ValueError("AccumulateByRun requires a non-empty load_date")

    @classmethod
    def from_context(cls, context) -> "AccumulateByRun":
        """Derive the accumulation strategy from a shared RunContext."""
        return cls(
            run_id=context.logical_run_id,
            load_date=context.load_date,
            execution_id=context.execution_id,
        )

    @property
    def logical_run_id(self) -> str:
        """Explicit name for the idempotency key; ``run_id`` is the legacy alias."""
        return self.run_id


class UpsertStrategy:
    """Merge incoming rows by a declared key set (update-or-insert).

    Matching keys are replaced, new keys are inserted, target rows whose key
    does not appear in the incoming batch are preserved.

    Accepts a bare string or a sequence for ergonomics::

        UpsertStrategy("case_id")           # single key
        UpsertStrategy(("region", "code"))  # composite key
    """

    __slots__ = ("key_columns",)

    def __init__(self, key_columns: str | tuple[str, ...]) -> None:
        if isinstance(key_columns, str):
            normalised: tuple[str, ...] = (key_columns,)
        else:
            normalised = tuple(key_columns)
        if not normalised:
            raise ValueError("UpsertStrategy requires at least one key column")
        object.__setattr__(self, "key_columns", normalised)

    def __setattr__(self, name: str, value: object) -> None:
        raise AttributeError("UpsertStrategy is immutable")

    def __eq__(self, other: object) -> bool:
        return (
            isinstance(other, UpsertStrategy) and self.key_columns == other.key_columns
        )

    def __hash__(self) -> int:
        return hash(self.key_columns)

    def __repr__(self) -> str:
        return f"UpsertStrategy(key_columns={self.key_columns!r})"
