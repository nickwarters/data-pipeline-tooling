```python
"""``TargetedSelection`` — reduce a pool of Cases to per-cell targets.

A Selection processor: it takes the eligible pool as a ``Dataset`` and returns
the Cases chosen, so it slots into a Selection pipeline as a ``transform`` step
like any framework processor. What it chooses is declared by a
:class:`TargetedSelectionConfig`:

- **Levels** name the grouping columns, coarsest first — e.g. ``("brand",
  "case_type", "product", "attribute")``. One combination of values across all
  of them is a **cell**.
- **Targets** give each cell its own count (e.g. 20), and **total** caps the
  whole selection (e.g. 320).
- **Make-up** fills a cell that cannot meet its target from its own Cases by
  climbing the levels: drop the finest level and take Cases from the wider group
  (same brand/case type/product, any attribute), then drop the next, stopping at
  the declared **make-up group** (e.g. brand/case type). Every cell is filled
  from its own Cases *before* any make-up, so a short cell never takes the Cases
  a sibling cell was targeted at.
- **Balance** optionally steers a Boolean column towards an even 50/50 share
  within each group of a declared prefix of the levels (e.g. brand/case
  type/product, not per attribute). It is a preference, never a gate: each pick
  takes the next Case on the side its balance group is short of, and falls back
  to the next Case of either side when none is left.

Within those rules Cases are taken in a reproducible rank: ordered by ``order``,
then — when ``seed`` is set — shuffled by a seeded draw, so the same pool and
seed always yield the same selection (ADR-0010). ``seed=None`` takes Cases in
``order`` order instead (e.g. oldest first by a related-date column).
"""

from __future__ import annotations

import random
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Mapping

from framework.core import Dataset

Cell = tuple[Any, ...]


@dataclass(frozen=True)
class TargetedSelectionConfig:
    """What :class:`TargetedSelection` chooses — see the module docstring.

    ``make_up_to`` and ``balance_by`` are each a prefix of ``levels``:
    ``make_up_to == levels`` disables make-up, ``()`` lets it reach the whole
    pool; ``balance_by=()`` balances the selection as a whole.
    """

    levels: tuple[str, ...]
    targets: Mapping[Cell, int]
    total: int
    make_up_to: tuple[str, ...]
    balance_column: str | None = None
    balance_by: tuple[str, ...] = ()
    order: str = "case_id"
    seed: int | None = 0

    def __post_init__(self) -> None:
        if not self.levels:
            raise ValueError("TargetedSelectionConfig needs at least one level")
        if self.total < 0:
            raise ValueError(f"`total` must not be negative, got {self.total!r}")
        for name, prefix in (
            ("make_up_to", self.make_up_to),
            ("balance_by", self.balance_by),
        ):
            if tuple(self.levels[: len(prefix)]) != tuple(prefix):
                raise ValueError(
                    f"`{name}` {prefix!r} must be a leading prefix of "
                    f"`levels` {self.levels!r}"
                )
        for cell, target in self.targets.items():
            if len(cell) != len(self.levels):
                raise ValueError(
                    f"target cell {cell!r} must give one value per level "
                    f"{self.levels!r}"
                )
            if target < 0:
                raise ValueError(f"target for {cell!r} must not be negative")

    @property
    def columns(self) -> list[str]:
        extra = [self.balance_column] if self.balance_column else []
        return [*self.levels, *extra, self.order]


class TargetedSelection:
    """Reduce a pool of Cases to the per-cell targets its config declares."""

    trace_role = "sample"
    trace_name = "targeted selection"

    def __init__(self, config: TargetedSelectionConfig) -> None:
        self._config = config

    def __call__(self, dataset: Dataset) -> Dataset:
        config = self._config
        frame = dataset.to_pandas()
        missing = [c for c in config.columns if c not in frame.columns]
        if missing:
            raise ValueError(
                f"TargetedSelection: column(s) not found in dataset: {missing!r}. "
                f"Available columns: {list(frame.columns)!r}"
            )
        ranked = self._rank(frame)
        picks = _Picker(ranked, config).pick()
        return Dataset.from_pandas(ranked.iloc[picks].reset_index(drop=True))

    def _rank(self, frame):
        ordered = frame.sort_values(by=self._config.order, kind="stable")
        ordered = ordered.reset_index(drop=True)
        if self._config.seed is None:
            return ordered
        positions = list(range(len(ordered)))
        random.Random(self._config.seed).shuffle(positions)
        return ordered.iloc[positions].reset_index(drop=True)

    def describe(self) -> str:
        c = self._config
        return (
            f"TargetedSelection(levels={list(c.levels)!r}, cells={len(c.targets)}, "
            f"total={c.total!r}, make_up_to={list(c.make_up_to)!r}, "
            f"balance_column={c.balance_column!r}, "
            f"balance_by={list(c.balance_by)!r}, order={c.order!r}, "
            f"seed={c.seed!r})"
        )


class _Picker:
    """The fill: one pass per rung, finest first, over every target cell."""

    def __init__(self, ranked, config: TargetedSelectionConfig) -> None:
        self._config = config
        # A null group value is still a value: normalise NaN to None so it
        # compares equal to itself and a null cell can be targeted.
        values = ranked[list(config.levels)].astype(object)
        values = values.where(values.notna(), None)
        self._keys: list[Cell] = [tuple(row) for row in values.itertuples(index=False)]
        self._flags: list[bool | None] = [None] * len(ranked)
        if config.balance_column:
            column = ranked[config.balance_column]
            self._flags = [
                None if null else bool(value)
                for value, null in zip(column, column.isna())
            ]
        self._taken = [False] * len(ranked)
        # Per balance group: how many chosen on the False / True side.
        self._tally: dict[Cell, list[int]] = defaultdict(lambda: [0, 0])

    def pick(self) -> list[int]:
        config = self._config
        chosen: list[int] = []
        filled = {cell: 0 for cell in config.targets}
        for depth in range(len(config.levels), len(config.make_up_to) - 1, -1):
            pools = self._pools(depth)
            for cell, target in config.targets.items():
                pool = pools.get(cell[:depth], [])
                while filled[cell] < target and len(chosen) < config.total:
                    position = self._next(pool)
                    if position is None:
                        break
                    self._take(position)
                    chosen.append(position)
                    filled[cell] += 1
        return chosen

    def _pools(self, depth: int) -> dict[Cell, list[int]]:
        # Each group at this rung, as its rows' positions in rank order.
        pools: dict[Cell, list[int]] = defaultdict(list)
        for position, key in enumerate(self._keys):
            pools[key[:depth]].append(position)
        return pools

    def _next(self, pool: list[int]) -> int | None:
        # The first untaken Case on the side its balance group is short of;
        # failing that, the first untaken Case of either side.
        first = None
        for position in pool:
            if self._taken[position]:
                continue
            if first is None:
                first = position
            wanted = self._wanted(position)
            if wanted is None or self._flags[position] is wanted:
                return position
        return first

    def _wanted(self, position: int) -> bool | None:
        if not self._config.balance_column:
            return None
        false_count, true_count = self._tally[self._balance_key(position)]
        if false_count == true_count:
            return None
        return true_count < false_count

    def _take(self, position: int) -> None:
        self._taken[position] = True
        flag = self._flags[position]
        if flag is not None:
            self._tally[self._balance_key(position)][int(flag)] += 1

    def _balance_key(self, position: int) -> Cell:
        return self._keys[position][: len(self._config.balance_by)]

```
