```python
"""Row-level quarantine: partition value-rule breaches from good rows.

The abort-vs-quarantine boundary:
- Structural breaches (missing columns, wrong dtypes) still abort via
  ``SchemaValidator``.
- Value-rule breaches (Pattern, Length, Unique, OneOf) → eligible for quarantine when
  the pipeline is configured with ``.quarantine(partitioner, reject_writer)``.

A ``RowValidator`` partitions a ``Dataset`` into ``(good, rejected)`` where the
rejected partition carries a ``failed_rule`` column describing every violated rule for
that row. The pipeline stamps ``run_id`` and ``load_date`` on rejected rows before
handing them to the reject ``Writer``.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

import pandas as pd

from framework.dataset import Dataset
from framework.schema import _declared_rules


@runtime_checkable
class RowValidator(Protocol):
    """Partition a dataset into good rows and rejected rows by value rules."""

    def partition(self, dataset: Dataset) -> tuple[Dataset, Dataset]:
        """Return ``(good_rows, rejected_rows)``.

        ``rejected_rows`` has a ``failed_rule`` column — a semicolon-joined
        description of every value-rule breach for that row. Good rows carry no
        such column and are the ones that proceed through the pipeline.
        """
        ...


class SchemaValueRulePartitioner:
    """Partition rows by value-level rules declared on a Case Type schema.

    Only ``ValueRule`` annotations (Pattern, Length, Unique, OneOf) are applied;
    structural concerns (missing columns, wrong dtypes) are the ``SchemaValidator``'s
    domain and still abort. A row that violates any value rule lands in rejected with
    all its breach descriptions joined; a row that violates none lands in good.
    """

    def __init__(self, schema: type) -> None:
        self._rules = _declared_rules(schema)

    def partition(self, dataset: Dataset) -> tuple[Dataset, Dataset]:
        frame = dataset.to_pandas()

        # Accumulate per-row breach descriptions keyed by DataFrame index.
        row_reasons: dict[int, list[str]] = {}
        for col, rules in self._rules:
            if col not in frame.columns:
                continue
            for rule in rules:
                mask = rule.violating_mask(frame[col])
                for idx in frame.index[mask]:
                    row_reasons.setdefault(int(idx), []).append(
                        f"column {col!r} {_rule_label(rule, frame[col])}"
                    )

        bad_idx = set(row_reasons.keys())
        good_frame = frame[~frame.index.isin(bad_idx)].reset_index(drop=True)
        rejected_frame = frame[frame.index.isin(bad_idx)].copy().reset_index(drop=True)

        # Attach the breach description; preserve original index order for the message.
        original_order = [i for i in frame.index if i in bad_idx]
        rejected_frame["failed_rule"] = [
            "; ".join(row_reasons[int(i)]) for i in original_order
        ]

        return Dataset.from_pandas(good_frame), Dataset.from_pandas(rejected_frame)


def _rule_label(rule: object, series: "pd.Series") -> str:
    """Extract the breach phrase from a rule for the failed_rule column.

    Calls ``check()`` on the series (which already contains only the row's
    value — a single-element series at index 0) to get the rule's own phrasing,
    falling back to the rule's class name if check returns None unexpectedly.
    """
    if hasattr(rule, "check"):
        result = rule.check(series)  # type: ignore[union-attr]
        if result is not None:
            return result
    return type(rule).__name__

```
