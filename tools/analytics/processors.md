```python
import hashlib
import json
import random
from typing import Any, Callable, Sequence

from framework._internal.describe import render
from framework.core.dataset import Dataset

ValueParser = Callable[[Any], Any]


class Parse:
    """Decode each value in one or more packed text columns through a callable.

    ``columns`` is a column name (or a sequence of them) whose values are run
    through ``parser``, replacing each value in place. ``parser`` defaults to
    :func:`json.loads`, so a JSON-encoded text column becomes structured Python
    values (a ``dict``/``list`` per row) ready for a downstream reshape — but it
    is any ``value -> value`` callable, so the same processor decodes ISO
    timestamps (``datetime.fromisoformat``), a custom record parser, etc.

    Applied column-by-column behind the Dataset seam. Raises ``ValueError`` if
    any named column is absent, consistent with the other column processors, so
    a mis-typed column is caught at run time rather than silently skipped.
    """

    def __init__(
        self, columns: str | Sequence[str], parser: ValueParser = json.loads
    ) -> None:
        self._columns = [columns] if isinstance(columns, str) else list(columns)
        self._parser = parser

    def __call__(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        missing = [c for c in self._columns if c not in frame.columns]
        if missing:
            raise ValueError(
                f"Parse: column(s) not found in dataset: {missing!r}. "
                f"Available columns: {list(frame.columns)!r}"
            )
        for column in self._columns:
            frame[column] = frame[column].map(self._parser)
        return Dataset.from_pandas(frame)

    def describe(self) -> str:
        parser = getattr(self._parser, "__name__", repr(self._parser))
        return render(self, columns=self._columns, parser=parser)


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

    def __call__(self, dataset: Dataset) -> Dataset:
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


def _draw_sample(frame, n: int, seed: int, order: str):
    """Draw at most ``n`` rows from ``frame`` reproducibly under ``seed``.

    The shared draw behind :class:`Sample` and each group of
    :class:`SamplePerGroup`: order the frame by ``order`` so the result is
    invariant to incoming row order, then take a seeded sample. A frame at or
    below ``n`` passes through whole.
    """
    ordered = frame.sort_values(by=order, kind="stable")
    if len(ordered) <= n:
        return ordered
    rng = random.Random(seed)
    chosen = sorted(rng.sample(range(len(ordered)), k=n))
    return ordered.iloc[chosen]


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
        # Each group is drawn off its own derived seed so the result is invariant
        # to incoming row/group order.
        return _draw_sample(group, self._n, self._group_seed(group_key), self._order)

    def __call__(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        return Dataset.from_pandas(_cut_per_group(frame, self._key, self._select))

    def describe(self) -> str:
        return render(
            self, key=self._key, n=self._n, seed=self._seed, order=self._order
        )


class Sample:
    """Draw a seeded, reproducible sample from the whole feed.

    The ungrouped counterpart of :class:`SamplePerGroup`: a **pure function** of
    (input dataset, seed) that samples the feed as a single population rather than
    per group. ``seed`` is a fixed, configurable constant (*not* ``run_id`` or the
    clock); ``order`` puts the feed into a canonical order before the draw, so the
    same set in with the same seed yields the same sample out, invariant to
    incoming row order.

    The size is given **either** as an absolute count ``n`` **or** as a
    ``fraction`` of the feed (``0 < fraction <= 1``, a proportion not a percent —
    ``0.1`` is 10%); exactly one is required. A ``fraction`` resolves to
    ``round(fraction * len)`` rows at run time, so it scales with the (already
    upstream-narrowed) population.

    A feed at or below the resolved size passes through whole; an empty feed in
    yields an empty feed out (consistent with :class:`Filter`).
    """

    trace_role = "sample"
    trace_name = "sample"

    def __init__(
        self,
        n: int | None = None,
        seed: int = _DEFAULT_SAMPLE_SEED,
        order: str = "case_id",
        *,
        fraction: float | None = None,
    ) -> None:
        if (n is None) == (fraction is None):
            raise ValueError("Sample requires exactly one of `n` or `fraction`")
        if fraction is not None and not 0 < fraction <= 1:
            raise ValueError(f"Sample `fraction` must be in (0, 1], got {fraction!r}")
        self._n = n
        self._fraction = fraction
        self._seed = seed
        self._order = order

    def _size(self, population: int) -> int:
        # An absolute `n` is taken as given; a `fraction` resolves against the
        # run's actual population so the sample scales with it.
        if self._n is not None:
            return self._n
        assert self._fraction is not None  # one of the two is always set
        return round(self._fraction * population)

    def __call__(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        if len(frame) == 0:
            return dataset
        sampled = _draw_sample(frame, self._size(len(frame)), self._seed, self._order)
        return Dataset.from_pandas(sampled.reset_index(drop=True))

    def describe(self) -> str:
        return render(
            self,
            n=self._n,
            fraction=self._fraction,
            seed=self._seed,
            order=self._order,
        )


def _cut_per_group(frame, key, select):
    import pandas as pd

    if len(frame) == 0:
        return frame
    grouped = frame.groupby(key, sort=True, dropna=False)
    cut = [select(name, group) for name, group in grouped]
    return pd.concat(cut, ignore_index=True) if cut else frame.iloc[:0]

```
