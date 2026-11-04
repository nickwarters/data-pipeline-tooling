```python
"""The opaque tabular carrier.

``Dataset`` is the seam that keeps the concrete in-memory engine (pandas
today, polars or other later) out of the rest of the system. Readers, the
Store, and processors construct and unwrap datasets through ``from_pandas`` /
``to_pandas``; everything else (Protocol signatures, pipeline scripts, the
domain layer) sees only the small public surface below and never names pandas.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - typing only, no runtime pandas leak
    import pandas as pd


class Dataset:
    """An opaque, bulk in-memory carrier of tabular data (pandas behind the seam).

    The backing frame is engine-private. Callers read shape through
    :attr:`columns` and :func:`len`; only engine-confined code (readers,
    writers, processors) reaches the frame via :meth:`from_pandas` /
    :meth:`to_pandas`.
    """

    def __init__(self, frame: "pd.DataFrame") -> None:
        self._frame = frame

    @classmethod
    def from_pandas(cls, frame: "pd.DataFrame") -> "Dataset":
        """Wrap a pandas frame. Engine-confined entry point."""
        return cls(frame)

    def to_pandas(self, *, copy: bool = True) -> "pd.DataFrame":
        """Return the backing pandas frame. Engine-confined exit point.

        Returns a copy by default so callers cannot mutate the carrier's
        internal state. Pass ``copy=False`` only in hot paths where the
        caller guarantees it will not mutate the frame.
        """
        return self._frame.copy() if copy else self._frame

    @property
    def columns(self) -> list[str]:
        """Column names, in order."""
        return list(self._frame.columns)

    @property
    def dtypes(self) -> dict[str, str]:
        """Column name -> engine dtype name, in column order.

        A shape accessor for previews/diagnostics: stringified so callers never
        touch a pandas dtype object across the seam.
        """
        return {col: str(dtype) for col, dtype in self._frame.dtypes.items()}

    def sample(self, n: int = 5) -> list[dict[str, object]]:
        """Return up to ``n`` leading rows as plain dicts (engine-confined exit).

        For previewing a dataset without dumping the whole frame; values are
        coerced to native Python types so no pandas object leaks out.
        """
        head = self._frame.head(max(n, 0))
        return [
            {col: _native(value) for col, value in row.items()}
            for row in head.to_dict(orient="records")
        ]

    def __len__(self) -> int:
        """Number of rows."""
        return len(self._frame)

    def with_columns(self, **values: object) -> "Dataset":
        """Return a new Dataset with extra scalar columns stamped on every row."""
        frame = self._frame.copy()
        for col, val in values.items():
            frame[col] = val
        return Dataset.from_pandas(frame)


def _native(value: object) -> object:
    """Coerce a pandas/numpy scalar to a plain Python value for previews."""
    item = getattr(value, "item", None)
    if callable(item):
        try:
            return item()
        except (ValueError, TypeError):
            return value
    return value

```
