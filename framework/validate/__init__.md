```python
"""Public facade: declaring and enforcing a feed's data contract.

The stable import surface for everything that **checks** a feed rather than
reshaping it. Two groups:

- the ``validate(dataset)`` structural / volume / uniqueness checks
  (``ColumnValidator`` & friends) that raise :class:`ValidationError` on breach;
- the **declared-schema contract**: ``SchemaValidator`` checks a dataset against
  a Case Type dataclass (columns + dtypes + nullability + value rules), and the
  value rules (``ValueRule`` / ``Nullable`` / ``NonNull`` / ``Pattern`` /
  ``Length`` / ``Unique`` / ``OneOf``) declared on its fields.

Compose them onto a ``framework.run`` ``Pipeline`` as pre/post validators. The
*coerce* half of the schema adapter — ``SchemaCoercion`` — lives on
``framework.transform`` instead, because it reshapes rather than checks.

Import from here rather than the underlying modules::

    from framework.validate import ColumnValidator, SchemaValidator, ValidationError

The modules behind this facade (``framework.validate.validators``,
``framework.validate.schema``, ``framework.validate.value_rules``) are internal
layout: re-exports here are the public contract, the submodule paths are not. See
``docs/public-api.md``.
"""

from framework._internal.schema import ValueRule
from framework.validate.schema import SchemaValidator
from framework.validate.validators import (
    ColumnValidator,
    PriorColumns,
    RowCountValidator,
    RunHistory,
    SchemaDriftValidator,
    UniqueValidator,
    ValidationError,
    Validator,
    VolumeAnomalyValidator,
)
from framework.validate.value_rules import (
    Length,
    NonNull,
    Nullable,
    OneOf,
    Pattern,
    Unique,
)

__all__ = [
    # validate(dataset) checks
    "Validator",
    "ValidationError",
    "ColumnValidator",
    "RowCountValidator",
    "VolumeAnomalyValidator",
    "UniqueValidator",
    "RunHistory",
    "SchemaDriftValidator",
    "PriorColumns",
    # Declared-schema contract + value rules
    "SchemaValidator",
    "ValueRule",
    "Nullable",
    "NonNull",
    "Pattern",
    "Length",
    "Unique",
    "OneOf",
]

```
