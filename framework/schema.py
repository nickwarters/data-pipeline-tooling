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
as a Reader/Writer/processor does (ADR-0002).

``SchemaValidator`` also runs **value-level rules** (#24) — ``Pattern`` / ``Length``
/ ``Unique`` / ``OneOf``, attached to a field via ``Annotated[type, Rule(...)]`` so
the dataclass annotations stay the single source of truth they extend. The rules
check column *contents* (format, length, uniqueness, membership) on the same
engine-confined seam as the dtype check, and their breaches join the dtype
breaches in the validator's one located message.
"""

from __future__ import annotations

import re
from dataclasses import fields
from datetime import date, datetime
from typing import Callable, Protocol, get_type_hints, runtime_checkable

import pandas as pd
from pandas.api import types as pdt

from framework.dataset import Dataset
from framework.processors import CoercionError
from framework.validators import ValidationError

# Cap on how many offending values a breach message lists, so a column that is
# wrong in thousands of rows still produces one readable located message rather
# than dumping the frame (ADR-0007: a breach names the problem, not every row).
_SAMPLE_LIMIT = 5


@runtime_checkable
class ValueRule(Protocol):
    """A value-level expectation attached to a schema field via ``Annotated``.

    Where the columns+dtypes contract checks a column's *shape*, a value rule
    checks its *contents* — format, length, uniqueness, membership. Rules are
    declared on the same Case Type dataclass (``Annotated[type, Rule(...)]``) so
    the annotations stay the single source of truth (ADR-0008), and run on the
    same engine-confined seam as the dtype check: each is handed the column's
    pandas Series directly. A rule returns ``None`` when satisfied, else a short
    phrase describing the breach (the column name is prefixed by the validator).
    """

    def check(self, series: "pd.Series") -> str | None:
        """Return a breach phrase if ``series`` breaks the rule, else ``None``."""
        ...


def _sample(values: "pd.Series") -> str:
    """Format up to ``_SAMPLE_LIMIT`` offending values for a breach message.

    Sorted for a deterministic message and capped so a wholly-wrong column is
    still diagnosable in one line; a trailing ``...`` marks an elided remainder.
    """
    offenders = sorted(set(values.astype(str)))
    shown = ", ".join(repr(v) for v in offenders[:_SAMPLE_LIMIT])
    if len(offenders) > _SAMPLE_LIMIT:
        shown += ", ..."
    return shown


class Pattern:
    """Require every (non-null) value to fully match a regular expression.

    The format check of the issue's worked example — an id that must be 9-10
    numeric characters rejects letters and 11+ chars. The regex compiles at
    construction so a malformed pattern fails where the schema is composed, not
    mid-run (mirroring the validator's unsupported-dtype guard). Null values are
    out of scope — nullability is a separate concern.
    """

    def __init__(self, pattern: str) -> None:
        self._source = pattern
        self._regex = re.compile(pattern)  # fail-fast on a malformed pattern

    def check(self, series: "pd.Series") -> str | None:
        present = series.dropna()
        matched = present.astype("string").str.fullmatch(self._regex)
        breaches = present[~matched.fillna(False)]
        if not breaches.empty:
            return f"violates pattern {self._source!r} (e.g. {_sample(breaches)})"
        return None


class Length:
    """Require every (non-null) value's string length to sit in ``[min, max]``.

    Either bound is optional — ``minimum`` guards against a truncated value,
    ``maximum`` against an overlong one; ``None`` leaves that side open (mirroring
    :class:`~framework.validators.RowCountValidator`'s inclusive bounds). A
    contradictory pair (min > max) is a configuration error raised at
    construction. Null values are out of scope.
    """

    def __init__(
        self, minimum: int | None = None, maximum: int | None = None
    ) -> None:
        if minimum is None and maximum is None:
            raise ValueError("Length requires at least one of minimum / maximum")
        if minimum is not None and maximum is not None and minimum > maximum:
            raise ValueError(
                f"Length minimum {minimum} exceeds maximum {maximum}"
            )
        self._minimum = minimum
        self._maximum = maximum

    def check(self, series: "pd.Series") -> str | None:
        present = series.dropna()
        lengths = present.astype("string").str.len()
        too_short = lengths < self._minimum if self._minimum is not None else False
        too_long = lengths > self._maximum if self._maximum is not None else False
        breaches = present[too_short | too_long]
        if not breaches.empty:
            lo = self._minimum if self._minimum is not None else ""
            hi = self._maximum if self._maximum is not None else ""
            return f"length not in [{lo}, {hi}] (e.g. {_sample(breaches)})"
        return None


class Unique:
    """Require a field's (non-null) values to be distinct — no duplicate keys.

    The field-annotation form of uniqueness, sitting beside the columns+dtypes
    contract. It complements :class:`~framework.validators.UniqueValidator`,
    which enforces the one-row-per-Case *grain* on a (possibly composite) key at
    the gold boundary (ADR-0009); this rule states the expectation declaratively
    on the schema field itself. Null values are out of scope, so repeated missing
    values are not flagged as duplicates.
    """

    def check(self, series: "pd.Series") -> str | None:
        present = series.dropna()
        dupes = present[present.duplicated(keep=False)]
        if not dupes.empty:
            return f"has duplicate value(s): {_sample(dupes)}"
        return None


class OneOf:
    """Require every (non-null) value to be a member of an allowed set.

    The value-set / encoding rule: a status restricted to ``"open"``/``"closed"``,
    or a flag restricted to a known encoding. An empty set can never be satisfied
    and is rejected at construction. Null values are out of scope.
    """

    def __init__(self, *allowed: object) -> None:
        if not allowed:
            raise ValueError("OneOf requires at least one allowed value")
        self._allowed = set(allowed)

    def check(self, series: "pd.Series") -> str | None:
        present = series.dropna()
        breaches = present[~present.isin(self._allowed)]
        if not breaches.empty:
            allowed = ", ".join(sorted(repr(v) for v in self._allowed))
            return f"has value(s) outside {{{allowed}}}: {_sample(breaches)}"
        return None


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


def _unwrap(hint: object) -> tuple[type, tuple[object, ...]]:
    """Split an ``Annotated[type, *rules]`` hint into ``(base type, metadata)``.

    A plain annotation passes through with empty metadata, so the columns+dtypes
    path from #7 is untouched; an ``Annotated`` field yields its underlying type
    (for the dtype check) and the attached value rules (``__metadata__``).
    """
    if hasattr(hint, "__metadata__"):
        return hint.__origin__, hint.__metadata__  # type: ignore[attr-defined]
    return hint, ()  # type: ignore[return-value]


def _declared_fields(schema: type) -> list[tuple[str, type]]:
    """Return a schema's ``(column, declared type)`` pairs, in declaration order.

    Resolves postponed (string) annotations to their types: the framework uses
    ``from __future__ import annotations``, so ``fields(...).type`` is a string;
    ``get_type_hints`` evaluates each against the schema's own module. Any
    ``Annotated`` value-rule metadata is stripped to the base type here, so the
    validator's dtype check and the coercer keep seeing plain Python types. The
    single place the dataclass→column/type reading lives.
    """
    hints = get_type_hints(schema, include_extras=True)
    return [(f.name, _unwrap(hints[f.name])[0]) for f in fields(schema)]


def _declared_rules(schema: type) -> list[tuple[str, list[ValueRule]]]:
    """Return a schema's ``(column, [value rules])`` pairs for fields that have any.

    The companion of :func:`_declared_fields` for the value-level contract: it
    reads the ``Annotated`` metadata off each field, keeping only the
    :class:`ValueRule` entries (other annotations, if any, are ignored).
    """
    hints = get_type_hints(schema, include_extras=True)
    declared: list[tuple[str, list[ValueRule]]] = []
    for f in fields(schema):
        rules = [m for m in _unwrap(hints[f.name])[1] if isinstance(m, ValueRule)]
        if rules:
            declared.append((f.name, rules))
    return declared


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
        self._rules = _declared_rules(schema)
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
        ill_typed: set[str] = set()
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
                ill_typed.add(name)
        # Value rules run on the same engine-confined frame, but only over columns
        # that are present and carry the declared dtype — a wrong-typed column's
        # dtype breach is the prior problem to fix, and running e.g. a string rule
        # over it would report a spurious second failure. Every breach still lands
        # in the one located message alongside the shape problems.
        for name, rules in self._rules:
            if name not in present or name in ill_typed:
                continue
            for rule in rules:
                breach = rule.check(frame[name])
                if breach is not None:
                    problems.append(f"column {name!r} {breach}")
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
