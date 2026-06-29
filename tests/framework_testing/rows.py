"""In-memory row helpers: build a source, capture a sink, assert on the result.

The row-dict side of the testing surface. Everything speaks plain Python row
dicts (``list[dict]``) behind the :class:`~framework.core.dataset.Dataset` seam, so
a pipeline test never touches a pandas frame, a temp directory, or a SQLite
round-trip unless it wants to. Re-exported from :mod:`tests.framework_testing`.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from framework.core.dataset import Dataset
from framework.core.protocols import Reader
from framework.io.readers import DatasetReader

__all__ = [
    "make_dataset",
    "given_rows",
    "given_csv",
    "rows_of",
    "RecordingWriter",
    "read_rows",
    "without_columns",
    "assert_rows_equal",
]


def make_dataset(rows: Sequence[Mapping[str, Any]]) -> Dataset:
    """Build a :class:`Dataset` from a sequence of row dicts.

    The engine-confined bridge the other helpers use to get in-memory rows
    behind the Dataset seam. Column order follows first appearance across the
    rows (pandas' record orientation).
    """
    import pandas as pd

    return Dataset.from_pandas(pd.DataFrame(list(rows)))


def given_rows(rows: Sequence[Mapping[str, Any]]) -> DatasetReader:
    """A ``Reader`` over in-memory rows — the given-source-rows entry point.

    Hands a pipeline its source feed as plain row dicts, so a test never needs a
    fixture file or a SQLite round-trip to exercise the read→process→write path.
    """
    return DatasetReader(make_dataset(rows))


def given_csv(
    tmp_path: str | os.PathLike[str],
    rows: Sequence[Mapping[str, Any]],
    *,
    name: str = "source.csv",
) -> Path:
    """Write *rows* to a CSV under *tmp_path* and return its path.

    The file-source counterpart to :func:`given_rows`: use it to exercise the
    file-backed readers (``CsvReader`` / ``GlobCsvReader``) end to end, e.g.
    ``CsvReader(given_csv(tmp_path, rows))``. Column order follows first
    appearance across the rows.
    """
    import pandas as pd

    path = Path(tmp_path) / name
    path.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(list(rows)).to_csv(path, index=False)
    return path


def rows_of(source: Dataset | RecordingWriter | Reader) -> list[dict[str, Any]]:
    """Unwrap a Dataset, a :class:`RecordingWriter`, or a Reader to row dicts.

    The expect-output-rows side: turns whatever a pipeline produced into a plain
    ``list[dict]`` so a test can assert against an expected list with ``==``.
    """
    if isinstance(source, RecordingWriter):
        dataset = source.dataset
        if dataset is None:
            raise AssertionError("RecordingWriter captured no write")
    elif isinstance(source, Dataset):
        dataset = source
    elif hasattr(source, "read"):
        dataset = source.read()
    else:  # pragma: no cover - guards against an unsupported argument
        raise TypeError(f"cannot read rows from {source!r}")
    return dataset.to_pandas().to_dict(orient="records")


class RecordingWriter:
    """A :class:`~framework.io.writers.Writer` that captures writes in memory.

    The expect-output-rows sink: compose it with ``.write(writer, ...)`` and the
    pipeline hands it the final Dataset instead of persisting anywhere. Reach the
    captured rows through :func:`rows_of` (or :attr:`dataset` / :attr:`writes`
    for multi-write pipelines such as checkpoints).
    """

    def __init__(self) -> None:
        self.writes: list[Dataset] = []

    def write(self, dataset: Dataset) -> None:
        self.writes.append(dataset)

    @property
    def dataset(self) -> Dataset | None:
        """The most recently written Dataset, or ``None`` if nothing was written."""
        return self.writes[-1] if self.writes else None


def read_rows(store: Any, table: str) -> list[dict[str, Any]]:
    """Read a landed table back as row dicts via the Store's own Reader.

    Collapses the ``store.reader(table).read().to_pandas()`` chain that every
    store-backed assertion repeats. ``store`` is any object that mints a Reader
    for ``table`` — a namespace :class:`~tools.store.Store` or anything
    with the same ``reader(table)`` shape — so the read goes through the same
    public seam a pipeline does, not around it.
    """
    return rows_of(store.reader(table))


def without_columns(
    rows: Iterable[Mapping[str, Any]], *names: str
) -> list[dict[str, Any]]:
    """Return *rows* with the named columns dropped (missing names are ignored).

    Handy for stripping volatile stamp columns (``run_id`` / ``load_date`` /
    timestamps) before a direct ``==`` assertion, so a test asserts on the
    business payload rather than per-run noise.
    """
    drop = set(names)
    return [{k: v for k, v in row.items() if k not in drop} for row in rows]


def _row_sort_key(row: Mapping[str, Any]) -> str:
    """A stable, type-tolerant sort key so two row lists compare as multisets."""
    return json.dumps(row, sort_keys=True, default=str)


def assert_rows_equal(
    actual: Dataset | RecordingWriter | Reader | Iterable[Mapping[str, Any]],
    expected: Iterable[Mapping[str, Any]],
    *,
    ignoring: Sequence[str] = (),
    unordered: bool = False,
) -> None:
    """Assert *actual* equals *expected*, optionally ignoring columns / order.

    *actual* may be anything :func:`rows_of` accepts (a Dataset, a
    :class:`RecordingWriter`, a Reader) or an already-unwrapped ``list[dict]``.
    ``ignoring`` drops volatile columns (e.g. ``run_id`` / ``load_date`` stamps)
    from both sides first; ``unordered`` compares as multisets when a pipeline
    doesn't guarantee row order. Raises ``AssertionError`` showing both sides on
    a mismatch.
    """
    actual_rows = (
        list(actual) if isinstance(actual, list) else rows_of(actual)  # type: ignore[arg-type]
    )
    expected_rows = list(expected)
    if ignoring:
        actual_rows = without_columns(actual_rows, *ignoring)
        expected_rows = without_columns(expected_rows, *ignoring)
    if unordered:
        actual_rows = sorted(actual_rows, key=_row_sort_key)
        expected_rows = sorted(expected_rows, key=_row_sort_key)
    assert actual_rows == expected_rows, (
        f"rows differ:\n  actual:   {actual_rows}\n  expected: {expected_rows}"
    )
