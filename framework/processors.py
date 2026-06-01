"""Processors — engine-confined transforms over a ``Dataset`` mid-pipeline.

A ``Processor`` reshapes a feed's data between the read and the post-validators
(issue #23): it takes the bulk-tier dataset and returns a transformed one. Unlike
the structural validators it is **engine-confined** — it reaches the backing
frame via ``to_pandas``/``from_pandas`` exactly as a Reader/Writer does
(ADR-0002), because a transform needs the engine's vectorised operations.

The builder attaches processors with :meth:`Pipeline.with_processor` and runs
them as the ``process`` step. A processor has no severity: a transform either
applies or it can't, so a failure is always fail-fast (ADR-0007) — it raises and
the run aborts.

Two families of concrete processor live in the framework. The schema-driven
``SchemaCoercion`` (in :mod:`framework.schema`) is the write-side companion of
``SchemaValidator`` that repairs the representation raw loses to storage (#23).
This module holds the **Selection** transforms (#9): ``Filter`` and ``Score``
carry plain-Python row callables (the business rule never names the engine —
ADR-0002), ``Sort`` and ``Rename`` reshape the frame, and ``JoinWith`` holds a
**lazy reference to another builder** (a :class:`Runnable`), resolved to a DAG
and joined in Python only at ``.run()`` (ADR-0003).
"""

from __future__ import annotations

import uuid
from typing import Any, Callable, Mapping, Protocol, Sequence, runtime_checkable

from framework.dataset import Dataset


class CoercionError(Exception):
    """Raised by a Processor when it cannot cast a value to its declared type."""


@runtime_checkable
class Processor(Protocol):
    """An engine-confined transform of one feed's data, run mid-pipeline."""

    def process(self, dataset: Dataset) -> Dataset:
        """Return a transformed dataset; raise on a value it cannot transform."""
        ...


@runtime_checkable
class Runnable(Protocol):
    """Anything that materialises a feed on demand — i.e. another builder.

    The structural seam ``JoinWith`` holds its lazy reference through: a
    ``Pipeline`` satisfies it (``run() -> Dataset``) without ``processors``
    importing ``builder`` (which would cycle, since ``builder`` imports this
    module). Naming the shape rather than the class is what lets the join carry
    an *unexecuted* builder and resolve it to a DAG only at run time (ADR-0003).
    """

    def run(self) -> Dataset:
        """Execute the referenced builder and return its dataset."""
        ...


# The Selection workload's business rules (filter/score) are expressed as plain
# Python callables over a row mapping — never the engine (ADR-0002). The
# processor applies them row-wise behind the Dataset seam; the caller's rule
# stays pure Python and pandas-free.
RowPredicate = Callable[[Mapping[str, Any]], bool]
RowScorer = Callable[[Mapping[str, Any]], Any]


class Filter:
    """Keep only the rows for which a plain-Python row predicate is true.

    The narrowing half of Selection (CONTEXT.md): ``predicate`` is a callable
    over a row as a ``{column: value}`` mapping, so the availability/eligibility
    rule is pure Python (ADR-0002) and never names the engine. Applied row-wise
    behind the Dataset seam.
    """

    def __init__(self, predicate: RowPredicate) -> None:
        self._predicate = predicate

    def process(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()  # engine-confined (ADR-0002)
        kept = frame[frame.apply(lambda row: self._predicate(row), axis=1)]
        return Dataset.from_pandas(kept)


class Score:
    """Compute a column from each row via a plain-Python scorer.

    The scoring half of Selection (CONTEXT.md): ``scorer`` is a callable over a
    row mapping returning that row's value for ``column`` (a new column, or an
    overwrite of an existing one). Pure Python (ADR-0002), applied row-wise
    behind the seam; every other column is left untouched.
    """

    def __init__(self, column: str, scorer: RowScorer) -> None:
        self._column = column
        self._scorer = scorer

    def process(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas().copy()  # engine-confined (ADR-0002)
        frame[self._column] = frame.apply(lambda row: self._scorer(row), axis=1)
        return Dataset.from_pandas(frame)


class Stamp:
    """Write one constant value onto every row of a column.

    The declarative half of "mark these Cases" in Selection: where ``Score``
    derives a column from each row, ``Stamp`` records a single run-level constant
    — chiefly the applicable ``question_bank_id`` the Variation resolves
    (CONTEXT.md) — so the stamp reads as the constant it is, not a degenerate
    scorer. The column is added (or overwritten) even on an empty feed, so the
    output shape is stable whether or not any Case was selected.
    """

    def __init__(self, column: str, value: Any) -> None:
        self._column = column
        self._value = value

    def process(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas().copy()  # engine-confined (ADR-0002)
        frame[self._column] = self._value
        return Dataset.from_pandas(frame)


class Sort:
    """Order rows by one or more columns, so a downstream "top N" is meaningful.

    ``by`` is a column name or a sequence of them; ``ascending`` a single flag
    (or a matching sequence). The sorted dataset's index is reset so it reads
    positionally clean and no stale source order leaks through to storage.
    """

    def __init__(
        self,
        by: str | Sequence[str],
        ascending: bool | Sequence[bool] = True,
    ) -> None:
        self._by = by
        self._ascending = ascending

    def process(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()  # engine-confined (ADR-0002)
        ordered = frame.sort_values(
            by=self._by, ascending=self._ascending
        ).reset_index(drop=True)
        return Dataset.from_pandas(ordered)


class Rename:
    """Rename columns by an ``{old: new}`` mapping; leave the rest untouched.

    Aligns a feed's columns to a shared vocabulary — typically before a join, so
    two feeds agree on a key name. Columns the mapping doesn't name pass through
    in place and in order.
    """

    def __init__(self, mapping: Mapping[str, str]) -> None:
        self._mapping = dict(mapping)

    def process(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()  # engine-confined (ADR-0002)
        return Dataset.from_pandas(frame.rename(columns=self._mapping))


class JoinWith:
    """Join the feed against another feed, resolved lazily at run time.

    ``other`` is a **lazy reference to another builder** (any :class:`Runnable`,
    typically a read-only :class:`~framework.builder.Pipeline` over another
    subject's silver/gold). It is **not** executed at construction; only
    :meth:`process` calls ``other.run()`` and merges the two feeds in Python
    (ADR-0002 — never SQL). This is how a pipeline resolves to a DAG without a
    separate DAG engine (ADR-0003): the join is just a processor holding an
    unexecuted builder.

    ``on`` is the shared key column(s); ``how`` the join kind (``inner`` default,
    or ``left``/``right``/``outer``).
    """

    def __init__(
        self,
        other: Runnable,
        *,
        on: str | Sequence[str],
        how: str = "inner",
    ) -> None:
        self._other = other
        self._on = on
        self._how = how

    def process(self, dataset: Dataset) -> Dataset:
        # Resolve the lazy reference now (ADR-0003): run the other builder and
        # merge in Python, both behind the Dataset seam (ADR-0002).
        frame = dataset.to_pandas()
        other_frame = self._other.run().to_pandas()
        merged = frame.merge(other_frame, on=self._on, how=self._how)
        return Dataset.from_pandas(merged)


class DeriveKey:
    """Stamp a deterministic ``uuid5`` key onto every row.

    Computes ``uuid5(namespace, natural_key_string)`` for each row and writes
    the result into the ``into`` column (new or overwrite). The natural-key
    string is formed by joining the ``str()`` of each listed column's value
    with ``"|"`` as the separator, in declared order — so the same values
    always produce the same UUID on every run and every machine (pure stdlib
    ``uuid``, no platform variance).

    ``namespace`` is a ``uuid.UUID`` instance supplied by the caller (typically
    the case-type namespace). ``natural_key`` is a list of column names whose
    values are composed into the key string.
    """

    def __init__(
        self,
        *,
        into: str,
        namespace: uuid.UUID,
        natural_key: Sequence[str],
    ) -> None:
        self._into = into
        self._namespace = namespace
        self._natural_key = list(natural_key)

    def process(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas().copy()  # engine-confined (ADR-0002)
        frame[self._into] = frame.apply(
            lambda row: uuid.uuid5(
                self._namespace, "|".join(str(row[col]) for col in self._natural_key)
            ),
            axis=1,
        )
        return Dataset.from_pandas(frame)
