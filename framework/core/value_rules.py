"""The declared-schema value rules — a field's *contents* contract.

Value-level expectations attached to a Case Type schema field via
``Annotated[type, Rule(...)]``: format (``Pattern``), length (``Length``),
uniqueness (``Unique``), membership (``OneOf``), and the nullability markers
(``Nullable`` / ``NonNull``). They are read off the dataclass annotations and run
by :class:`~framework.core.schema.SchemaValidator`, and the masks they
produce drive the quarantine partitioner. Each satisfies the
:class:`~framework._internal.schema.ValueRule` protocol structurally.

Re-exported from :mod:`framework.core`.
"""

from __future__ import annotations

import re

import pandas as pd

# Cap on how many offending values a breach message lists, so a column that is
# wrong in thousands of rows still produces one readable located message rather
# than dumping the frame.
_SAMPLE_LIMIT = 5


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


class Nullable:
    """Declare that a schema field may contain null values.

    Plain schema fields are nullable by default for compatibility; this marker
    makes that contract explicit alongside value rules in ``Annotated``.
    """


class NonNull:
    """Declare that a schema field must not contain null values."""


class Pattern:
    """Require every (non-null) value to fully match a regular expression.

    The regex compiles at construction so a malformed pattern fails where the
    schema is composed, not mid-run. Null values are out of scope: nullability is
    a separate concern.
    """

    def __init__(self, pattern: str) -> None:
        self._source = pattern
        self._regex = re.compile(pattern)  # fail-fast on a malformed pattern

    def violating_mask(self, series: "pd.Series") -> "pd.Series":
        mask = pd.Series(False, index=series.index)
        present_idx = series.dropna().index
        if len(present_idx):
            matched = series[present_idx].astype("string").str.fullmatch(self._regex)
            mask.loc[present_idx] = ~matched.fillna(False)
        return mask

    def check(self, series: "pd.Series") -> str | None:
        breaches = series[self.violating_mask(series)]
        if not breaches.empty:
            return f"violates pattern {self._source!r} (e.g. {_sample(breaches)})"
        return None


class Length:
    """Require every (non-null) value's string length to sit in ``[min, max]``.

    Either bound is optional — ``minimum`` guards against a truncated value,
    ``maximum`` against an overlong one; ``None`` leaves that side open (mirroring
    :class:`~framework.core.validators.RowCountValidator`'s inclusive bounds). A
    contradictory pair (min > max) is a configuration error raised at
    construction. Null values are out of scope.
    """

    def __init__(self, minimum: int | None = None, maximum: int | None = None) -> None:
        if minimum is None and maximum is None:
            raise ValueError("Length requires at least one of minimum / maximum")
        if minimum is not None and maximum is not None and minimum > maximum:
            raise ValueError(f"Length minimum {minimum} exceeds maximum {maximum}")
        self._minimum = minimum
        self._maximum = maximum

    def violating_mask(self, series: "pd.Series") -> "pd.Series":
        mask = pd.Series(False, index=series.index)
        present_idx = series.dropna().index
        if len(present_idx):
            lengths = series[present_idx].astype("string").str.len()
            too_short = (
                lengths < self._minimum
                if self._minimum is not None
                else pd.Series(False, index=present_idx)
            )
            too_long = (
                lengths > self._maximum
                if self._maximum is not None
                else pd.Series(False, index=present_idx)
            )
            mask.loc[present_idx] = too_short | too_long
        return mask

    def check(self, series: "pd.Series") -> str | None:
        breaches = series[self.violating_mask(series)]
        if not breaches.empty:
            lo = self._minimum if self._minimum is not None else ""
            hi = self._maximum if self._maximum is not None else ""
            return f"length not in [{lo}, {hi}] (e.g. {_sample(breaches)})"
        return None


class Range:
    """Require every (non-null) value to sit in the closed interval ``[min, max]``.

    The numeric counterpart to :class:`Length`: where ``Length`` bounds a value's
    string length, ``Range`` bounds the value itself — a count that can't go
    negative, an amount with a known ceiling, a rate confined to ``[0, 1]``.
    Either bound is optional — ``minimum`` guards against an under-range value,
    ``maximum`` against an over-range one; ``None`` leaves that side open
    (mirroring :class:`~framework.core.validators.RowCountValidator`'s
    inclusive bounds). A contradictory pair (min > max) is a configuration error
    raised at construction. Null values are out of scope.

    The dtype check runs first, so by the time this rule sees the column its
    values are already numeric and compare directly.
    """

    def __init__(
        self,
        minimum: float | None = None,
        maximum: float | None = None,
    ) -> None:
        if minimum is None and maximum is None:
            raise ValueError("Range requires at least one of minimum / maximum")
        if minimum is not None and maximum is not None and minimum > maximum:
            raise ValueError(f"Range minimum {minimum} exceeds maximum {maximum}")
        self._minimum = minimum
        self._maximum = maximum

    def violating_mask(self, series: "pd.Series") -> "pd.Series":
        mask = pd.Series(False, index=series.index)
        present_idx = series.dropna().index
        if len(present_idx):
            values = series[present_idx]
            too_low = (
                values < self._minimum
                if self._minimum is not None
                else pd.Series(False, index=present_idx)
            )
            too_high = (
                values > self._maximum
                if self._maximum is not None
                else pd.Series(False, index=present_idx)
            )
            mask.loc[present_idx] = too_low | too_high
        return mask

    def check(self, series: "pd.Series") -> str | None:
        breaches = series[self.violating_mask(series)]
        if not breaches.empty:
            lo = self._minimum if self._minimum is not None else ""
            hi = self._maximum if self._maximum is not None else ""
            return f"value not in [{lo}, {hi}] (e.g. {_sample(breaches)})"
        return None


class Unique:
    """Require a field's (non-null) values to be distinct — no duplicate keys.

    The field-annotation form of uniqueness, sitting beside the columns+dtypes
    contract. It complements :class:`~framework.core.validators.UniqueValidator`,
    which enforces the one-row-per-Case *grain* on a (possibly composite) key at
    the gold boundary; this rule states the expectation declaratively on the
    schema field itself. Null values are out of scope, so repeated missing values
    are not flagged as duplicates.
    """

    def violating_mask(self, series: "pd.Series") -> "pd.Series":
        mask = pd.Series(False, index=series.index)
        present = series.dropna()
        if not present.empty:
            mask.loc[present.index] = present.duplicated(keep=False)
        return mask

    def check(self, series: "pd.Series") -> str | None:
        dupes = series[self.violating_mask(series)]
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

    def violating_mask(self, series: "pd.Series") -> "pd.Series":
        mask = pd.Series(False, index=series.index)
        present = series.dropna()
        if not present.empty:
            mask.loc[present.index] = ~present.isin(self._allowed)
        return mask

    def check(self, series: "pd.Series") -> str | None:
        breaches = series[self.violating_mask(series)]
        if not breaches.empty:
            allowed = ", ".join(sorted(repr(v) for v in self._allowed))
            return f"has value(s) outside {{{allowed}}}: {_sample(breaches)}"
        return None
