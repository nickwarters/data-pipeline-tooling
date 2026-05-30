"""Schema enforcement — the dataclass→validator adapter (ADR-0008).

A Case Type's **schema** is declared as an ordinary dataclass whose annotations
*are* the contract: each field is a column name and its declared Python type.
``SchemaValidator`` derives column + dtype expectations from those annotations
and checks a ``DataHandle`` against them at the **silver** boundary (post-
validator), so a missing column or wrong dtype fails at a predictable place with
a located message — before downstream logic touches the data.

Unlike the structural checks in :mod:`framework.validators` (which read only the
handle's engine-agnostic shape), a schema check inspects column *dtypes*, so it
is **engine-confined**: it reaches the backing frame via ``to_pandas()`` exactly
as a Reader/Writer/processor does (ADR-0002). Richer value-level rules (format,
uniqueness, encoding) are later validators of the same engine-confined shape;
the dataclass annotations stay the single source of truth they extend.
"""

from __future__ import annotations

from dataclasses import fields
from datetime import date, datetime
from typing import Callable, get_type_hints

from pandas.api import types as pdt

from framework.data_handle import DataHandle
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


class SchemaValidator:
    """Check a handle against a Case Type schema (a dataclass): columns + dtypes.

    Derived from the dataclass's fields — name gives the required column, the
    annotation gives the required type. Extra columns are ignored (the contract
    is the declared fields only). Reports every breach at once in one located
    message, then raises, so an abort names the full problem.
    """

    def __init__(self, schema: type) -> None:
        self._schema = schema
        # Resolve postponed (string) annotations to their types: the framework
        # uses `from __future__ import annotations`, so `fields(...).type` is a
        # string. `get_type_hints` evaluates it against the schema's module.
        hints = get_type_hints(schema)
        self._expected = [(f.name, hints[f.name]) for f in fields(schema)]
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

    def validate(self, handle: DataHandle) -> None:
        frame = handle.to_pandas()  # engine-confined (ADR-0002)
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
