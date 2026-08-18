"""SchemaCoercion: cast a dataset's columns to a schema's declared types.

The *coerce* half of the schema adapter, and the write-side companion of
:class:`~framework.core.schema.SchemaValidator`: where the validator *checks*
dtypes, this *repairs* them, casting every declared column whose dtype the
validator would not already accept — ``date`` / ``datetime`` / ``bool``, which
storage loses outright, and ``str`` / ``int`` / ``float``, which a reader's type
inference is free to land as something else. A field can also declare its own
cast with ``Annotated[T, Coerce(fn)]``, which is both the seam for a type the
framework has no arm for and an override for one it does. It lives in
``framework.transform`` because it reshapes a column's values rather than gating
them; it shares the dataclass-annotation reading with the validator via
:mod:`framework._internal.schema`.

It is **engine-confined**: it reaches the backing frame via ``to_pandas()``
exactly as a Reader/Writer/processor does.
"""

from __future__ import annotations

from dataclasses import fields
from datetime import date, datetime

import pandas as pd
from pandas.api import types as pdt

from framework._internal.schema import (
    _DTYPE_CHECKS,
    _declared_fields,
    _resolved_hints,
    _unwrap,
)
from framework.core.dataset import Dataset
from framework.core.value_rules import Coerce
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


def _declared_casts(schema: type) -> dict[str, Coerce]:
    """Return the ``Coerce`` marker each field declares, for the fields that do.

    The coercion-side companion of the validator's declaration readers: it keeps
    only the ``Coerce`` entries off each field's ``Annotated`` metadata (value
    rules and the nullability markers are read elsewhere, by the validator).
    """
    hints = _resolved_hints(schema)
    declared: dict[str, Coerce] = {}
    for f in fields(schema):
        markers = [m for m in _unwrap(hints[f.name])[1] if isinstance(m, Coerce)]
        if markers:
            declared[f.name] = markers[-1]
    return declared


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

    A field carrying ``Annotated[T, Coerce(fn)]`` is cast by ``fn`` instead —
    the seam for a declared type the framework knows no cast for, and an
    override where it does.

    A gap is the absence of a value, never a bad one: it is excluded from every
    offender report and left for the validator, which owns nullability. A value
    that cannot be cast aborts the step with a located
    :class:`~framework.transform.processors.CoercionError` rather than being
    nulled away.
    """

    def __init__(self, schema: type) -> None:
        self._schema = schema
        self._expected = _declared_fields(schema)
        self._casts = _declared_casts(schema)

    def __call__(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        for name, declared in self._expected:
            if name not in frame.columns:
                continue  # a missing column is the validator's breach to report
            marker = self._casts.get(name)
            if marker is not None:
                frame[name] = self._declared_cast(marker, frame[name], name)
            elif declared in (date, datetime):
                frame[name] = self._to_datetime(frame[name], name)
            elif declared is bool:
                frame[name] = self._to_bool(frame[name], name)
            elif declared in (str, int, float):
                # Asking the validator's own dtype check whether the column
                # already satisfies the declaration keeps the two halves from
                # drifting: what it accepts is exactly what is left alone. The
                # lossy types above are not guarded this way — a datetime64
                # column can still hold the wrong instant, and a numeric bool
                # the wrong encoding.
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
        # loudly. A source spelling dates any other way declares its own cast.
        try:
            return pd.to_datetime(series, format="ISO8601")
        except (ValueError, TypeError) as exc:
            raise self._error(name, f"not a parseable date ({exc})") from exc

    def _to_text(self, series: "pd.Series") -> "pd.Series":
        # A whole-number column with any blank cell cannot be held as an integer,
        # so pandas widens it to float64 and `1234567890` would stringify as
        # "1234567890.0". The Int64 detour undoes that widening first. It is
        # deliberately column-level: one genuinely fractional value anywhere and
        # the cast is refused for the whole column, which keeps the ".0" on its
        # whole numbers — a simpler rule than a per-value repair, and one that
        # never renders a fraction as something it is not.
        if pdt.is_float_dtype(series.dtype):
            try:
                series = series.astype("Int64")
            except (TypeError, ValueError, OverflowError):
                pass  # a fraction or an infinity: render the values as they are
        # Never raises, whatever the column holds — a feed that would rather
        # carry an awkward value as text than abort declares `str` for exactly
        # this reason.
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
        unrecognized = series[mapped.isna() & ~self._missing(series)]
        if len(unrecognized):
            joined = self._offenders(unrecognized)
            raise self._error(name, f"unrecognized boolean encoding(s): {joined}")
        # pandas' nullable "boolean", not numpy `bool`: the latter has no null,
        # so a gap would have to be invented as False. The validator's bool
        # dtype check accepts both, and a non-nullable declaration is then
        # reported as the nullability breach it is rather than a bad encoding.
        return mapped.astype("boolean")

    def _declared_cast(
        self, marker: Coerce, series: "pd.Series", name: str
    ) -> "pd.Series":
        # Only these two: anything else out of a caller's cast is a bug in the
        # cast, and keeps its own traceback rather than being dressed up as a
        # problem with the data.
        try:
            return marker.cast(series)
        except (TypeError, ValueError) as exc:
            raise self._error(name, f"declared coercion failed ({exc})") from exc

    @staticmethod
    def _missing(series: "pd.Series") -> "pd.Series":
        """Mask the gaps: a null, or text that is empty or only whitespace.

        A gap is the absence of a value, not a bad one, so it is excluded from
        every offender report and left to the validator, which owns nullability.
        A blank cell counts as a gap for the numeric and boolean paths — it is
        how a CSV spells "nothing here" — but never for `str`, where the empty
        string is a value in its own right.
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
