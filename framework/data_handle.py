"""The opaque tabular carrier — the bulk tier of the two-tier data carrier.

``DataHandle`` is the seam that keeps the concrete in-memory engine (pandas
today, polars or other later) out of the rest of the system. Readers, the
Store, and processors construct and unwrap handles through ``from_pandas`` /
``to_pandas``; everything else (Protocol signatures, pipeline scripts, the
domain layer) sees only the small public surface below and never names pandas.
See ADR-0002.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - typing only, no runtime pandas leak
    import pandas as pd


class DataHandle:
    """An opaque handle over a tabular dataset.

    The backing frame is engine-private. Callers read shape through
    :attr:`columns` and :func:`len`; only engine-confined code (readers,
    writers, processors) reaches the frame via :meth:`from_pandas` /
    :meth:`to_pandas`.
    """

    def __init__(self, frame: "pd.DataFrame") -> None:
        self._frame = frame

    @classmethod
    def from_pandas(cls, frame: "pd.DataFrame") -> "DataHandle":
        """Wrap a pandas frame. Engine-confined entry point."""
        return cls(frame)

    def to_pandas(self) -> "pd.DataFrame":
        """Return the backing pandas frame. Engine-confined exit point."""
        return self._frame

    @property
    def columns(self) -> list[str]:
        """Column names, in order."""
        return list(self._frame.columns)

    def __len__(self) -> int:
        """Number of rows."""
        return len(self._frame)
