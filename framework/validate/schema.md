```python
"""SchemaValidator: check a dataset against a declared Case Type schema.

A Case Type's **schema** is an ordinary dataclass whose annotations *are* the
contract: each field is a column name and its declared Python type, optionally
carrying ``Annotated`` value rules. ``SchemaValidator`` checks a ``Dataset``'s
columns + dtypes + nullability + value rules at the **silver** boundary
(post-validator), reporting every breach at once in one located message before
downstream logic touches the data.

It is the *check* half of the schema adapter; the *coerce* half —
:class:`~framework.transform.coercion.SchemaCoercion`, which repairs the
representation raw loses to storage — lives in ``framework.transform`` because it
reshapes rather than checks. Both derive from the shared annotation reading and
type mapping in :mod:`framework._internal.schema`, so they stay consistent
without depending on each other.

Like the value-level rules it runs, the check is **engine-confined**: it reaches
the backing frame via ``to_pandas()`` exactly as a Reader/Writer/processor does.
Unlike the structural checks in :mod:`framework.validate.validators` (which read
only the dataset's engine-agnostic shape), it inspects column *dtypes* and
*values*.
"""

from __future__ import annotations

from dataclasses import fields
from typing import get_type_hints

from framework._internal.schema import (
    _DTYPE_CHECKS,
    _declared_fields,
    _declared_rules,
    _unwrap,
)
from framework.core.dataset import Dataset
from framework.validate.validators import ValidationError
from framework.validate.value_rules import NonNull, Nullable


def _declared_nullability(schema: type) -> dict[str, bool]:
    """Return whether each declared field allows null values.

    The default is nullable for compatibility with existing schemas and value
    rules. ``Annotated[T, NonNull()]`` makes the field required/non-null;
    ``Annotated[T, Nullable()]`` records the default explicitly. Declaring both
    on one field is a schema configuration error.
    """
    hints = get_type_hints(schema, include_extras=True)
    declared: dict[str, bool] = {}
    for f in fields(schema):
        metadata = _unwrap(hints[f.name])[1]
        allows_null = any(isinstance(m, Nullable) for m in metadata)
        requires_value = any(isinstance(m, NonNull) for m in metadata)
        if allows_null and requires_value:
            raise ValueError(
                f"{schema.__name__} schema declares conflicting nullability "
                f"for field {f.name!r}"
            )
        declared[f.name] = not requires_value
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
        self._nullable = _declared_nullability(schema)
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
        frame = dataset.to_pandas()
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
                problems.append(f"column {name!r} expected {label} but found {actual}")
                ill_typed.add(name)
            elif not self._nullable[name] and frame[name].isna().any():
                problems.append(f"column {name!r} contains null value(s)")
        # Value rules run on the same frame, but only over columns
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

```
