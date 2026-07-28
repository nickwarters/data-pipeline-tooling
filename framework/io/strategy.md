```python
"""Load strategy value types — the explicit _how_ for a Writer.

A strategy is passed to ``Store.writer`` to declare the load behaviour for a
feed, independent of which medallion layer it targets. The Store resolves only
the *location* (which ``<subject>/<layer>.db``); the Writer owns both location
and strategy.

Each strategy knows how to **realise itself**, so nothing outside this module
has to branch on which strategy it was handed:

- ``writer_for(db_path, table, busy_timeout_ms=...)`` mints the SQLite Writer
  that implements the strategy against one table. ``Store.writer`` just calls
  it, which is why a store needs no knowledge of the strategies at all.
- ``apply_to_frame(frame, read_existing)`` is the file-writer half: given the
  incoming frame and a callable that reads whatever is already on disk, it
  returns the frame to write out whole. It is **optional** — a strategy whose
  semantics depend on SQL table constraints or on SQL-side merging simply does
  not define it, and a file Writer handed such a strategy fails with a message
  naming both. An unsupported combination is therefore a visibly missing
  method rather than an invisibly missing branch.

A new strategy is a new class here plus one export line; no dispatch table,
registry, or ``isinstance`` chain anywhere else needs to learn about it.

The strategies shipped today:

- :class:`Refresh` — truncate + reload each run; the table mirrors the current
  source snapshot after every run.
- :class:`AccumulateByRun` — accumulate rows stamped by ``logical_run_id`` /
  ``load_date`` plus optional ``pipeline_run_id``; a re-driven logical run is
  idempotent via delete-by-logical-run then insert.
- :class:`UpsertStrategy` — merge incoming rows into the target by a declared
  key set: matching keys are replaced, new keys are inserted, unmatched target
  rows are preserved.
- :class:`InsertOrIgnore` — append new rows; silently skip any row that
  conflicts with an existing constraint on the target table (PRIMARY KEY,
  UNIQUE, etc.). The conflict resolution is driven by the table's own
  constraints, not by the strategy.
- :class:`InsertIfAbsent` — reference/dimension load: insert new keys only,
  preserve existing rows, and mint compact integer surrogates in Python for
  each new key. Conflict resolution is key-driven (the strategy declares the
  natural key) rather than constraint-driven.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from framework.core.protocols import Writer

if TYPE_CHECKING:  # pragma: no cover - typing only
    import pandas as pd

__all__ = [
    "LoadStrategy",
    "Refresh",
    "AccumulateByRun",
    "UpsertStrategy",
    "InsertOrIgnore",
    "InsertIfAbsent",
]

# A callable returning whatever a file Writer's target already holds (an empty
# frame when it holds nothing yet). Passed rather than read eagerly so a
# strategy that replaces wholesale never pays for the read.
ReadExisting = Callable[[], "pd.DataFrame"]


class LoadStrategy(Protocol):
    """What a Writer-minting caller needs from a load strategy.

    Satisfied by any object that can mint the SQLite Writer implementing it.
    ``apply_to_frame`` is deliberately *not* part of this contract: file
    Writers ask for it by name and report a clear failure when a strategy does
    not offer one, so a SQL-only strategy stays a legitimate strategy.
    """

    def writer_for(
        self,
        db_path: str | os.PathLike[str],
        table: str,
        *,
        busy_timeout_ms: int = 5000,
    ) -> Writer:
        """Mint the Writer that loads ``table`` in ``db_path`` this way."""
        ...


@dataclass(frozen=True)
class Refresh:
    """Truncate + reload on each run (current-state snapshot)."""

    def writer_for(
        self,
        db_path: str | os.PathLike[str],
        table: str,
        *,
        busy_timeout_ms: int = 5000,
    ) -> Writer:
        from framework.io.writers import SqliteTruncateReloadWriter

        return SqliteTruncateReloadWriter(
            db_path, table, busy_timeout_ms=busy_timeout_ms
        )

    def apply_to_frame(
        self, frame: "pd.DataFrame", read_existing: ReadExisting
    ) -> "pd.DataFrame":
        # Replace wholesale: the incoming frame is the whole answer, so
        # whatever the target already holds is never even read.
        return frame


@dataclass(frozen=True)
class AccumulateByRun:
    """Accumulate rows per logical run, stamped with run metadata.

    ``logical_run_id`` is the idempotency key a re-driven run deletes by;
    ``pipeline_run_id`` is the concrete attempt, stamped for traceability when
    the strategy was derived from a RunContext.
    """

    logical_run_id: str
    load_date: str
    pipeline_run_id: str | None = None

    def __post_init__(self) -> None:
        if not self.logical_run_id:
            raise ValueError("AccumulateByRun requires a non-empty logical_run_id")
        if not self.load_date:
            raise ValueError("AccumulateByRun requires a non-empty load_date")

    @classmethod
    def from_context(cls, context) -> "AccumulateByRun":
        """Derive the accumulation strategy from a shared RunContext."""
        return cls(
            logical_run_id=context.logical_run_id,
            load_date=context.load_date,
            pipeline_run_id=context.pipeline_run_id,
        )

    def writer_for(
        self,
        db_path: str | os.PathLike[str],
        table: str,
        *,
        busy_timeout_ms: int = 5000,
    ) -> Writer:
        from framework.io.writers import AccumulateByRunWriter

        return AccumulateByRunWriter(
            db_path,
            table,
            self.logical_run_id,
            self.load_date,
            pipeline_run_id=self.pipeline_run_id,
            busy_timeout_ms=busy_timeout_ms,
        )

    def stamp(self, frame: "pd.DataFrame") -> "pd.DataFrame":
        """Stamp this run's identity onto ``frame`` in place and return it.

        The run columns every accumulating sink needs, wherever it persists:
        ``logical_run_id`` (the idempotency key a re-driven run deletes by),
        ``load_date``, and ``pipeline_run_id`` when the strategy came from a
        RunContext.
        """
        frame["logical_run_id"] = self.logical_run_id
        if self.pipeline_run_id is not None:
            frame["pipeline_run_id"] = self.pipeline_run_id
        frame["load_date"] = self.load_date
        return frame

    def apply_to_frame(
        self, frame: "pd.DataFrame", read_existing: ReadExisting
    ) -> "pd.DataFrame":
        import pandas as pd

        frame = self.stamp(frame)

        # Idempotent re-run: drop this logical run's prior rows, keep every
        # other run's, then append the incoming ones.
        existing = read_existing()
        if len(existing) > 0 and "logical_run_id" in existing.columns:
            existing = existing[existing["logical_run_id"] != self.logical_run_id]
        return pd.concat([existing, frame], ignore_index=True)


class UpsertStrategy:
    """Merge incoming rows by a declared key set (update-or-insert).

    Matching keys are replaced, new keys are inserted, target rows whose key
    does not appear in the incoming batch are preserved.

    Accepts a bare string or a sequence for ergonomics::

        UpsertStrategy("case_id")           # single key
        UpsertStrategy(("region", "code"))  # composite key

    Deliberately offers no ``apply_to_frame``: the merge is done SQL-side
    against the target table, so there is no meaningful whole-file rewrite for
    a file Writer to perform.
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

    def writer_for(
        self,
        db_path: str | os.PathLike[str],
        table: str,
        *,
        busy_timeout_ms: int = 5000,
    ) -> Writer:
        from framework.io.writers import SqliteUpsertWriter

        return SqliteUpsertWriter(
            db_path, table, self.key_columns, busy_timeout_ms=busy_timeout_ms
        )


@dataclass(frozen=True)
class InsertOrIgnore:
    """Append new rows; silently skip rows that conflict with existing constraints.

    Uses SQLite's ``INSERT OR IGNORE`` so any row that would violate a
    PRIMARY KEY, UNIQUE, NOT NULL, or CHECK constraint on the target table is
    silently discarded rather than raising an error.  Rows that do not conflict
    are appended.  Target rows that are not in the incoming batch are never
    touched.

    Conflict resolution is driven by the target table's own constraints, not by
    this strategy.  When the table carries no constraints every incoming row is
    appended (equivalent to a plain append).
    """

    def writer_for(
        self,
        db_path: str | os.PathLike[str],
        table: str,
        *,
        busy_timeout_ms: int = 5000,
    ) -> Writer:
        from framework.io.writers import SqliteInsertOrIgnoreWriter

        return SqliteInsertOrIgnoreWriter(
            db_path, table, busy_timeout_ms=busy_timeout_ms
        )

    def apply_to_frame(
        self, frame: "pd.DataFrame", read_existing: ReadExisting
    ) -> "pd.DataFrame":
        import pandas as pd

        # Files carry no table constraints, so every incoming row is appended —
        # equivalent to a plain append, matching SQLite's no-constraint
        # behaviour.
        existing = read_existing()
        if len(existing) == 0:
            return frame
        return pd.concat([existing, frame], ignore_index=True)


class InsertIfAbsent:
    """Reference/dimension load: insert new keys, preserve existing rows.

    On each write the incoming dataset is compared against the target on the
    declared ``key_columns``.  Rows whose key is already present are skipped
    entirely; rows with a new key receive a fresh compact integer surrogate
    (``max_existing_id + 1``, ``+2``, …) and are inserted.  Existing rows are
    never updated or deleted.

    Surrogate assignment lives in Python, not in SQLite ``AUTOINCREMENT``, so
    the same key always maps to the same id across re-runs and machines —
    making the reference table a stable system of record.

    This is distinct from :class:`InsertOrIgnore`: ``InsertOrIgnore`` lets
    SQLite's own table constraints decide what conflicts; ``InsertIfAbsent``
    explicitly checks which keys exist and mints surrogates for the new ones.

    Accepts a bare string or a sequence for ``key_columns``::

        InsertIfAbsent("value")
        InsertIfAbsent(("region", "code"))
        InsertIfAbsent("value", surrogate_column="ref_id")

    Deliberately offers no ``apply_to_frame``: minting surrogates requires the
    target's existing key→id mapping, which only a table-backed Writer holds.
    """

    __slots__ = ("key_columns", "surrogate_column")

    def __init__(
        self,
        key_columns: str | tuple[str, ...],
        surrogate_column: str = "id",
    ) -> None:
        if isinstance(key_columns, str):
            normalised: tuple[str, ...] = (key_columns,)
        else:
            normalised = tuple(key_columns)
        if not normalised:
            raise ValueError("InsertIfAbsent requires at least one key column")
        object.__setattr__(self, "key_columns", normalised)
        object.__setattr__(self, "surrogate_column", surrogate_column)

    def __setattr__(self, name: str, value: object) -> None:
        raise AttributeError("InsertIfAbsent is immutable")

    def __eq__(self, other: object) -> bool:
        return (
            isinstance(other, InsertIfAbsent)
            and self.key_columns == other.key_columns
            and self.surrogate_column == other.surrogate_column
        )

    def __hash__(self) -> int:
        return hash((self.key_columns, self.surrogate_column))

    def __repr__(self) -> str:
        return (
            f"InsertIfAbsent(key_columns={self.key_columns!r}, "
            f"surrogate_column={self.surrogate_column!r})"
        )

    def writer_for(
        self,
        db_path: str | os.PathLike[str],
        table: str,
        *,
        busy_timeout_ms: int = 5000,
    ) -> Writer:
        from framework.io.writers import SqliteInsertIfAbsentWriter

        return SqliteInsertIfAbsentWriter(
            db_path,
            table,
            self.key_columns,
            surrogate_column=self.surrogate_column,
            busy_timeout_ms=busy_timeout_ms,
        )

```
