"""The declared-schema value rules — a field's *contents* contract.

Value-level expectations attached to a Case Type schema field via
``Annotated[type, Rule(...)]``: format (``Pattern``), length (``Length``),
uniqueness (``Unique``), membership (``OneOf``), and the nullability markers
(``Nullable`` / ``NonNull``). They are read off the dataclass annotations and run
by :class:`~framework.core.schema.SchemaValidator`, and the masks they
produce drive the quarantine partitioner. Each satisfies the
:class:`~framework._internal.schema.ValueRule` protocol structurally.

Authoring a rule is an **engine-confined** act: a rule is handed the column's
pandas Series directly, because judging thousands of values one at a time
without the engine's vectorised operations would be unusably slow. The five
rules here share :class:`ValueRuleBase`, which owns the one null guard and the
one mask construction; a rule is then just "which present values breach" plus
"how to phrase it". The protocol stays structural, so a rule that implements the
two methods and inherits nothing is still a value rule.

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


class ValueRuleBase:
    """Shared scaffolding for a value rule: null handling, masking, ``check``.

    A subclass says only two things: which of the **present** values breach
    (:meth:`_violates`) and how to phrase the breach (:meth:`_phrase`). The null
    guard — nulls are out of scope for every value rule, because nullability is
    the separate ``Nullable``/``NonNull`` contract — and the mask construction
    live here once, so the five rules cannot drift apart and a fix to either
    lands in one place.

    Two properties of the mask are load-bearing for the callers:

    - It is built **positionally**, from a boolean array over the rows, never by
      assigning at index labels. A frame whose index labels repeat (an ordinary
      outcome of concatenating two frames behind the ``Dataset`` seam) would
      otherwise either raise on the label assignment or silently mask the wrong
      rows.
    - Its dtype is plain (numpy) ``bool``, never pandas' *nullable* ``boolean``.
      Comparisons over a nullable column produce nullable booleans, and a mask
      carrying ``pd.NA`` breaks the row selection the validator and the
      quarantine partitioner do with it. Any nullable result is narrowed here.

    Inheriting is a convenience, not a requirement: the ``ValueRule`` contract is
    a structural protocol, so a rule that implements ``check`` and
    ``violating_mask`` itself is equally a value rule.
    """

    # How a breach message presents its offending sample. Rules that read as a
    # statement about the column ("has duplicate value(s)") list the sample after
    # a colon; rules that name an expectation ("violates pattern ...") introduce
    # it as an example.
    _EVIDENCE = " (e.g. {sample})"

    def violating_mask(self, series: "pd.Series") -> "pd.Series":
        """Return a plain-``bool`` mask: True where a present value breaches."""
        present = series.notna().to_numpy()
        mask = pd.Series(False, index=series.index)
        if present.any():
            breaches = self._violates(series[present])
            mask[present] = breaches.fillna(False).to_numpy(dtype=bool)
        return mask

    def check(self, series: "pd.Series") -> str | None:
        """Return a breach phrase if ``series`` breaks the rule, else ``None``."""
        breaches = series[self.violating_mask(series).to_numpy()]
        if breaches.empty:
            return None
        return self._phrase() + self._EVIDENCE.format(sample=_sample(breaches))

    def _violates(self, present: "pd.Series") -> "pd.Series":
        """Return a boolean Series over ``present`` — the non-null values only."""
        raise NotImplementedError

    def _phrase(self) -> str:
        """Return the breach phrase, without the offending sample."""
        raise NotImplementedError


class Nullable:
    """Declare that a schema field may contain null values.

    Plain schema fields are nullable by default for compatibility; this marker
    makes that contract explicit alongside value rules in ``Annotated``.
    """


class NonNull:
    """Declare that a schema field must not contain null values."""


class Pattern(ValueRuleBase):
    """Require every (non-null) value to fully match a regular expression.

    The regex compiles at construction so a malformed pattern fails where the
    schema is composed, not mid-run. Null values are out of scope: nullability is
    a separate concern.
    """

    def __init__(self, pattern: str) -> None:
        self._source = pattern
        self._regex = re.compile(pattern)  # fail-fast on a malformed pattern

    def _violates(self, present: "pd.Series") -> "pd.Series":
        return ~present.astype("string").str.fullmatch(self._regex).fillna(False)

    def _phrase(self) -> str:
        return f"violates pattern {self._source!r}"


class Length(ValueRuleBase):
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

    def _violates(self, present: "pd.Series") -> "pd.Series":
        lengths = present.astype("string").str.len()
        too_short = lengths < self._minimum if self._minimum is not None else False
        too_long = lengths > self._maximum if self._maximum is not None else False
        return too_short | too_long

    def _phrase(self) -> str:
        lo = self._minimum if self._minimum is not None else ""
        hi = self._maximum if self._maximum is not None else ""
        return f"length not in [{lo}, {hi}]"


class Range(ValueRuleBase):
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

    def _violates(self, present: "pd.Series") -> "pd.Series":
        too_low = present < self._minimum if self._minimum is not None else False
        too_high = present > self._maximum if self._maximum is not None else False
        return too_low | too_high

    def _phrase(self) -> str:
        lo = self._minimum if self._minimum is not None else ""
        hi = self._maximum if self._maximum is not None else ""
        return f"value not in [{lo}, {hi}]"


class Unique(ValueRuleBase):
    """Require a field's (non-null) values to be distinct — no duplicate keys.

    The field-annotation form of uniqueness, sitting beside the columns+dtypes
    contract. It complements :class:`~framework.core.validators.UniqueValidator`,
    which enforces the one-row-per-Case *grain* on a (possibly composite) key at
    the gold boundary; this rule states the expectation declaratively on the
    schema field itself. Null values are out of scope, so repeated missing values
    are not flagged as duplicates.
    """

    _EVIDENCE = ": {sample}"

    def _violates(self, present: "pd.Series") -> "pd.Series":
        return present.duplicated(keep=False)

    def _phrase(self) -> str:
        return "has duplicate value(s)"


class OneOf(ValueRuleBase):
    """Require every (non-null) value to be a member of an allowed set.

    The value-set / encoding rule: a status restricted to ``"open"``/``"closed"``,
    or a flag restricted to a known encoding. An empty set can never be satisfied
    and is rejected at construction. Null values are out of scope.
    """

    _EVIDENCE = ": {sample}"

    def __init__(self, *allowed: object) -> None:
        if not allowed:
            raise ValueError("OneOf requires at least one allowed value")
        self._allowed = set(allowed)

    def _violates(self, present: "pd.Series") -> "pd.Series":
        return ~present.isin(self._allowed)

    def _phrase(self) -> str:
        allowed = ", ".join(sorted(repr(v) for v in self._allowed))
        return f"has value(s) outside {{{allowed}}}"
