"""Name the rows behind a breach, so a failure message says *which* rows.

A breach phrased only by column -- "column 'amount' contains null value(s)" --
tells an operator what is wrong but not where, and finding the row means opening
the data and repeating the check by hand. Every check that reports a row-level
breach (the schema validator's nulls, value rules and row checks; the coercer's
uncastable values) names its rows through :func:`locate_rows`, so they all read
alike.

A row is named by its **key** when the caller declared one and the row carries
it -- ``case_ref='C-1'``, or ``(case_type='claims', source_item_id='7')`` for a
composite key -- because that is what an operator can look up in the source.
Otherwise, or where the row's key is itself missing, it is named by its
**position** in the dataset: 0-based, so ``position 3`` is ``frame.iloc[3]`` in a
debugger. The index label is deliberately not used; a frame concatenated from two
others repeats its labels, and a label then names two rows.

Only the first few rows are named, then a count of the rest, so a feed where
every row breaks produces a message a person can still read.

Private layout: the schema adapters reach it; pipelines never import it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Iterable, Sequence

from framework._internal.identity import canonical_text

if TYPE_CHECKING:
    import pandas as pd

# How many rows a message names before summarising the rest as a count.
MAX_ROWS_NAMED = 5


def normalise_key(key: str | Iterable[str] | None) -> tuple[str, ...]:
    """A key given as one column name or several, as a tuple of names."""
    if key is None:
        return ()
    if isinstance(key, str):
        return (key,)
    return tuple(key)


def locate_rows(
    frame: "pd.DataFrame",
    positions: Iterable[int],
    key: Sequence[str] = (),
) -> str:
    """Name the rows at ``positions``: ``"2 rows: case_ref='A', case_ref='B'"``.

    Without a key: ``"2 rows: positions 0, 3"``.

    ``positions`` are 0-based positions in ``frame``. A key column the frame
    does not carry falls every row back to its position rather than failing, so
    naming the rows can never be what breaks a check.
    """
    positions = list(positions)
    count = len(positions)
    shown = positions[:MAX_ROWS_NAMED]
    usable_key = tuple(key) if key and set(key) <= set(frame.columns) else ()
    if usable_key:
        listed = ", ".join(_name_row(frame, p, usable_key) for p in shown)
    else:
        label = "position" if count == 1 else "positions"
        listed = f"{label} " + ", ".join(str(p) for p in shown)
    if count > MAX_ROWS_NAMED:
        listed += f" and {count - MAX_ROWS_NAMED} more"
    noun = "row" if count == 1 else "rows"
    return f"{count} {noun}: {listed}"


def locate_mask(
    frame: "pd.DataFrame",
    mask: object,
    key: Sequence[str] = (),
) -> str:
    """:func:`locate_rows` over a positional boolean mask."""
    positions = [i for i, hit in enumerate(mask) if bool(hit)]  # type: ignore[arg-type]
    return locate_rows(frame, positions, key)


def _name_row(frame: "pd.DataFrame", position: int, key: tuple[str, ...]) -> str:
    """One row by its key, or by its position when its key is missing."""
    row = frame.iloc[position]
    values = [canonical_text(row[column]) for column in key]
    if any(value is None for value in values):
        # A row missing its own key cannot be looked up by it.
        return f"position {position}"
    parts = [f"{column}={value!r}" for column, value in zip(key, values)]
    if len(parts) == 1:
        return parts[0]
    return "(" + ", ".join(parts) + ")"
