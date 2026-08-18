"""SchemaCoercion: cast a dataset's columns to a schema's declared types.

The *coerce* half of the schema adapter, and the write-side companion of
:class:`~framework.core.schema.SchemaValidator`: where the validator *checks*
dtypes, this *repairs* them, casting each declared column whose dtype the
validator would not already accept — ``date`` / ``datetime`` / ``bool``, which
storage loses outright, and ``str`` / ``int`` / ``float``, which a reader's type
inference is free to land as something else. It lives in
``framework.transform`` because it reshapes a column's values rather than gating
them; it shares the dataclass-annotation reading with the validator via
:mod:`framework._internal.schema`.

It is **engine-confined**: it reaches the backing frame via ``to_pandas()``
exactly as a Reader/Writer/processor does.
"""

from __future__ import annotations

from datetime import date, datetime

import pandas as pd
from pandas.api import types as pdt

from framework._internal.schema import _DTYPE_CHECKS, _declared_fields
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


class SchemaCoercion:
    """Cast a dataset's columns to a Case Type schema's declared types.

    The write-side companion of
    :class:`~framework.core.schema.SchemaValidator`: where the validator
    *checks* dtypes, this repairs them ahead of it, so a column arrives at the
    silver boundary carrying what the schema declared rather than what the
    source happened to encode. ``date`` / ``datetime`` land as text out of
    storage and ``bool`` as ``1``/``0`` or ``TRUE``/``FALSE``; a digits-only
    reference a CSV reader inferred as ``int64`` is cast back to text, and
    numeric text to the declared number. A column whose dtype the validator
    would already accept is left exactly as it is.

    A gap is the absence of a value, never a bad one: it is excluded from every
    offender report and left for the validator, which owns nullability. A value
    that cannot be cast aborts the step with a located
    :class:`~framework.transform.processors.CoercionError` rather than being
    nulled away.
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
            elif declared in (str, int, float):
                # Asking the validator's own dtype check what to leave alone
                # keeps the two halves of the adapter from drifting apart.
                if _DTYPE_CHECKS[declared][0](frame[name].dtype):
                    continue
                frame[name] = (
                    self._to_text(frame[name])
                    if declared is str
                    else self._to_number(frame[name], name, declared)
                )
        return Dataset.from_pandas(frame)

    def _to_datetime(self, series: "pd.Series", name: str) -> "pd.Series":
        # format="ISO8601", not inference: bare pd.to_datetime infers one format
        # from the first non-null value and then rejects every other spelling of
        # the same ISO instant, so a batch mixing `...T09:00:00Z` with
        # `...T09:00:00.000Z` — both real in this system — would abort the hop,
        # intermittently, as a function of which rows share a batch. A value
        # that is not ISO-8601 at all still raises: turning it into a null
        # (errors="coerce") would silently lose it, which is worse than failing
        # loudly.
        try:
            return pd.to_datetime(series, format="ISO8601")
        except (ValueError, TypeError) as exc:
            raise self._error(name, f"not a parseable date ({exc})") from exc

    def _to_text(self, series: "pd.Series") -> "pd.Series":
        # A whole-number column with any blank cell cannot be held as an integer,
        # so pandas widens it to float64 and `1234567890` would stringify as
        # "1234567890.0". The Int64 detour undoes that widening first, and is
        # refused for the whole column when any one value resists it.
        if pdt.is_float_dtype(series.dtype):
            try:
                series = series.astype("Int64")
            except (TypeError, ValueError, OverflowError):
                pass  # a fraction or an infinity: render the values as they are
        return series.astype("str")

    def _to_number(self, series: "pd.Series", name: str, declared: type) -> "pd.Series":
        numeric = pd.to_numeric(series, errors="coerce")
        missing = self._missing(series)
        unparseable = series[numeric.isna() & ~missing]
        if len(unparseable):
            joined = self._offenders(unparseable)
            raise self._error(name, f"not parseable as {declared.__name__}: {joined}")
        if declared is float:
            return numeric.astype("float64")
        # `pd.to_numeric` hands back float64, in which a gap is NaN — and `NaN %
        # 1` is NaN, which compares unequal to 0. Without masking the gaps out,
        # every null in the column would be reported as a fractional value.
        fractional = series[(numeric % 1 != 0) & ~missing]
        if len(fractional):
            joined = self._offenders(fractional)
            raise self._error(name, f"not representable as int: {joined}")
        # Nullable "Int64", not numpy int64: a column with a gap cannot be held
        # as the latter, so the gap would have to be invented as a zero.
        # Nullability is the validator's question, exactly as for `bool`.
        try:
            return numeric.astype("Int64")
        except (TypeError, ValueError) as exc:
            raise self._error(name, f"not representable as int ({exc})") from exc

    def _to_bool(self, series: "pd.Series", name: str) -> "pd.Series":
        normalized = series.astype("string").str.strip().str.upper()
        mapped = normalized.map(_BOOL_ENCODINGS)
        # `_missing` inlined: `normalized` is already the stripped text it would
        # recompute, so the bool path makes one pass over the column, not two.
        missing = normalized.isna() | normalized.eq("")
        unrecognized = series[mapped.isna() & ~missing]
        if len(unrecognized):
            joined = self._offenders(unrecognized)
            raise self._error(name, f"unrecognized boolean encoding(s): {joined}")
        # pandas' nullable "boolean", not numpy `bool`: the latter has no null,
        # so a gap would have to be invented as False. The validator's bool
        # dtype check accepts both, and a non-nullable declaration is then
        # reported as the nullability breach it is rather than a bad encoding.
        return mapped.astype("boolean")

    @staticmethod
    def _missing(series: "pd.Series") -> "pd.Series":
        """Mask a numeric column's gaps — a null, or blank text.

        Never for `str`, where the empty string is a value in its own right.
        """
        return series.isna() | series.astype("string").str.strip().eq("").fillna(False)

    @staticmethod
    def _offenders(values: "pd.Series") -> str:
        """Format a column's offending values for a failure message.

        Plain `str`, not pandas "string", so any remaining source value stays
        sortable rather than letting pd.NA reach sorted() and raise.
        """
        return ", ".join(repr(v) for v in sorted(set(values.astype(str))))

    def _error(self, name: str, detail: str) -> CoercionError:
        # Name the schema, column, and reason so an aborted coerce step diagnoses
        # itself.
        return CoercionError(
            f"{self._schema.__name__} coercion: column {name!r} {detail}"
        )
