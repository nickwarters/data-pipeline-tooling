"""SchemaCoercion: cast a dataset's round-trip-lossy columns to a schema's types.

The *coerce* half of the schema adapter, and the write-side companion of
:class:`~framework.validate.schema.SchemaValidator`: where the validator *checks*
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
# SQLite round-trip — as TRUE/FALSE text or as 1/0 (integer, or text after a
# text-typed round-trip). Compared case-folded, so `true`/`True`/`TRUE` all map;
# 1/0 integers are stringified to "1"/"0" before lookup.
_BOOL_ENCODINGS: dict[str, bool] = {
    "TRUE": True,
    "FALSE": False,
    "1": True,
    "0": False,
}


class SchemaCoercion:
    """Cast a dataset's round-trip-lossy columns to a Case Type schema's types.

    The write-side companion of
    :class:`~framework.validate.schema.SchemaValidator`: where the validator
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
        return Dataset.from_pandas(frame)

    def _to_datetime(self, series: "pd.Series", name: str) -> "pd.Series":
        try:
            return pd.to_datetime(series)
        except (ValueError, TypeError) as exc:
            raise self._error(name, f"not a parseable date ({exc})") from exc

    def _to_bool(self, series: "pd.Series", name: str) -> "pd.Series":
        normalized = series.astype("string").str.upper()
        mapped = normalized.map(_BOOL_ENCODINGS)
        # Plain `str` (not pandas "string") keeps a null source value sortable as
        # "<NA>" rather than letting pd.NA reach sorted() and raise.
        unrecognized = sorted(set(series[mapped.isna()].astype(str)))
        if unrecognized:
            joined = ", ".join(repr(v) for v in unrecognized)
            raise self._error(name, f"unrecognized boolean encoding(s): {joined}")
        return mapped.astype("bool")

    def _error(self, name: str, detail: str) -> CoercionError:
        # Name the schema, column, and reason so an aborted coerce step diagnoses
        # itself.
        return CoercionError(
            f"{self._schema.__name__} coercion: column {name!r} {detail}"
        )
