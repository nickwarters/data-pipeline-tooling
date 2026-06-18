```python
"""Processors: engine-confined transforms over a ``Dataset`` mid-pipeline.

A ``Processor`` reshapes a feed's data between the read and the post-validators:
it takes the bulk-tier dataset and returns a transformed one. Unlike the
structural validators it is **engine-confined**: it reaches the backing frame via
``to_pandas``/``from_pandas`` because a transform needs the engine's vectorised
operations.

The builder attaches processors with :meth:`Pipeline.with_processor` and runs
them as the ``process`` step. A processor has no severity: a transform either
applies or it can't, so a failure is always fail-fast.

Two families of concrete processor live in the framework. The schema-driven
``SchemaCoercion`` (in :mod:`framework.transform.coercion`) is the write-side
companion of ``SchemaValidator`` that repairs the representation raw loses to
storage.
This module holds reusable transforms: ``Filter`` and ``Score`` carry
plain-Python row callables, ``VectorizedFilter`` and ``VectorizedDerive`` carry
whole-frame callables for batch-friendly transforms, ``Sort`` and ``Rename``
reshape the frame, ``JoinWith`` joins an explicit read-only dependency in
Python, and ``AntiJoinWith`` excludes rows whose key is present in a read-only
dependency.
"""

from __future__ import annotations

import hashlib
import random
import uuid
from typing import (
    Any,
    Callable,
    Literal,
    Mapping,
    Sequence,
)

from framework._internal.describe import render
from framework.core.errors import PipelineError
from framework.core.protocols import DatasetSupplier, Processor
from framework.core.dataset import Dataset


class CoercionError(PipelineError):
    """Raised by a Processor when it cannot cast a value to its declared type."""


# Business rules are expressed as plain Python callables over a row mapping; the
# processor applies them row-wise behind the Dataset seam so the caller's rule
# stays pandas-free.
RowPredicate = Callable[[Mapping[str, Any]], bool]
RowScorer = Callable[[Mapping[str, Any]], Any]
FramePredicate = Callable[[Any], Any]
FrameDeriver = Callable[[Any], Any]


class Filter:
    """Keep only the rows for which a plain-Python row predicate is true.

    ``predicate`` is a callable over a row as a ``{column: value}`` mapping, so
    business rules are pure Python and never name the engine. Applied row-wise
    behind the Dataset seam.

    An optional ``name`` labels the gate for row-level explainability. Unnamed
    filters still work; they trace under a generic ``"filter"`` label.
    """

    trace_role = "filter"

    def __init__(self, predicate: RowPredicate, *, name: str | None = None) -> None:
        self._predicate = predicate
        self.trace_name = name or "filter"

    def process(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        kept = frame.loc[frame.apply(lambda row: self._predicate(row), axis=1)]
        return Dataset.from_pandas(kept)

    def describe(self) -> str:
        return render(self, name=self.trace_name)


class Score:
    """Compute a column from each row via a plain-Python scorer.

    ``scorer`` is a callable over a row mapping returning that row's value for
    ``column`` (a new column, or an overwrite of an existing one). Pure Python
    and is applied row-wise behind the seam; every other column is left untouched.

    Its trace metadata lets row-level explainability snapshot each considered
    row's score before later gates may exclude it.
    """

    trace_role = "score"

    def __init__(self, column: str, scorer: RowScorer) -> None:
        self._column = column
        self._scorer = scorer
        self.trace_name = column

    def process(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        frame[self._column] = frame.apply(lambda row: self._scorer(row), axis=1)
        return Dataset.from_pandas(frame)

    def describe(self) -> str:
        return render(self, column=self._column)


class VectorizedFilter:
    """Keep rows using a whole-frame predicate.

    ``predicate`` receives the backing pandas frame once and must return a
    boolean mask with the same length. Use this for common column expressions on
    large feeds where row-wise Python callbacks would dominate runtime.
    """

    trace_role = "filter"

    def __init__(self, predicate: FramePredicate, *, name: str | None = None) -> None:
        self._predicate = predicate
        self.trace_name = name or "vectorized-filter"

    def process(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        mask = self._predicate(frame)
        if len(mask) != len(frame):
            raise ValueError("VectorizedFilter predicate returned wrong-length mask")
        kept = frame.loc[mask].reset_index(drop=True)
        return Dataset.from_pandas(kept)

    def describe(self) -> str:
        return render(self, name=self.trace_name)


class VectorizedDerive:
    """Compute or overwrite one column from a whole-frame expression."""

    trace_role = "score"

    def __init__(self, column: str, derive: FrameDeriver) -> None:
        self._column = column
        self._derive = derive
        self.trace_name = column

    def process(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        frame[self._column] = self._derive(frame)
        return Dataset.from_pandas(frame)

    def describe(self) -> str:
        return render(self, column=self._column)


class Stamp:
    """Write one constant value onto every row of a column.

    Where ``Score`` derives a column from each row, ``Stamp`` records a single
    run-level constant, so the stamp reads as the constant it is, not a
    degenerate scorer. The column is added (or overwritten) even on an empty
    feed, so the output shape is stable whether or not any row survives.
    """

    def __init__(self, column: str, value: Any) -> None:
        self._column = column
        self._value = value

    def process(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        frame[self._column] = self._value
        return Dataset.from_pandas(frame)

    def describe(self) -> str:
        return render(self, column=self._column, value=self._value)


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
        frame = dataset.to_pandas()
        ordered = frame.sort_values(by=self._by, ascending=self._ascending).reset_index(
            drop=True
        )
        return Dataset.from_pandas(ordered)

    def describe(self) -> str:
        return render(self, by=self._by, ascending=self._ascending)


class Rename:
    """Rename columns by an ``{old: new}`` mapping; leave the rest untouched.

    Aligns a feed's columns to a shared vocabulary — typically before a join, so
    two feeds agree on a key name. Columns the mapping doesn't name pass through
    in place and in order.
    """

    def __init__(self, mapping: Mapping[str, str]) -> None:
        self._mapping = dict(mapping)

    def process(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        return Dataset.from_pandas(frame.rename(columns=self._mapping))

    def describe(self) -> str:
        return render(self, mapping=self._mapping)


_MergeHow = Literal["left", "right", "inner", "outer", "cross"]


def _as_supplier(source: DatasetSupplier | Dataset | object) -> DatasetSupplier | Dataset:
    if isinstance(source, Dataset):
        return source
    if callable(source):
        return source
    read = getattr(source, "read", None)
    if callable(read):
        return read
    raise TypeError("join dependency must be a Dataset, callable, or object with read()")


class JoinDependency:
    """A read-only dataset dependency for a cross-feed join.

    ``source`` is either a ``Reader`` (read once on demand by the pipeline
    runner) or an already materialized ``Dataset``. It is deliberately not a
    ``Pipeline``: upstream execution belongs to the runner/catalog layer, while
    ``JoinWith`` only consumes the explicit read dependency it was given.
    """

    def __init__(self, name: str, source: DatasetSupplier | Dataset | object) -> None:
        self.name = name
        self._source = _as_supplier(source)
        self._cached: Dataset | None = (
            self._source if isinstance(self._source, Dataset) else None
        )

    @property
    def materialized(self) -> bool:
        return self._cached is not None

    def read(self) -> Dataset:
        if self._cached is None:
            self._cached = self._source()
        return self._cached

    def dataset(self) -> Dataset:
        return self.read()


class JoinWith:
    """Join the feed against an explicit read-only dependency.

    ``other`` is a :class:`JoinDependency`, a ``Reader``, or a materialized
    ``Dataset``. Readers are read once and cached; Datasets are already
    materialized. ``JoinWith`` never executes another pipeline from
    :meth:`process`, so upstream execution, failure attribution, and logging stay
    explicit in the runner/catalog layer.

    ``on`` is the shared key column(s); ``how`` the join kind (``inner`` default,
    or ``left``/``right``/``outer``).

    An optional ``name`` labels the join for row-level explainability, so an
    *inner* join can explain a row it drops rather than leaving it silently
    absent.
    """

    trace_role = "join"

    def __init__(
        self,
        other: JoinDependency | DatasetSupplier | Dataset | object,
        *,
        on: str | Sequence[str],
        how: _MergeHow = "inner",
        name: str | None = None,
    ) -> None:
        self._other = (
            other
            if isinstance(other, JoinDependency)
            else JoinDependency(name or "join", _as_supplier(other))
        )
        self._on = on
        self._how = how
        self.trace_name = name or "join"

    @property
    def dependencies(self) -> list[JoinDependency]:
        return [self._other]

    def process(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        other_frame = self._other.dataset().to_pandas()
        merged = frame.merge(other_frame, on=self._on, how=self._how)  # type: ignore[arg-type]
        return Dataset.from_pandas(merged)

    def describe(self) -> str:
        return render(self, on=self._on, how=self._how, name=self.trace_name)


class AntiJoinWith:
    """Exclude feed rows whose key appears in an explicit read-only dependency.

    ``other`` is a :class:`JoinDependency`, a ``Reader``, or a materialized
    ``Dataset``. Readers are read once and cached through ``JoinDependency``.

    ``on`` is the shared key column(s). The output keeps the current feed's
    columns only; the dependency acts as a set-membership exclusion list.
    """

    trace_role = "join"

    def __init__(
        self,
        other: JoinDependency | DatasetSupplier | Dataset | object,
        *,
        on: str | Sequence[str],
        name: str | None = None,
    ) -> None:
        self._other = (
            other
            if isinstance(other, JoinDependency)
            else JoinDependency(name or "anti-join", _as_supplier(other))
        )
        self._on = [on] if isinstance(on, str) else list(on)
        self.trace_name = name or "anti-join"

    @property
    def dependencies(self) -> list[JoinDependency]:
        return [self._other]

    def process(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        other_frame = self._other.dataset().to_pandas()
        missing_left = [column for column in self._on if column not in frame.columns]
        missing_right = [
            column for column in self._on if column not in other_frame.columns
        ]
        if missing_left or missing_right:
            raise ValueError(
                "AntiJoinWith: key column(s) not found: "
                f"dataset={missing_left!r}, other={missing_right!r}."
            )

        keys = other_frame[self._on].drop_duplicates()
        joined = frame.merge(keys, on=self._on, how="left", indicator=True)
        kept = joined.loc[joined["_merge"] == "left_only", frame.columns].reset_index(
            drop=True
        )
        return Dataset.from_pandas(kept)

    def describe(self) -> str:
        return render(self, on=self._on, name=self.trace_name)


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
        frame = dataset.to_pandas()
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
        latest = sorted_frame.drop_duplicates(
            subset=self._key, keep="last"
        ).reset_index(drop=True)
        return Dataset.from_pandas(latest)

    def describe(self) -> str:
        return render(self, key=self._key, by=self._by)


class SelectColumns:
    """Keep only the listed columns from the dataset; drop everything else.

    Each single-table pipeline over a shared raw table reads only the columns it
    needs, keeping its schema narrow over a potentially wide feed.

    Raises ``ValueError`` if any requested column is absent from the dataset,
    so a misconfigured projection is caught at run time rather than silently
    producing an incomplete result.
    """

    def __init__(self, columns: Sequence[str]) -> None:
        self._columns = list(columns)

    def process(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        missing = [c for c in self._columns if c not in frame.columns]
        if missing:
            raise ValueError(
                f"SelectColumns: column(s) not found in dataset: {missing!r}. "
                f"Available columns: {list(frame.columns)!r}"
            )
        return Dataset.from_pandas(frame.loc[:, self._columns])

    def describe(self) -> str:
        return render(self, columns=self._columns)


class DropColumns:
    """Drop the listed columns from the dataset; keep everything else.

    The complement of :class:`SelectColumns`: where ``SelectColumns`` names the
    columns to keep, ``DropColumns`` names the columns to remove. It is the
    ergonomic choice for a
    wide feed that wants *almost* every column — strip a couple of internal /
    scratch columns off a wide raw table without enumerating the many it keeps.
    The surviving columns keep their original order.

    Raises ``ValueError`` if any requested column is absent from the dataset, so
    a mis-typed drop is caught at run time rather than silently doing nothing.
    """

    def __init__(self, columns: Sequence[str]) -> None:
        self._columns = list(columns)

    def process(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        missing = [c for c in self._columns if c not in frame.columns]
        if missing:
            raise ValueError(
                f"DropColumns: column(s) not found in dataset: {missing!r}. "
                f"Available columns: {list(frame.columns)!r}"
            )
        return Dataset.from_pandas(frame.drop(columns=self._columns))

    def describe(self) -> str:
        return render(self, columns=self._columns)


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
        frame = dataset.to_pandas()
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

    def describe(self) -> str:
        return render(
            self,
            id_vars=self._id_vars,
            value_vars=self._value_vars,
            var_name=self._var_name,
            value_name=self._value_name,
            drop_empty=self._drop_empty,
        )


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
        frame = dataset.to_pandas()
        frame[self._into] = frame.apply(
            lambda row: str(
                uuid.uuid5(
                    self._namespace,
                    "|".join(str(row[col]) for col in self._natural_key),
                )
            ),
            axis=1,
        )
        return Dataset.from_pandas(frame)

    def describe(self) -> str:
        return render(
            self,
            into=self._into,
            namespace=str(self._namespace),
            natural_key=self._natural_key,
        )


def _cut_per_group(frame, key, select):
    """Group ``frame`` by ``key`` and keep, per group, the rows ``select`` returns.

    The shared spine of the per-group processors: :class:`TopNPerGroup` and
    :class:`SamplePerGroup` differ only in *which* rows they keep from each group
    — ``select(group_key, group)`` returns that group's kept sub-frame. Groups
    are iterated in canonical key order and the kept rows concatenated, so the
    output is deterministic regardless of incoming row order. An empty feed in
    yields an empty feed out (consistent with :class:`Filter`).
    """
    if len(frame) == 0:
        return frame
    keep_index: list[Any] = []
    for group_key, group in frame.groupby(key, sort=True):
        keep_index.extend(select(group_key, group).index)
    return frame.loc[keep_index].reset_index(drop=True)


class TopNPerGroup:
    """Reduce each group of rows to its top ``n`` by a ranking column.

    ``key`` is one or more group columns (mirroring :class:`LatestPerKey`); the
    processor carries its **own** sort (``by``/``ascending``) so it does not
    depend on a preceding :class:`Sort` surviving the grouping, and applies a
    stable secondary tie-break on ``tiebreak`` so ranked output is reproducible
    when scores tie.

    A group with fewer than ``n`` rows passes through whole; an empty feed in
    yields an empty feed out (consistent with :class:`Filter`).

    Structurally this generalises ``LatestPerKey(key=K, by=B)`` to top-``n`` per
    key, but keeps a separate name because it preserves a bounded subset rather
    than one current row.
    """

    trace_role = "topn"
    trace_name = "top-N per group"

    def __init__(
        self,
        key: str | Sequence[str],
        by: str,
        n: int,
        ascending: bool = False,
        tiebreak: str = "case_id",
    ) -> None:
        self._key = [key] if isinstance(key, str) else list(key)
        self._by = by
        self._n = n
        self._ascending = ascending
        self._tiebreak = tiebreak

    def _select(self, _group_key: Any, group):
        # Carry our own sort (by, ascending) with a stable tie-break on
        # `tiebreak` so a tied score ranks reproducibly. Sort the tie-break
        # ascending always — it only disambiguates equal `by` values.
        ordered = group.sort_values(
            by=[self._by, self._tiebreak],
            ascending=[self._ascending, True],
            kind="stable",
        )
        return ordered.head(self._n)

    def process(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        return Dataset.from_pandas(_cut_per_group(frame, self._key, self._select))

    def describe(self) -> str:
        return render(
            self,
            key=self._key,
            by=self._by,
            n=self._n,
            ascending=self._ascending,
            tiebreak=self._tiebreak,
        )


# The sampler is a pure function of input state and this seed, never run_id or
# the clock. Run-to-run variation comes from the upstream population shrinking,
# not from the seed.
_DEFAULT_SAMPLE_SEED = 0


class SamplePerGroup:
    """Draw at most ``n`` rows per group by a seeded, reproducible sample.

    A **pure function** of (input dataset, seed). ``key`` is one or more group
    columns; ``seed`` a fixed, configurable constant (*not* ``run_id`` or the
    clock); ``order`` the column that puts each group into a canonical order
    before the draw.

    Each group is drawn independently via a per-group seed derived from
    ``hash(seed, group_key)`` using stdlib hashing (``hashlib`` — stable across
    Windows/macOS, unlike the salted builtin ``hash``). Because
    the group is ordered by ``order`` first and the draw keys only off the group
    identity, the result is **invariant to incoming row/group order**: the same
    set in with the same seed yields the same sample out.

    A group with fewer than ``n`` rows passes through whole; an empty feed in
    yields an empty feed out (consistent with :class:`Filter`).
    """

    trace_role = "sample"
    trace_name = "sample per group"

    def __init__(
        self,
        key: str | Sequence[str],
        n: int,
        seed: int = _DEFAULT_SAMPLE_SEED,
        order: str = "case_id",
    ) -> None:
        self._key = [key] if isinstance(key, str) else list(key)
        self._n = n
        self._seed = seed
        self._order = order

    def _group_seed(self, group_key: Any) -> int:
        # Normalise the group key (scalar for a single column, tuple for many)
        # to a stable string, then derive a platform-independent integer seed.
        parts = group_key if isinstance(group_key, tuple) else (group_key,)
        key_str = "|".join(str(p) for p in parts)
        digest = hashlib.sha256(f"{self._seed}|{key_str}".encode("utf-8")).hexdigest()
        return int(digest, 16)

    def _select(self, group_key: Any, group):
        # Canonicalise the group by `order` so the draw is invariant to incoming
        # row order; a group at or below n passes through whole.
        ordered = group.sort_values(by=self._order, kind="stable")
        if len(ordered) <= self._n:
            return ordered
        rng = random.Random(self._group_seed(group_key))
        chosen = sorted(rng.sample(range(len(ordered)), k=self._n))
        return ordered.iloc[chosen]

    def process(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        return Dataset.from_pandas(_cut_per_group(frame, self._key, self._select))

    def describe(self) -> str:
        return render(
            self, key=self._key, n=self._n, seed=self._seed, order=self._order
        )

```
