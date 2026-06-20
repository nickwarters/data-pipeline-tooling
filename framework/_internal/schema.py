"""Shared schema introspection: dataclass annotations → columns / types / rules.

The value-rule-independent core both schema adapters derive from — the
:class:`~framework.core.schema.SchemaValidator` (which *checks*) and the
:class:`~framework.transform.coercion.SchemaCoercion` (which *coerces*). It owns
the one Python-type ↔ pandas-dtype mapping and the dataclass-annotation reading,
so the rest of the system keeps naming only Python types and the two adapters
stay consistent without depending on each other.

Private layout: pipelines and the case-review layer never import from here; the
adapters reach it, and the value-rule classes live in
:mod:`framework.core.value_rules`.
"""

from __future__ import annotations

from dataclasses import fields
from datetime import date, datetime
from typing import TYPE_CHECKING, Callable, Protocol, get_type_hints, runtime_checkable

from pandas.api import types as pdt

if TYPE_CHECKING:
    import pandas as pd


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
        the reject table.
        """
        ...


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
    :class:`ValueRule` entries (markers like ``Nullable`` / other annotations are
    ignored — nullability is read separately by the validator).
    """
    hints = get_type_hints(schema, include_extras=True)
    declared: list[tuple[str, list[ValueRule]]] = []
    for f in fields(schema):
        rules = [m for m in _unwrap(hints[f.name])[1] if isinstance(m, ValueRule)]
        if rules:
            declared.append((f.name, rules))
    return declared
