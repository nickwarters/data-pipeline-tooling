```python
"""Shared schema introspection: dataclass annotations → columns / types / rules.

The value-rule-independent core both schema adapters derive from — the
:class:`~framework.core.schema.SchemaValidator` (which *checks*) and the
:class:`~framework.transform.coercion.SchemaCoercion` (which *coerces*). It owns
the one Python-type ↔ pandas-dtype mapping and the dataclass-annotation reading,
so the rest of the system keeps naming only Python types and the two adapters
stay consistent without depending on each other.

It also owns the **one** evaluation of a schema's declared value rules
(:func:`evaluate_rules`). The checking half and the row-routing half of the
declared-schema contract used to walk the declarations separately and disagree
in undocumented ways; they now consume the same :class:`RuleOutcome` list and
differ only in how they *present* it.

Private layout: pipelines and the case-review layer never import from here; the
adapters reach it, and the value-rule classes live in
:mod:`framework.core.value_rules`.
"""

from __future__ import annotations

from dataclasses import dataclass, fields
from datetime import date, datetime
from functools import lru_cache
from typing import Callable, Protocol, get_type_hints, runtime_checkable

import pandas as pd
from pandas.api import types as pdt


@runtime_checkable
class ValueRule(Protocol):
    """A value-level expectation attached to a schema field via ``Annotated``.

    Where the columns+dtypes contract checks a column's *shape*, a value rule
    checks its *contents* — format, length, uniqueness, membership. Rules are
    declared on the same Case Type dataclass (``Annotated[type, Rule(...)]``) so
    the annotations stay the single source of truth, and run on the
    same engine-confined seam as the dtype check: each is handed the column's
    pandas Series directly. A rule returns ``None`` when satisfied, else a short
    phrase describing the breach (the column name is prefixed by the validator).

    The protocol lives here, with the annotation reading that selects rules; the
    concrete rules (``Pattern`` / ``Length`` / ``Unique`` / ``OneOf``) live in
    :mod:`framework.core.value_rules`.
    """

    def check(self, series: "pd.Series") -> str | None:  # noqa: F821
        """Return a breach phrase if ``series`` breaks the rule, else ``None``."""
        ...

    def violating_mask(self, series: "pd.Series") -> "pd.Series":
        """Return a boolean mask: True where a row violates this rule.

        Null values are always False — nullability is a separate concern.
        Used by the quarantine partitioner to identify which rows to route to
        the reject table. The mask marks rows **by position** and is plainly
        boolean (never pandas' nullable ``boolean``), because the callers select
        rows with it on frames whose index labels may repeat.
        """
        ...

    # The protocol stops here, deliberately. The built-in rules also advertise
    # their expectation without sampling offenders, which is what lets a
    # quarantined row's reason describe the rule rather than other rows' values
    # — but requiring that of every rule would break any application rule that
    # implements only these two methods. The shared evaluation treats it as an
    # optional extension and falls back to ``check`` when it is absent.


class RowCheck:
    """A *horizontal* expectation over the relationship between a row's fields.

    Where a :class:`ValueRule` is vertical — one column, a ``Series`` — a row
    check is horizontal: one row, many fields (``opened <= closed``; "if status
    is closed then closed_date is present"). It pairs a ``check`` function over a
    single row (a pandas ``Series`` indexed by column) with the **footprint** of
    columns it spans: the validator/partitioner skip the check when any spanned
    column is missing or ill-typed, so a column that already failed its dtype
    contract suppresses the check rather than crashing it. The function returns a
    breach phrase when the row is bad, ``None`` when it is fine — the same
    return-not-raise contract as ``ValueRule.check``, so a real bug (e.g. a
    typo'd column) propagates as a crash instead of masquerading as a breach.

    Unlike value rules, a row check runs over **every** row including nulls —
    presence may be the very thing it tests — so the author guards nulls
    explicitly. Declared on a schema via the :func:`row_checks` class decorator.
    """

    def __init__(
        self,
        columns: tuple[str, ...],
        check: Callable[["pd.Series"], str | None],  # noqa: F821
    ) -> None:
        self.columns = tuple(columns)
        self._check = check

    def check(self, row: "pd.Series") -> str | None:  # noqa: F821
        """Return a breach phrase if ``row`` breaks the check, else ``None``."""
        return self._check(row)


_ROW_CHECKS_ATTR = "__row_checks__"


def row_checks(*checks: RowCheck) -> Callable[[type], type]:
    """Class decorator declaring a schema's :class:`RowCheck` cross-field checks.

    Sits *above* ``@dataclass`` so it decorates the already-built schema class,
    stamping the checks onto it out of the field block (row checks belong to no
    single field, so they are not annotations). Read back by
    :func:`_declared_row_checks`.
    """

    def decorate(schema: type) -> type:
        if not isinstance(schema, type):
            raise TypeError(
                "@row_checks decorates a schema class; apply it above @dataclass"
            )
        setattr(schema, _ROW_CHECKS_ATTR, tuple(checks))
        return schema

    return decorate


def _declared_row_checks(schema: type) -> tuple[RowCheck, ...]:
    """Return the :class:`RowCheck`s declared on a schema, or an empty tuple.

    The horizontal companion of :func:`_declared_rules`: where that reads
    per-field value rules off the annotations, this reads the cross-field checks
    the :func:`row_checks` decorator stamped onto the class.
    """
    return getattr(schema, _ROW_CHECKS_ATTR, ())


# Python declared type -> (predicate over a pandas dtype, human label). The
# mapping is the seam between the dataclass contract and the concrete engine; it
# lives here so the rest of the system keeps naming only Python types.
# ``date``/``datetime`` both land as datetime64 (pandas has no
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

    A plain annotation passes through with empty metadata; an ``Annotated`` field
    yields its underlying type and the attached value rules.
    """
    if hasattr(hint, "__metadata__"):
        return hint.__origin__, hint.__metadata__  # type: ignore[attr-defined]
    return hint, ()  # type: ignore[return-value]


@lru_cache(maxsize=None)
def _resolved_hints(schema: type) -> dict[str, object]:
    """Return a schema class's resolved annotations, keeping ``Annotated`` extras.

    The framework uses ``from __future__ import annotations``, so a dataclass
    field's ``.type`` is a *string*; resolving it means evaluating the annotation
    against the schema's own module, which is not cheap. Every declaration reader
    below needs the same dict, and a validator built per item inside a ``ForEach``
    would otherwise re-resolve the same class on every pass — so the resolution
    is memoised on the class object itself.

    Caching is safe because a schema's annotations are fixed when the class is
    created: nothing in the framework rewrites a schema's ``__annotations__`` at
    runtime, and a schema built dynamically is a *new* class object and so a new
    cache key.
    """
    return get_type_hints(schema, include_extras=True)


def _declared_fields(schema: type) -> list[tuple[str, type]]:
    """Return a schema's ``(column, declared type)`` pairs, in declaration order.

    Reads the resolved annotations (see :func:`_resolved_hints`). Any
    ``Annotated`` value-rule metadata is stripped to the base type here, so the
    validator's dtype check and the coercer keep seeing plain Python types. The
    single place the dataclass→column/type reading lives.
    """
    hints = _resolved_hints(schema)
    return [(f.name, _unwrap(hints[f.name])[0]) for f in fields(schema)]


def _declared_rules(schema: type) -> list[tuple[str, list[ValueRule]]]:
    """Return a schema's ``(column, [value rules])`` pairs for fields that have any.

    The companion of :func:`_declared_fields` for the value-level contract: it
    reads the ``Annotated`` metadata off each field, keeping only the
    :class:`ValueRule` entries (markers like ``Nullable`` / other annotations are
    ignored — nullability is read separately by the validator).
    """
    hints = _resolved_hints(schema)
    declared: list[tuple[str, list[ValueRule]]] = []
    for f in fields(schema):
        rules = [m for m in _unwrap(hints[f.name])[1] if isinstance(m, ValueRule)]
        if rules:
            declared.append((f.name, rules))
    return declared


@dataclass(frozen=True)
class RuleOutcome:
    """What one declared value rule made of one frame — the shared traversal's unit.

    Produced once per (column, rule) pair by :func:`evaluate_rules` and consumed
    two ways: the checking half aggregates any non-empty ``mask`` into an
    aborting breach phrased with a sample of the column's offenders, while the
    routing half sends the masked rows aside labelled with ``phrase``.

    The two phrasings exist because the two callers describe different things. A
    validator error describes a *column*, so naming a handful of its offending
    values is exactly right. A quarantined row's reason describes *that row*,
    whose own values already sit beside the reason in the reject table — so it
    names the rule's expectation and samples nothing. Sampling there would stamp
    every rejected row with values belonging to other rows.
    """

    column: str
    rule: object
    mask: object  # a positional numpy bool array over the frame's rows
    phrase: str  # the rule's expectation, with no sample of offenders
    sampled_phrase: str  # the same, plus a sample of the column's offenders
    missing_column: bool = False


def _rule_phrases(rule: object, series: "pd.Series", mask: object) -> tuple[str, str]:
    """Return ``(phrase, sampled_phrase)`` for a rule that this frame breaches.

    A rule built on the shared base advertises its expectation directly, so both
    phrasings come from it with no extra pass over the column. A rule that
    implements the protocol and inherits nothing has only ``check``, which
    samples: it is called **once** here (never per breaching row), and its one
    phrase serves both callers unchanged.
    """
    describe = getattr(rule, "describe_breach", None)
    sample = getattr(rule, "describe_breach_with_sample", None)
    if callable(describe) and callable(sample):
        return describe(), sample(series[mask])
    fallback = None
    check = getattr(rule, "check", None)
    if callable(check):
        fallback = check(series)
    if fallback is None:
        fallback = type(rule).__name__
    return fallback, fallback


def evaluate_rules(
    schema: type,
    frame: "pd.DataFrame",
    *,
    skip_columns: "set[str] | frozenset[str]" = frozenset(),
) -> list[RuleOutcome]:
    """Evaluate a schema's declared value rules over ``frame`` — one traversal.

    Each declared rule is consulted **once**: one mask, and at most one phrase
    derivation. Both halves of the declared-schema contract read the result — the
    validator turns non-empty masks into an aborting message, the quarantine
    partitioner routes the masked rows aside — so a rule author satisfies one
    contract rather than two subtly different ones.

    A rule whose column is **absent** does not run, in either caller: it is
    marked ``missing_column`` and carries an all-False mask. That is deliberate
    rather than accidental. A missing column is a *structural* breach, and the
    structural check owns reporting it and aborting; the routing half cannot
    route a row aside for a column that does not exist, and the ordering
    invariant is that the structural check precedes quarantine anyway. Marking
    the outcome keeps the skip visible to a caller that wants to say so.

    ``skip_columns`` lets a caller that knows a column's dtype is already wrong
    suppress its rules — a string-shaped rule over a mistyped column would only
    add a spurious second failure. The routing half passes nothing, because by
    then the structural check has already aborted on any dtype breach.

    The returned mask is **positional**: a plain numpy bool array over the
    frame's rows, never an index-label selection. A frame whose index labels
    repeat (an ordinary outcome of concatenating two frames behind the carrier
    seam) would otherwise merge distinct rows or select the wrong ones.
    """
    outcomes: list[RuleOutcome] = []
    present = set(frame.columns)
    for column, rules in _declared_rules(schema):
        if column in skip_columns:
            continue
        if column not in present:
            outcomes.extend(
                RuleOutcome(
                    column=column,
                    rule=rule,
                    mask=_empty_mask(frame),
                    phrase="",
                    sampled_phrase="",
                    missing_column=True,
                )
                for rule in rules
            )
            continue
        series = frame[column]
        for rule in rules:
            mask = _positional_mask(rule.violating_mask(series))
            phrase, sampled = ("", "")
            if mask.any():
                phrase, sampled = _rule_phrases(rule, series, mask)
            outcomes.append(
                RuleOutcome(
                    column=column,
                    rule=rule,
                    mask=mask,
                    phrase=phrase,
                    sampled_phrase=sampled,
                )
            )
    return outcomes


def _positional_mask(mask: object) -> object:
    """Narrow a rule's mask to a positional numpy ``bool`` array.

    A rule may hand back a pandas Series (indexed, and possibly of the *nullable*
    ``boolean`` dtype) or a bare array. Callers select rows with it positionally,
    and a mask carrying nulls raises on that selection, so both are flattened
    here — once, in the shared traversal.
    """
    to_numpy = getattr(mask, "to_numpy", None)
    if callable(to_numpy):
        return mask.fillna(False).to_numpy(dtype=bool)  # type: ignore[union-attr]
    return mask


def _empty_mask(frame: "pd.DataFrame") -> object:
    """Return an all-False positional mask over ``frame``'s rows."""
    return pd.Series(False, index=range(len(frame))).to_numpy(dtype=bool)

```
