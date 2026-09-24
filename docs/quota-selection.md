# Configurable quota selection

`tools.selection.select_cases` selects from an **already eligible** `Dataset`.
It has no I/O, clock, history lookup or random state. Pipelines own eligibility,
configuration and writing the result. Existing selection pipelines are unchanged.

```python
from tools.selection import SelectionGroup, select_cases

result = select_cases(
    eligible,
    groups=[
        SelectionGroup(
            match={"A": "a1", "B": "b1"},
            target=50,
            dimensions=("C", "D", "E", "G"),
            targets=[
                # C     D     E     G      count
                ("c1", "d1", "e1", True,  15),
                ("c1", "d1", "e1", False, 15),
                ("c2", "d2", "e2", True,  20),
            ],
        ),
        SelectionGroup(
            match={"A": "a2", "B": "b2", "C": "c3"},
            target=30,
            dimensions=("D", "E", "G"),
            targets=[("d1", "e1", True, 30)],
        ),
        SelectionGroup(
            match={"A": "a3", "B": "b3"},
            target=20,
            dimensions=("C", "D", "E", "G"),
            targets=[("c1", "d1", "e1", False, 20)],
        ),
    ],
    balance_on="F",
    id_column="case_id",  # default
)
selected = result.selected
```

The overall requested volume is the sum of group targets: 100 here. All counts
are absolute non-negative integers, and each group's detailed targets must sum
to its target. There is no implicit scaling or transfer between groups.

## Allocation rules

1. Fill each exact combination up to its target, protecting all exact quotas
   before borrowing any surplus.
2. Fill deficits from surplus in **any listed combination within that group**.
   Donor combinations may exceed their own target. An explicitly listed
   zero-target combination can donate too.
3. For each remaining deficit, remove the rightmost dimension and try again;
   complete that level for all quotas before broadening further. With C/D/E/G,
   this retains C/D/E, then C/D, then C, then no dimensions. Always retain `match`.
   The retained values come from the original deficit's quota, not its donors.
   These stages can admit combinations not listed in `targets`.
4. Stop at the group boundary and report any remaining shortage.

Within a stage, quotas compete in declaration order and cases in input order.
Sort the eligible Dataset upstream if oldest-first or another preference is
required. Selection preserves input row order, index and columns, including on
empty output, and never changes case attributes or mutates the input. Identity
is enforced through `id_column`, not through the pandas index.

`dimensions=()` and `targets=[(count,)]` expresses a group with no finer quotas.
An empty `match` covers the whole population and consequently cannot coexist
with another group. An empty group list selects nothing but still traces input.

## Boolean balance

Balance applies separately within **each configured group boundary**, after the
volume and match levels have been allocated. For an achieved count N, the
desired True count is `(N + 1) // 2`; True gets the extra place for odd totals.
If only three False cases exist among 20 available places, 17 True / 3 False
is acceptable and the report exposes the deviation.

The selector exchanges cases while preserving every allocated slot's match
requirements. Exchanges may move several selected cases to accommodate a new
one; this avoids an early choice trapping a later quota. It finds the closest
achievable boolean count **for those allocated slots**, without sacrificing
volume or relaxing their specificity. It is not a global optimizer of competing
quota deficits: quota declaration order resolves allocation ties before balance.
Boolean preference can override input order; input order breaks remaining ties.

F is independent of the dimensions and boundary. G can be an ordinary boolean
dimension. Balance values must be actual non-null booleans, not strings or 0/1;
coerce source data before calling. Missing dimension values cannot match an
exact value, but can be admitted once that dimension is dropped. Missing
boundary values never match that boundary.

## Results and validation

`SelectionResult` contains:

- `selected`: the selected `Dataset`, with original columns.
- `trace`: one row per input case, with `case_id` (the configured ID column's
  value), zero-based `group` and `quota`, `selected`, and `reason`. Reasons are
  `exact`, `redistributed`, `fallback:N` (N retained dimensions), `not_selected`,
  or `outside_groups`. Unassigned group/quota fields are null. The quota is the
  demand fulfilled; the selected case may have different dimension values.
- `quota_report`: immutable reports of target, exact, redistributed, fallback
  and shortfall counts for each quota. These describe fulfilled demand, not
  actual case composition; aggregate `selected` to inspect the latter.
- `group_report`: immutable reports of target, selected, shortfall,
  `desired_true` (based on achieved volume), `selected_true`, `selected_false`.

Duplicate/null IDs, missing or duplicate columns, invalid boolean values,
duplicate quota combinations, null configuration values, invalid counts and
overlapping group boundaries raise `ValueError`. Boundaries must be provably
disjoint from their declarations, even if today's data contains no overlap.
Match/dimension columns must be distinct and cannot include the balance column.
Validation happens before allocation, including for empty input.

The trace is a standalone selection artifact, not an automatic integration with
the framework's `explain` context. The calling pipeline should write it alongside
its SelectionPool, adding run identity through its normal writer. Eligibility
exclusions before this function remain the caller's responsibility to trace.

This is an in-memory utility for ordinary eligible case pools, not a streaming
selector. It uses existing pandas/Dataset dependencies and requires no solver,
new package installation or OS-specific facilities. See
[ADR-0030](adr/0030-configurable-quota-selection-is-an-opt-in-utility.md).
