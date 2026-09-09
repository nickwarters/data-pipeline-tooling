"""Aggregate helpers: the plumbing around a gold reduction.

An Aggregate table is one row per combination of the dimensions it declares,
plus its measures. What each table *reduces* -- its grain, its question -- is
that table's own code and stays beside it. What every reduction does *around*
that is the same, and lives here so it is spelled once:

* a statistic over a column, ``None`` where the column had nothing to
  summarise, rounded to the place it is published at (:func:`statistic`,
  :func:`summarise`);
* a share or rate that is ``None`` rather than a division error where the
  denominator is zero (:func:`ratio`, :func:`ratios`), and a sum that stays
  ``None`` when no row reported the value at all (:func:`total`);
* a NULL dimension filled with a literal before the group-by, so the grain
  has no hole a reader would silently drop (:func:`fill_dimensions`,
  :func:`count_by`);
* the finished rows landed in exactly the shape the table's schema dataclass
  declares -- columns, order, and types -- so an empty result still passes the
  same ``SchemaValidator`` a populated one does (:func:`shaped`).

These are plain functions a reduction calls on one line, in the order it
reads, so they can be stepped through as the eager steps are. They are
**engine-confined**: a reduction has already crossed ``to_pandas()`` when it
reaches them, so they take and return the backing frame's own types, and only
:func:`shaped` -- the landing step -- hands back a ``Dataset``.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Iterable, Mapping, Sequence

import pandas as pd

from framework._internal.schema import _declared_fields
from framework.core.dataset import Dataset

__all__ = [
    "count_by",
    "fill_dimensions",
    "ratio",
    "ratios",
    "shaped",
    "statistic",
    "summarise",
    "total",
]

# The default places a published statistic is rounded to.
STATISTIC_PLACES = 3
RATIO_PLACES = 4


# --- statistics -------------------------------------------------------------


def statistic(value: object, *, places: int = STATISTIC_PLACES) -> float | None:
    """A statistic as it is published: rounded, or ``None`` where there was
    nothing to take (pandas hands back ``NaN`` for the mean of nothing)."""
    return None if pd.isna(value) else round(float(value), places)


def summarise(
    values: pd.Series,
    prefix: str,
    *,
    quantiles: Iterable[float] = (0.5, 0.9),
    places: int = STATISTIC_PLACES,
) -> dict[str, float | None]:
    """The mean, each quantile, and the maximum of ``values``, keyed for a row.

    ``summarise(days, "dwell_days")`` is
    ``{"dwell_days_mean", "dwell_days_p50", "dwell_days_p90", "dwell_days_max"}``
    -- a quantile of ``0.95`` lands as ``_p95``. Nulls are dropped first, and
    every statistic is ``None`` when nothing is left, which the schema reads
    as NULL: a group with a count but no closed interval has no statistic,
    and NULL says so where a zero would lie.
    """
    present = values.dropna()
    row: dict[str, float | None] = {
        f"{prefix}_mean": statistic(present.mean(), places=places)
    }
    for quantile in quantiles:
        row[f"{prefix}_p{round(quantile * 100):d}"] = statistic(
            present.quantile(quantile) if len(present) else None, places=places
        )
    row[f"{prefix}_max"] = statistic(present.max(), places=places)
    return row


def ratio(
    numerator: object, denominator: object, *, places: int = RATIO_PLACES
) -> float | None:
    """``numerator / denominator``, or ``None`` where the denominator is zero or
    missing -- a share of nothing is not a number."""
    if pd.isna(denominator) or pd.isna(numerator) or not denominator:
        return None
    return round(float(numerator) / float(denominator), places)


def ratios(
    numerator: pd.Series, denominator: pd.Series, *, places: int = RATIO_PLACES
) -> pd.Series:
    """:func:`ratio` over two whole columns: NULL wherever the denominator is
    not positive, rounded elsewhere."""
    return (numerator / denominator.where(denominator > 0)).round(places)


def total(values: pd.Series) -> float | None:
    """The sum of ``values``, or ``None`` when no row reported one.

    Plain ``sum()`` turns a column nobody reported into ``0``, which then
    reads as "nothing flowed" rather than "nothing was measured".
    """
    return statistic(values.sum(min_count=1), places=6)


# --- dimensions -------------------------------------------------------------


def fill_dimensions(frame: pd.DataFrame, fills: Mapping[str, object]) -> pd.DataFrame:
    """Replace each named dimension's NULLs with the literal that stands in for
    them, ahead of a group-by that would otherwise drop those rows.

    Through ``object``: an all-null column arrives as ``float64``, and filling
    it in place would coerce the literal back to a number (``NaN``).
    """
    return frame.assign(
        **{
            column: frame[column].astype("object").fillna(literal)
            for column, literal in fills.items()
        }
    )


def count_by(
    frame: pd.DataFrame,
    dimensions: Sequence[str],
    *,
    measure: str,
    fills: Mapping[str, object] | None = None,
) -> pd.DataFrame:
    """One row per combination of ``dimensions``, with the rows in it counted
    as ``measure``, sorted by the dimensions in the order given.

    ``fills`` names the dimensions a NULL is filled in before counting (see
    :func:`fill_dimensions`). An empty frame comes back as an empty frame with
    the same columns, so the table's shape does not depend on whether anything
    was counted.
    """
    filled = fill_dimensions(frame, fills or {})
    return (
        filled.groupby(list(dimensions), sort=True)
        .size()
        .reset_index(name=measure)
        .sort_values(list(dimensions), kind="stable")
        .reset_index(drop=True)
    )


# --- landing ----------------------------------------------------------------

# What each declared type is held as once a table is built. ``boolean`` rather
# than ``bool`` so a missing flag stays missing instead of becoming ``True``.
_PANDAS_DTYPES = {
    str: "string",
    int: "int64",
    float: "float64",
    bool: "boolean",
    date: "datetime64[ns]",
    datetime: "datetime64[ns]",
}


def shaped(
    rows: pd.DataFrame | Sequence[Mapping[str, object]],
    schema: type,
    *,
    stamp: Mapping[str, object] | None = None,
    sort_by: Sequence[str] = (),
) -> Dataset:
    """Land ``rows`` as the table ``schema`` declares.

    The schema dataclass is the one statement of a table's columns, their
    order and their types; they are read off it here rather than restated
    beside each reduction, so an empty result still carries the declared
    shape -- ``string`` dimensions, ``int64`` counts, ``float64`` statistics
    (NaN where a group had nothing to summarise) -- and passes the same
    ``SchemaValidator`` a populated one does.

    ``stamp`` sets constant columns on every row (the run's as-of instant),
    on an empty result too. ``sort_by`` orders the rows, stably; a column
    the schema declares but the rows lack is an error, not a silent NULL.
    """
    columns = {
        name: _PANDAS_DTYPES[declared] for name, declared in _declared_fields(schema)
    }
    frame = (
        pd.DataFrame(rows).copy()
        if isinstance(rows, pd.DataFrame)
        else pd.DataFrame(list(rows))
    )
    for column, value in (stamp or {}).items():
        frame[column] = value
    missing = [
        name for name in columns if name not in frame.columns and not frame.empty
    ]
    if missing:
        raise KeyError(f"{schema.__name__} declares columns the rows lack: {missing}")
    frame = frame.reindex(columns=list(columns))
    for column, dtype in columns.items():
        frame[column] = frame[column].astype(dtype)
    if sort_by:
        frame = frame.sort_values(list(sort_by), kind="stable")
    return Dataset.from_pandas(frame.reset_index(drop=True))
