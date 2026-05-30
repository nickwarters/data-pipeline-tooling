"""Schema enforcement — the dataclass→{validator, coercer} adapter (ADR-0008).

A Case Type's **schema** is declared as an ordinary dataclass whose annotations
*are* the contract: each field is a column name and its declared Python type.
Two adapters are derived from those annotations, sharing the one Python-type ↔
pandas knowledge this module owns:

- ``SchemaValidator`` *checks* a ``Dataset``'s columns + dtypes at the
  **silver** boundary (post-validator), so a missing column or wrong dtype fails
  at a predictable place with a located message — before downstream logic touches
  the data.
- ``SchemaCoercion`` *repairs* the representation raw loses to storage, casting
  the round-trip-lossy declared types (dates, booleans) ahead of that validator
  (the ``process`` step). It is the write-side companion of the validator (#23).

Unlike the structural checks in :mod:`framework.validators` (which read only the
dataset's engine-agnostic shape), both inspect/transform column *values*, so they
are **engine-confined**: they reach the backing frame via ``to_pandas()`` exactly
as a Reader/Writer/processor does (ADR-0002). Richer value-level rules (format,
uniqueness, encoding) are later validators of the same engine-confined shape;
the dataclass annotations stay the single source of truth they extend.
"""

from __future__ import annotations

from dataclasses import fields
from datetime import date, datetime
from typing import Callable, get_type_hints

import pandas as pd
from pandas.api import types as pdt

from framework.dataset import Dataset
from framework.processors import CoercionError
from framework.validators import ValidationError

# Python declared type -> (predicate over a pandas dtype, human label). The
# mapping is the seam between the dataclass contract and the concrete engine; it
# lives here, engine-confined, so the rest of the system keeps naming only
# Python types. ``date``/``datetime`` both land as datetime64 (pandas has no
# pure-date dtype); ``str`` accepts object or the string dtype.
_DTYPE_CHECKS: dict[type, tuple[Callable[[object], bool], str]] = {
    str: (pdt.is_string_dtype, "str"),
    int: (pdt.is_integer_dtype, "int"),
    float: (pdt.is_float_dtype, "float"),
    bool: (pdt.is_bool_dtype, "bool"),
    date: (pdt.is_datetime64_any_dtype, "date"),
    datetime: (pdt.is_datetime64_any_dtype, "datetime"),
}


def _declared_fields(schema: type) -> list[tuple[str, type]]:
    """Return a schema's ``(column, declared type)`` pairs, in declaration order.

    Resolves postponed (string) annotations to their types: the framework uses
    ``from __future__ import annotations``, so ``fields(...).type`` is a string;
    ``get_type_hints`` evaluates each against the schema's own module. The single
    place the dataclass→column/type reading lives, shared by the validator and
    the coercer.
    """
    hints = get_type_hints(schema)
    return [(f.name, hints[f.name]) for f in fields(schema)]


class SchemaValidator:
    """Check a dataset against a Case Type schema (a dataclass): columns + dtypes.

    Derived from the dataclass's fields — name gives the required column, the
    annotation gives the required type. Extra columns are ignored (the contract
    is the declared fields only). Reports every breach at once in one located
    message, then raises, so an abort names the full problem.
    """

    def __init__(self, schema: type) -> None:
        self._schema = schema
        self._expected = _declared_fields(schema)
        # Fail at build time on a type the adapter cannot map to a dtype, so a
        # mis-declared schema surfaces where it is composed, not mid-run.
        unsupported = [
            (name, declared)
            for name, declared in self._expected
            if declared not in _DTYPE_CHECKS
        ]
        if unsupported:
            details = "; ".join(
                f"{name!r}: {getattr(t, '__name__', t)}" for name, t in unsupported
            )
            supported = ", ".join(sorted(t.__name__ for t in _DTYPE_CHECKS))
            raise ValueError(
                f"{schema.__name__} schema declares unsupported type(s) "
                f"({details}); supported: {supported}"
            )

    def validate(self, dataset: Dataset) -> None:
        frame = dataset.to_pandas()  # engine-confined (ADR-0002)
        present = set(frame.columns)
        problems: list[str] = []
        for name, declared in self._expected:
            if name not in present:
                problems.append(f"missing column {name!r}")
                continue
            check, label = _DTYPE_CHECKS[declared]
            actual = frame[name].dtype
            if not check(actual):
                problems.append(
                    f"column {name!r} expected {label} but found {actual}"
                )
        if problems:
            raise ValidationError(
                f"{self._schema.__name__} schema: " + "; ".join(problems)
            )


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

    The write-side companion of :class:`SchemaValidator`: where the validator
    *checks* dtypes, this *repairs* the representation raw loses to storage.
    Only the types that don't survive a SQLite round-trip are cast — ``date`` /
    ``datetime`` (which land as text); ``str`` / ``int`` / ``float`` survive
    storage and pass through untouched, so the validator stays their gate.
    """

    def __init__(self, schema: type) -> None:
        self._schema = schema
        self._expected = _declared_fields(schema)

    def process(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas().copy()  # engine-confined (ADR-0002)
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
        # One located message per ADR-0007: name the schema, the column, the
        # reason — so an aborted coerce step diagnoses itself.
        return CoercionError(
            f"{self._schema.__name__} coercion: column {name!r} {detail}"
        )
