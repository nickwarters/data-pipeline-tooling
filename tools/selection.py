"""Absolute hierarchical quotas over an already eligible Dataset.

See docs/quota-selection.md for allocation, balancing and tie-breaking rules.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

import pandas as pd

from framework.core import Dataset


@dataclass(frozen=True)
class SelectionGroup:
    """A fixed boundary, with detailed targets in dimension order."""

    match: Mapping[str, Any]
    target: int
    dimensions: Sequence[str]
    targets: Sequence[tuple[Any, ...]]


@dataclass(frozen=True)
class QuotaReport:
    group: int
    quota: int
    target: int
    exact: int
    redistributed: int
    fallback: int
    shortfall: int


@dataclass(frozen=True)
class GroupReport:
    group: int
    target: int
    selected: int
    shortfall: int
    desired_true: int
    selected_true: int
    selected_false: int


@dataclass(frozen=True)
class SelectionResult:
    selected: Dataset
    trace: Dataset
    quota_report: tuple[QuotaReport, ...]
    group_report: tuple[GroupReport, ...]


@dataclass
class _Slot:
    row: int
    quota: int
    stage: str
    candidates: tuple[int, ...]


def _count(value: Any, label: str) -> None:
    if type(value) is not int or value < 0:
        raise ValueError(f"{label} must be a non-negative integer")


def _scalar(value: Any) -> bool:
    return pd.api.types.is_scalar(value) and not pd.isna(value)


def _validate(groups: Sequence[SelectionGroup], balance_on: str) -> None:
    for index, group in enumerate(groups):
        _count(group.target, "group target")
        names = [*group.match, *group.dimensions]
        if any(not isinstance(name, str) or not name for name in names):
            raise ValueError("match and dimension columns must be non-empty strings")
        if len(set(names)) != len(names) or balance_on in names:
            raise ValueError("match, dimensions and balance column must be distinct")
        if not all(_scalar(value) for value in group.match.values()):
            raise ValueError("match values must be non-null scalars")
        combinations = []
        for target in group.targets:
            if len(target) != len(group.dimensions) + 1:
                raise ValueError(
                    "each target must contain dimension values and a count"
                )
            _count(target[-1], "quota target")
            values = tuple(target[:-1])
            if not all(_scalar(value) for value in values):
                raise ValueError("dimension values must be non-null scalars")
            if values in combinations:
                raise ValueError("duplicate quota combination")
            combinations.append(values)
        if sum(target[-1] for target in group.targets) != group.target:
            raise ValueError("quota targets must sum to the group target")
        for other in groups[:index]:
            shared = group.match.keys() & other.match.keys()
            if all(group.match[key] == other.match[key] for key in shared):
                raise ValueError("group boundaries must not overlap")


def _matches(row: Mapping[str, Any], match: Mapping[str, Any]) -> bool:
    return all(_scalar(row[key]) and row[key] == value for key, value in match.items())


def _balance(slots: list[_Slot], rows: list[dict], column: str) -> None:
    """Exchange along alternating paths without changing any slot's match level.

    A path may move several selected cases before admitting an unselected case.
    This avoids a greedy boolean choice trapping a later, constrained quota.
    """
    desired = (len(slots) + 1) // 2
    while True:
        true_count = sum(bool(rows[slot.row][column]) for slot in slots)
        if true_count == desired:
            return
        want = true_count < desired
        owners = {slot.row: index for index, slot in enumerate(slots)}
        parents: dict[int, tuple[int, int] | None] = {
            index: None
            for index, slot in enumerate(slots)
            if bool(rows[slot.row][column]) != want
        }
        queue = deque(parents)
        endpoint = None
        while queue and endpoint is None:
            index = queue.popleft()
            for row in slots[index].candidates:
                owner = owners.get(row)
                if owner is None:
                    if bool(rows[row][column]) == want:
                        endpoint = (index, row)
                        break
                elif owner not in parents:
                    parents[owner] = (index, row)
                    queue.append(owner)
        if endpoint is None:
            return
        index, row = endpoint
        while True:
            slots[index].row = row
            parent = parents[index]
            if parent is None:
                break
            index, row = parent


def select_cases(
    dataset: Dataset,
    *,
    groups: Sequence[SelectionGroup],
    balance_on: str,
    id_column: str = "case_id",
) -> SelectionResult:
    """Select unique cases; preserve input columns and use input order for ties.

    Quotas are protected before borrowing surplus. Unfilled slots broaden by
    dropping dimensions from the right, never crossing their group's boundary.
    Balance is as close to half as possible for the allocated match levels,
    with True receiving the extra place for odd achieved totals.
    """
    groups = tuple(groups)
    _validate(groups, balance_on)
    frame = dataset.to_pandas()
    if not frame.columns.is_unique:
        raise ValueError("dataset columns must be unique")
    required = {id_column, balance_on}
    for group in groups:
        required.update(group.match)
        required.update(group.dimensions)
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"missing columns: {sorted(missing)}")
    if frame[id_column].isna().any() or frame[id_column].duplicated().any():
        raise ValueError("case IDs must be non-null and unique")
    rows = frame.to_dict("records")
    if any(type(row[balance_on]) is not bool for row in rows):
        raise ValueError("balance column must contain only non-null booleans")

    selected: dict[int, tuple[int, _Slot]] = {}
    memberships: dict[int, int] = {}
    quota_reports = []
    group_reports = []
    for group_index, group in enumerate(groups):
        population = tuple(
            i for i, row in enumerate(rows) if _matches(row, group.match)
        )
        memberships.update(dict.fromkeys(population, group_index))
        slots: list[_Slot] = []
        used: set[int] = set()
        remaining = [target[-1] for target in group.targets]

        def allocate(quota: int, stage: str, candidates: tuple[int, ...]) -> None:
            for row in candidates:
                if not remaining[quota]:
                    break
                if row not in used:
                    slots.append(_Slot(row, quota, stage, candidates))
                    used.add(row)
                    remaining[quota] -= 1

        exact = [
            tuple(
                i
                for i in population
                if _matches(rows[i], dict(zip(group.dimensions, target[:-1])))
            )
            for target in group.targets
        ]
        for quota, candidates in enumerate(exact):
            allocate(quota, "exact", candidates)
        configured = set(i for candidates in exact for i in candidates)
        surplus = tuple(i for i in population if i in configured)
        for quota in range(len(remaining)):
            allocate(quota, "redistributed", surplus)
        for depth in range(len(group.dimensions) - 1, -1, -1):
            for quota, target in enumerate(group.targets):
                if not remaining[quota]:
                    continue
                match = dict(zip(group.dimensions[:depth], target[:depth]))
                candidates = tuple(i for i in population if _matches(rows[i], match))
                allocate(quota, f"fallback:{depth}", candidates)

        _balance(slots, rows, balance_on)
        selected.update({slot.row: (group_index, slot) for slot in slots})
        true_count = sum(rows[slot.row][balance_on] for slot in slots)
        group_reports.append(
            GroupReport(
                group_index,
                group.target,
                len(slots),
                group.target - len(slots),
                (len(slots) + 1) // 2,
                true_count,
                len(slots) - true_count,
            )
        )
        for quota, target in enumerate(group.targets):
            stages = [slot.stage for slot in slots if slot.quota == quota]
            quota_reports.append(
                QuotaReport(
                    group_index,
                    quota,
                    target[-1],
                    stages.count("exact"),
                    stages.count("redistributed"),
                    sum(stage.startswith("fallback:") for stage in stages),
                    remaining[quota],
                )
            )

    trace = []
    for i, row in enumerate(rows):
        assignment = selected.get(i)
        trace.append(
            {
                "case_id": row[id_column],
                "group": memberships.get(i),
                "quota": assignment[1].quota if assignment else None,
                "selected": assignment is not None,
                "reason": assignment[1].stage
                if assignment
                else ("not_selected" if i in memberships else "outside_groups"),
            }
        )
    return SelectionResult(
        Dataset.from_pandas(frame.iloc[sorted(selected)].copy()),
        Dataset.from_pandas(
            pd.DataFrame(
                trace, columns=["case_id", "group", "quota", "selected", "reason"]
            )
        ),
        tuple(quota_reports),
        tuple(group_reports),
    )
