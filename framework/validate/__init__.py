"""Public facade: the ``validate(dataset)`` checks.

The stable import surface for the structural / volume / uniqueness checks that
**gate** a feed — they raise :class:`ValidationError` on breach rather than
reshaping the data, which is why they sit apart from ``framework.transform``'s
reshaping primitives. Compose them onto a ``framework.run`` ``Pipeline`` as
pre/post validators.

Import from here rather than the underlying module::

    from framework.validate import ColumnValidator, RowCountValidator, ValidationError

The module behind this facade (``framework.validate.validators``) is internal
layout: re-exports here are the public contract, the submodule path is not. See
``docs/public-api.md``.

(The declared-schema check ``SchemaValidator`` stays on ``framework.transform``
with the rest of the schema adapter, since it is part of the coerce/validate
schema contract.)
"""

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

__all__ = [
    "Validator",
    "ValidationError",
    "ColumnValidator",
    "RowCountValidator",
    "VolumeAnomalyValidator",
    "UniqueValidator",
    "RunHistory",
    "SchemaDriftValidator",
    "PriorColumns",
]
