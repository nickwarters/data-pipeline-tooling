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
from typing import Any, Callable, Literal, Mapping, Protocol, Sequence, runtime_checkable

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

    An optional ``name`` labels the eligibility gate so Selection
    explainability (#53) can record *which* filter excluded a Case — the
    ``selection_role``/``selection_name`` the trace reads. Unnamed filters still
    work; they trace under a generic ``"filter"`` label.
    """

    selection_role = "filter"

    def __init__(self, predicate: RowPredicate, *, name: str | None = None) -> None:
        self._predicate = predicate
        self.selection_name = name or "filter"

    def process(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()  # engine-confined (ADR-0002)
        kept = frame.loc[frame.apply(lambda row: self._predicate(row), axis=1)]
        return Dataset.from_pandas(kept)


class Score:
    """Compute a column from each row via a plain-Python scorer.

    The scoring half of Selection (CONTEXT.md): ``scorer`` is a callable over a
    row mapping returning that row's value for ``column`` (a new column, or an
    overwrite of an existing one). Pure Python (ADR-0002), applied row-wise
    behind the seam; every other column is left untouched.

    Its ``selection_role``/``selection_name`` let Selection explainability (#53)
    snapshot each considered Case's score — retained in the trace even for a
    Case a later gate excludes (AC2).
    """

    selection_role = "score"

    def __init__(self, column: str, scorer: RowScorer) -> None:
        self._column = column
        self._scorer = scorer
        self.selection_name = column

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


_MergeHow = Literal["left", "right", "inner", "outer", "cross"]


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

    An optional ``name`` labels the join so Selection explainability (#53) can
    record a Case an *inner* join drops as excluded by this join, rather than
    leaving it silently absent (AC5) — the ``selection_role``/``selection_name``
    the trace reads.
    """

    selection_role = "join"

    def __init__(
        self,
        other: Runnable,
        *,
        on: str | Sequence[str],
        how: _MergeHow = "inner",
        name: str | None = None,
    ) -> None:
        self._other = other
        self._on = on
        self._how = how
        self.selection_name = name or "join"

    def process(self, dataset: Dataset) -> Dataset:
        # Resolve the lazy reference now (ADR-0003): run the other builder and
        # merge in Python, both behind the Dataset seam (ADR-0002).
        frame = dataset.to_pandas()
        other_frame = self._other.run().to_pandas()
        merged = frame.merge(other_frame, on=self._on, how=self._how)  # type: ignore[arg-type]
        return Dataset.from_pandas(merged)


class LatestPerKey:
    """Collapse accumulated history to current state: keep the latest row per key.

    ``key`` is a column name (or list of column names) that identifies each
    entity; ``by`` is a timestamp or load column whose maximum value determines
    the "latest" row. One row per unique key value is returned.

    **Tie-breaking rule:** when two rows for the same key share the same maximum
    ``by`` value, the row that appears *last* in the input is kept. This is
    deterministic given a stable input order — accumulating silver is typically
    appended in load order, so the last row for a tie is the most recently
    appended.
    """

    def __init__(self, key: str | Sequence[str], by: str) -> None:
        self._key = [key] if isinstance(key, str) else list(key)
        self._by = by

    def process(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()  # engine-confined (ADR-0002)
        missing = [c for c in self._key + [self._by] if c not in frame.columns]
        if missing:
            raise ValueError(
                f"LatestPerKey: column(s) not found in dataset: {missing!r}. "
                f"Available columns: {list(frame.columns)!r}"
            )
        # Sort by key columns then by `by` column (stable sort preserves input
        # order for equal `by` values), then drop_duplicates(keep="last") keeps
        # the last-in-input row when tied — the documented tie-break rule.
        sorted_frame = frame.sort_values(by=self._key + [self._by], kind="stable")
        latest = sorted_frame.drop_duplicates(subset=self._key, keep="last").reset_index(drop=True)
        return Dataset.from_pandas(latest)


class SelectColumns:
    """Keep only the listed columns from the dataset; drop everything else.

    The projection seam for fan-out pipelines (ADR-0009): each single-table
    pipeline over a shared raw table reads only the columns it needs, keeping
    its schema narrow over a potentially wide feed.

    Raises ``ValueError`` if any requested column is absent from the dataset,
    so a misconfigured projection is caught at run time rather than silently
    producing an incomplete result.
    """

    def __init__(self, columns: Sequence[str]) -> None:
        self._columns = list(columns)

    def process(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()  # engine-confined (ADR-0002)
        missing = [c for c in self._columns if c not in frame.columns]
        if missing:
            raise ValueError(
                f"SelectColumns: column(s) not found in dataset: {missing!r}. "
                f"Available columns: {list(frame.columns)!r}"
            )
        return Dataset.from_pandas(frame.loc[:, self._columns])


class Unpivot:
    """Wide→long reshape: melt repeated column groups into one row per value.

    Takes the ``value_vars`` columns and melts them so each becomes a row,
    keeping ``id_vars`` columns intact per row. ``var_name`` labels the column
    that records which source column each row came from; ``value_name`` labels
    the column that holds the value. When ``drop_empty=True`` (the default),
    rows whose value is ``None`` or an empty/whitespace-only string are dropped —
    the typical use case for product 1..10 feeds where unoccupied slots are blank.
    """

    def __init__(
        self,
        id_vars: Sequence[str],
        value_vars: Sequence[str],
        *,
        var_name: str,
        value_name: str,
        drop_empty: bool = True,
    ) -> None:
        self._id_vars = list(id_vars)
        self._value_vars = list(value_vars)
        self._var_name = var_name
        self._value_name = value_name
        self._drop_empty = drop_empty

    def process(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()  # engine-confined (ADR-0002)
        melted = frame.melt(
            id_vars=self._id_vars,
            value_vars=self._value_vars,
            var_name=self._var_name,
            value_name=self._value_name,
        ).reset_index(drop=True)
        if self._drop_empty:
            value_col = melted[self._value_name]
            is_null = value_col.isna()
            is_blank = value_col.astype(str).str.strip() == ""
            melted = melted.loc[~(is_null | is_blank)].reset_index(drop=True)
        return Dataset.from_pandas(melted)


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
            lambda row: str(uuid.uuid5(
                self._namespace, "|".join(str(row[col]) for col in self._natural_key)
            )),
            axis=1,
        )
        return Dataset.from_pandas(frame)
