"""SchemaCoercion: cast a dataset's round-trip-lossy columns to a schema's types.

The *coerce* half of the schema adapter, and the write-side companion of
:class:`~framework.core.schema.SchemaValidator`: where the validator *checks*
dtypes, this *repairs* the representation raw loses to storage, casting the
round-trip-lossy declared types (``date`` / ``datetime`` / ``bool``) ahead of the
validator. It lives in ``framework.transform`` because it reshapes a column's
values rather than gating them; it shares the dataclass-annotation reading with
the validator via :mod:`framework._internal.schema`.

It is **engine-confined**: it reaches the backing frame via ``to_pandas()``
exactly as a Reader/Writer/processor does.
"""

from __future__ import annotations

from datetime import date, datetime

import pandas as pd

from framework._internal.schema import _declared_fields
from framework.core.dataset import Dataset
from framework.transform.processors import CoercionError

# Boolean encodings raw can leave behind once a source's booleans survive a
# SQLite round-trip — as TRUE/FALSE text, as 1/0 (integer, or text after a
# text-typed round-trip), or as the float 1.0/0.0 a nulled numeric column comes
# back as. Y/N/YES/NO are everyday spellings in the source systems this
# framework reads. Compared case-folded and whitespace-stripped, so `true`,
# `True`, `TRUE ` all map; numbers are stringified before lookup.
_BOOL_ENCODINGS: dict[str, bool] = {
    "TRUE": True,
    "FALSE": False,
    "1": True,
    "0": False,
    "1.0": True,
    "0.0": False,
    "Y": True,
    "N": False,
    "YES": True,
    "NO": False,
}


# The dtype each round-trip-safe declared type takes on a zero-row frame, where
# there is no value to carry it. `str` lands as `object` rather than pandas'
# `string`, because that is what a populated column read back from storage
# carries — an empty table and its first rows should agree.
_EMPTY_DTYPES: dict[type, str] = {str: "object", int: "int64", float: "float64"}


class SchemaCoercion:
    """Cast a dataset's round-trip-lossy columns to a Case Type schema's types.

    The write-side companion of
    :class:`~framework.core.schema.SchemaValidator`: where the validator
    *checks* dtypes, this *repairs* the representation raw loses to storage.
    Only the types that don't survive a SQLite round-trip are cast — ``date`` /
    ``datetime`` (which land as text); ``str`` / ``int`` / ``float`` survive
    storage and pass through untouched, so the validator stays their gate.
    """

    def __init__(self, schema: type) -> None:
        self._schema = schema
        self._expected = _declared_fields(schema)

    def __call__(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        for name, declared in self._expected:
            if name not in frame.columns:
                continue  # a missing column is the validator's breach to report
            if declared in (date, datetime):
                frame[name] = self._to_datetime(frame[name], name)
            elif declared is bool:
                frame[name] = self._to_bool(frame[name], name)
            elif frame.empty:
                # No row to carry the type and no value to infer one from, so a
                # quiet window's column arrives object-typed (float64 where
                # `reindex` had to invent it). The validator lets that past —
                # there is nothing to check — but the dtype still reaches
                # storage, and an empty write is what *creates* the table, fixing
                # the column's affinity for the life of the feed. Round-trip-safe
                # types are left alone only while there are rows to make them
                # true; with none, declaring them here is the whole repair.
                frame[name] = frame[name].astype(_EMPTY_DTYPES[declared])
        return Dataset.from_pandas(frame)

    def _to_datetime(self, series: "pd.Series", name: str) -> "pd.Series":
        try:
            return pd.to_datetime(series)
        except (ValueError, TypeError) as exc:
            raise self._error(name, f"not a parseable date ({exc})") from exc

    def _to_bool(self, series: "pd.Series", name: str) -> "pd.Series":
        normalized = series.astype("string").str.strip().str.upper()
        mapped = normalized.map(_BOOL_ENCODINGS)
        # A null is not an encoding, it is the absence of one, so it is excluded
        # from the unrecognized report: whether a gap is allowed is the declared
        # value rules' question, and every other declared type already leaves it
        # to them. Plain `str` (not pandas "string") keeps any remaining source
        # value sortable rather than letting pd.NA reach sorted() and raise.
        missing = series.isna()
        unrecognized = sorted(set(series[mapped.isna() & ~missing].astype(str)))
        if unrecognized:
            joined = ", ".join(repr(v) for v in unrecognized)
            raise self._error(name, f"unrecognized boolean encoding(s): {joined}")
        # pandas' nullable "boolean", not numpy `bool`: the latter has no null,
        # so a gap would have to be invented as False. The validator's bool
        # dtype check accepts both, and a non-nullable declaration is then
        # reported as the nullability breach it is rather than a bad encoding.
        return mapped.astype("boolean")

    def _error(self, name: str, detail: str) -> CoercionError:
        # Name the schema, column, and reason so an aborted coerce step diagnoses
        # itself.
        return CoercionError(
            f"{self._schema.__name__} coercion: column {name!r} {detail}"
        )
