```python
"""Row-level quarantine: partition value-rule breaches from good rows.

The abort-vs-quarantine boundary:
- Structural breaches (missing columns, wrong dtypes) still abort via
  ``SchemaValidator``.
- Value-rule breaches (Pattern, Length, Unique, OneOf) and row-check breaches
  (cross-field, declared via ``@row_checks``) → eligible for quarantine when
  the pipeline is configured with ``.quarantine(partitioner, reject_writer)``.

A ``RowValidator`` partitions a ``Dataset`` into ``(good, rejected)`` where the
rejected partition carries a ``failed_rule`` column describing every violated rule for
that row. The pipeline stamps ``logical_run_id`` / ``pipeline_run_id`` and
``load_date`` on rejected rows before handing them to the reject ``Writer``.

A reject reason names the **rule's expectation** and samples no values: the
rejected row's own values sit beside the reason in the reject table, so the
reason plus the row is the located explanation. The aborting validator phrases
the same breach differently — with a sample of the column's offenders — because
it is describing a column rather than a row. Both read the one shared
evaluation of the declared rules.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from framework._internal.schema import _declared_row_checks, evaluate_rules
from framework.core.dataset import Dataset


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
    """Partition rows by the content rules declared on a Case Type schema.

    Both ``ValueRule`` annotations (Pattern, Length, Unique, OneOf — *vertical*,
    one column) and ``RowCheck``s (*horizontal*, the relationship between a row's
    fields) are applied; structural concerns (missing columns, wrong dtypes) are
    the ``SchemaValidator``'s domain and still abort. A row that violates any rule
    or check lands in rejected with all its breach descriptions joined; a row that
    violates none lands in good.

    A rule whose column is **absent** does not run — the same skip the validator
    makes. There is no row to route aside for a column that does not exist, and
    the missing column is a structural breach the ``SchemaValidator`` placed
    ahead of this node reports and aborts on.
    """

    def __init__(self, schema: type) -> None:
        self._schema = schema
        self._row_checks = _declared_row_checks(schema)

    def partition(self, dataset: Dataset) -> tuple[Dataset, Dataset]:
        frame = dataset.to_pandas()

        # Reasons accumulate **by row position**, never by index label. Index
        # labels may repeat once frames have been concatenated behind the
        # Dataset seam, and keying by label would merge two distinct rows'
        # reasons and then select the wrong rows back out; a non-integer or
        # non-monotonic index compounds it.
        row_reasons: list[list[str]] = [[] for _ in range(len(frame))]

        # One shared traversal of the declared value rules: each rule is
        # consulted once for its mask and once for its phrase. The phrase
        # describes the *rule*, so it is derived before the row loop and reused
        # — a rejected row's own offending value is already beside the reason in
        # the reject table, which is what makes the reason located.
        for outcome in evaluate_rules(self._schema, frame):
            if outcome.missing_column:
                continue
            reason = f"column {outcome.column!r} {outcome.phrase}"
            for position in outcome.mask.nonzero()[0]:
                row_reasons[position].append(reason)

        # Row checks are horizontal but quarantine like value rules: each
        # breaching row's phrase joins the same per-row reasons. The footprint
        # guard skips a check when a spanned column is absent (mirrors the
        # missing-column skip the shared traversal applies); the check sees
        # every row, nulls included.
        for rc in self._row_checks:
            if any(col not in frame.columns for col in rc.columns):
                continue
            for position, (_, row) in enumerate(frame.iterrows()):
                phrase = rc.check(row)
                if phrase is not None:
                    row_reasons[position].append(phrase)

        bad = [i for i, reasons in enumerate(row_reasons) if reasons]
        good = [i for i, reasons in enumerate(row_reasons) if not reasons]

        good_frame = frame.iloc[good].reset_index(drop=True)
        rejected_frame = frame.iloc[bad].copy().reset_index(drop=True)
        rejected_frame["failed_rule"] = ["; ".join(row_reasons[i]) for i in bad]

        return Dataset.from_pandas(good_frame), Dataset.from_pandas(rejected_frame)

```
