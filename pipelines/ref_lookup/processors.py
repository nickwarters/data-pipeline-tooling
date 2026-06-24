"""Pipeline-local processors for the ref_lookup pipeline."""

from __future__ import annotations

import hashlib

from framework.core import Dataset

REF_FIELDS = ["brand", "channel", "case_cat_1", "case_cat_2", "case_cat_3"]
SOURCE_COLUMNS = [
    "brand",
    "channel",
    "case_ref",
    "cust_ref",
    "case_cat_1",
    "case_cat_2",
    "case_cat_3",
]


def derive_ref_id(frame):
    """MD5 of 'ref_group|value' for each row — stable id for a (group, value) pair."""
    return frame.apply(
        lambda row: hashlib.md5(
            f"{row['ref_group']}|{row['value']}".encode()
        ).hexdigest(),
        axis=1,
    )


def dedup_ref(dataset: Dataset) -> Dataset:
    """Drop duplicate (ref_group, value) pairs and reset the index."""
    frame = dataset.to_pandas()
    return Dataset.from_pandas(
        frame.drop_duplicates(subset=["ref_group", "value"]).reset_index(drop=True)
    )


def dedup(dataset: Dataset) -> Dataset:
    """Drop fully duplicate rows and reset the index."""
    frame = dataset.to_pandas()
    return Dataset.from_pandas(frame.drop_duplicates().reset_index(drop=True))


class MapRefIds:
    """Add a ``{field}_id`` column for each ref field by joining against the ref table.

    For each field in ``fields``, filters the ref table where ``ref_group`` equals
    the field name, then left-joins on the field value to add ``{field}_id``.
    Rows with no matching ref entry (e.g. an empty category) receive ``None``.
    """

    def __init__(self, ref: Dataset, fields: list[str]) -> None:
        self._ref_frame = ref.to_pandas()
        self._fields = fields

    def __call__(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        for field in self._fields:
            lookup = self._ref_frame.loc[
                self._ref_frame["ref_group"] == field, ["value", "id"]
            ].rename(columns={"id": f"{field}_id"})
            frame = frame.merge(
                lookup, left_on=field, right_on="value", how="left"
            ).drop(columns=["value"])
        return Dataset.from_pandas(frame)
