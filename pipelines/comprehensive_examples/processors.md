```python
"""Pipeline-local processors for the comprehensive example.

These transforms are intentionally kept beside the concrete pipeline because
they encode report-specific aggregation, not reusable framework behavior.
"""

from __future__ import annotations

from .rules import high_risk_or_vulnerable


class AddOpenContactCounts:
    """Join an aggregate from the open-contact detail table onto case rows."""

    def __init__(self, contacts_reader) -> None:
        self._contacts = contacts_reader

    def __call__(self, dataset):
        cases = dataset.to_pandas()
        contacts = self._contacts.read().to_pandas()
        counts = (
            contacts.groupby("case_ref")
            .size()
            .rename("open_contact_count")
            .reset_index()
        )
        joined = cases.merge(counts, on="case_ref", how="left")
        joined["open_contact_count"] = (
            joined["open_contact_count"].fillna(0).astype("int64")
        )
        return type(dataset).from_pandas(joined)


class AdviserSummary:
    """Aggregate selected case rows to one reporting row per adviser."""

    def __call__(self, dataset):
        frame = dataset.to_pandas()
        selected = frame.loc[frame.apply(high_risk_or_vulnerable, axis=1)]
        summary = (
            selected.groupby(["adviser_id", "region"], as_index=False)
            .agg(
                selected_cases=("case_ref", "count"),
                total_exposure=("exposure_amount", "sum"),
                total_open_contacts=("open_contact_count", "sum"),
            )
            .sort_values(["adviser_id", "region"])
            .reset_index(drop=True)
        )
        return type(dataset).from_pandas(summary)

```
