"""JSON blob reshaping: walk a JSON value in a column into rows or columns.

``Unpivot`` reshapes wide *columns*; nothing walked a JSON *blob*. These three
siblings fill that gap and are domain-free — they know nothing about any feed's
subject matter:

- :class:`ExplodeJsonMap` — a JSON object column becomes one row per key.
- :class:`ExplodeJsonList` — a JSON array column becomes one row per element.
- :class:`FlattenJsonObject` — a 0-or-1 JSON object becomes columns on its row.

They follow ``Unpivot``'s conventions: declared ``id_vars`` are repeated onto
every output row, an empty/null/absent blob contributes zero rows (or null
columns, for the flatten) rather than an error, and output order is
deterministic — input row order, then the blob's own key/element order.

Each reads a column holding **either** JSON text or values already decoded into
``dict``/``list`` — a raw SQLite table hands back the first, an upstream
``Parse`` the second — so a ``Parse`` ahead of them is optional. Whatever they
land in a column is a scalar as-is, or JSON text: one rule for a lifted subfield
and for ``value_into`` alike, because a live ``dict`` in a column is not
writable.
"""

from __future__ import annotations

import json
from typing import Any, Mapping, Sequence, cast

import pandas as pd

from framework._internal.describe import render
from framework.core.dataset import Dataset
from framework.core.errors import ErrorCategory, PipelineError

# `None` is a legitimate key of a pre-decoded map, so the prefix filters need a
# sentinel of their own to mean "this key is filtered out".
_FILTERED = object()


class JsonShapeError(PipelineError):
    """Raised when a column's JSON blob cannot be reshaped as declared.

    Categorised as ``DATA``: malformed JSON, or JSON of the wrong shape for the
    transform reading it, is a defect in the feed. The message names the row so
    the offending record can be found.
    """

    category = ErrorCategory.DATA


def _lift(value: Any, path: str) -> Any:
    """Read a dotted path out of a nested mapping; absent → ``None``."""
    for part in path.split("."):
        if not isinstance(value, Mapping):
            return None
        value = value.get(part)
    return value


def _where(transform: str, column: str, position: int) -> str:
    """The error context every JsonShapeError opens with: who, what, which row.

    The position is relative to the frame the transform was handed, which under
    a chunked read is one chunk rather than the whole source.
    """
    return f"{transform}: column {column!r} at row {position}"


def _decode(value: Any, *, where: str, expected: type) -> Any:
    """Decode one row's blob, or ``None`` when the row carries no blob at all.

    An absent/null/blank blob is the ordinary "nothing here" case and is the
    caller's zero-rows path — including a literal JSON ``null``, which an
    upstream snapshot writes for an object it does not have. Text that is not
    JSON, or JSON of the wrong shape, is a feed defect: it raises, naming the
    column and the row's position.
    """
    # `is True`, not truthiness: `pd.isna` answers element-wise for a sequence,
    # so anything but a scalar null returns an array here rather than a verdict.
    if pd.isna(value) is True:
        return None
    if isinstance(value, str):
        if not value.strip():
            return None
        try:
            value = json.loads(value)
        except ValueError as error:
            raise JsonShapeError(f"{where} holds malformed JSON: {error}") from error
        if value is None:
            return None
    if not isinstance(value, expected):
        shape = "object" if expected is dict else "array"
        raise JsonShapeError(
            f"{where} holds {type(value).__name__}, expected a JSON {shape}."
        )
    return value


def _require_distinct(columns: Sequence[str], *, transform: str) -> None:
    """Refuse colliding output names: pandas would drop one without a word."""
    seen, collided = set(), []
    for name in columns:
        if name in seen:
            collided.append(name)
        seen.add(name)
    if collided:
        raise ValueError(
            f"{transform}: output column(s) named more than once: {collided!r}. "
            f"Every output column must be named once."
        )


def _require_present(frame: Any, needed: Sequence[str], *, transform: str) -> None:
    """The house rule: a mis-typed column names itself and what is available."""
    missing = [name for name in needed if name not in frame.columns]
    if missing:
        raise ValueError(
            f"{transform}: column(s) not found in dataset: {missing!r}. "
            f"Available columns: {list(frame.columns)!r}"
        )


def _require_unambiguous(frame: Any, names: Sequence[str], *, transform: str) -> None:
    """Refuse a label the frame carries twice, whether it is read or written.

    A duplicated label reads back as a frame rather than a column — which would
    land the column *name* in every output row — and writes to *both* columns,
    collapsing them into one with nothing but a pandas warning.
    """
    duplicated = sorted({n for n in names if list(frame.columns).count(n) > 1})
    if duplicated:
        raise ValueError(
            f"{transform}: column(s) named more than once in the dataset: "
            f"{duplicated!r}. Every column it reads or writes must be unambiguous."
        )


def _as_column_value(value: Any) -> Any:
    """Land a JSON value in a column: scalars as-is, anything else encoded."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return json.dumps(value)


def _lifted(fields: Mapping[str, str], value: Any) -> dict[str, Any]:
    """Project one JSON value onto its declared output columns.

    A declared field that is not there lands null, at every depth and for every
    reason: the key is absent, the value is a scalar with no subfields at all,
    or a dotted path goes non-object part-way down. These transforms are as
    permissive about a blob's *inner* shape as ``Unpivot`` is about a column's
    contents — only the top-level blob is held to a declared shape, because that
    is the one the caller named a transform for.
    """
    return {into: _as_column_value(_lift(value, path)) for path, into in fields.items()}


def _walk(
    frame: Any,
    *,
    column: str,
    id_vars: Sequence[str],
    transform: str,
    expected: type,
) -> Any:
    """Yield ``(id values, decoded blob)`` for each row of the frame.

    Reads only the blob column and the ``id_vars``, rather than materialising a
    whole-row Series per row: a row read as a Series is single-dtype, the same
    hazard ``DeriveKey`` documents, and every other column is dead weight here.
    """
    for position, values in enumerate(
        zip(frame[column], *(frame[name] for name in id_vars))
    ):
        blob = _decode(
            values[0],
            where=_where(transform, column, position),
            expected=expected,
        )
        yield dict(zip(id_vars, values[1:])), blob


class ExplodeJsonMap:
    """Explode a JSON-object column into one output row per key.

    ``column`` names the JSON-object column; each of its keys becomes an output
    row, stamped into ``key_into``, with the ``id_vars`` columns repeated
    alongside. Pass exactly one of:

    - ``fields`` — ``{subfield path: output column}``. A dotted path reaches into
      a 1:1 nest (``"remediationStatus.status"``); a field that is not there to
      lift lands null, whatever the reason.
    - ``value_into`` — the whole map value lands in this one column. For maps of
      scalars, or of polymorphic values that no fixed set of columns would fit.

    Either way a value lands as itself if it is a scalar, and as JSON text if it
    is not.

    ``include_key_prefix`` / ``exclude_key_prefix`` partition one blob between
    sibling pipelines by a key convention (``general:*``), and
    ``strip_key_prefix`` stores the included key without it. A non-text key —
    only reachable from pre-decoded input, since JSON keys are text — carries no
    prefix, so an include filter drops it and an exclude filter keeps it.

    An absent, null, blank or empty blob contributes no rows. Text that is not
    JSON, or JSON that is not an object, raises :class:`JsonShapeError` naming
    the column and the row's position.
    """

    def __init__(
        self,
        *,
        column: str,
        key_into: str,
        id_vars: Sequence[str],
        fields: Mapping[str, str] | None = None,
        value_into: str | None = None,
        include_key_prefix: str | None = None,
        exclude_key_prefix: str | None = None,
        strip_key_prefix: bool = False,
    ) -> None:
        if (fields is None) == (value_into is None):
            raise ValueError(
                "ExplodeJsonMap: pass exactly one of `fields` (lift named "
                "subfields) or `value_into` (land the whole map value)."
            )
        if strip_key_prefix and not include_key_prefix:
            raise ValueError(
                "ExplodeJsonMap: `strip_key_prefix` strips the *included* "
                "prefix, so it needs an `include_key_prefix` to strip."
            )
        self._column = column
        self._key_into = key_into
        self._id_vars = list(id_vars)
        self._fields = dict(fields) if fields is not None else None
        self._value_into = value_into
        self._include_key_prefix = include_key_prefix
        self._exclude_key_prefix = exclude_key_prefix
        self._strip_key_prefix = strip_key_prefix
        # The exactly-one-of guard above settles which of the two modes names
        # the output columns, so the rest of the class needs only the answer.
        self._output = (
            list(fields.values()) if fields is not None else [cast(str, value_into)]
        )
        _require_distinct(
            [*self._id_vars, key_into, *self._output],
            transform=type(self).__name__,
        )

    def _selected_key(self, key: Any) -> Any:
        """The key as it should be stored, or ``_FILTERED`` if it is not wanted.

        Only pre-decoded input can carry a non-text key (JSON keys are text).
        Such a key carries no prefix, so an include filter drops it and an
        exclude filter keeps it.
        """
        if not isinstance(key, str):
            return _FILTERED if self._include_key_prefix else key
        if self._exclude_key_prefix and key.startswith(self._exclude_key_prefix):
            return _FILTERED
        if self._include_key_prefix:
            if not key.startswith(self._include_key_prefix):
                return _FILTERED
            if self._strip_key_prefix:
                return key[len(self._include_key_prefix) :]
        return key

    def __call__(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        read = [self._column, *self._id_vars]
        _require_present(frame, read, transform=type(self).__name__)
        _require_unambiguous(frame, read, transform=type(self).__name__)
        columns = [*self._id_vars, self._key_into, *self._output]
        rows: list[dict[str, Any]] = []
        for ids, blob in _walk(
            frame,
            column=self._column,
            id_vars=self._id_vars,
            transform=type(self).__name__,
            expected=dict,
        ):
            for key, value in (blob or {}).items():
                stored_key = self._selected_key(key)
                if stored_key is _FILTERED:
                    continue
                out = dict(ids)
                out[self._key_into] = stored_key
                if self._fields is not None:
                    out.update(_lifted(self._fields, value))
                else:
                    out[self._output[0]] = _as_column_value(value)
                rows.append(out)
        return Dataset.from_pandas(pd.DataFrame(rows, columns=columns))

    def describe(self) -> str:
        return render(
            self,
            column=self._column,
            key_into=self._key_into,
            id_vars=self._id_vars,
            fields=self._fields,
            value_into=self._value_into,
            include_key_prefix=self._include_key_prefix,
            exclude_key_prefix=self._exclude_key_prefix,
            strip_key_prefix=self._strip_key_prefix,
        )


class ExplodeJsonList:
    """Explode a JSON-array column into one output row per element.

    ``column`` names the JSON-array column; each element becomes an output row
    carrying its 0-based position within the array in ``ordinal_into`` (an
    integer column whether or not this run exploded anything), with the
    ``id_vars`` columns repeated alongside. ``fields`` maps a subfield path to
    its output column, dotted paths reaching into a 1:1 nest exactly as in
    :class:`ExplodeJsonMap`.

    An absent, null, blank or empty array contributes no rows; text that is not
    JSON, or JSON that is not an array, raises :class:`JsonShapeError` naming
    the column and the row's position.
    """

    def __init__(
        self,
        *,
        column: str,
        ordinal_into: str,
        id_vars: Sequence[str],
        fields: Mapping[str, str],
    ) -> None:
        self._column = column
        self._ordinal_into = ordinal_into
        self._id_vars = list(id_vars)
        self._fields = dict(fields)
        _require_distinct(
            [*self._id_vars, ordinal_into, *self._fields.values()],
            transform=type(self).__name__,
        )

    def __call__(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        read = [self._column, *self._id_vars]
        _require_present(frame, read, transform=type(self).__name__)
        _require_unambiguous(frame, read, transform=type(self).__name__)
        columns = [*self._id_vars, self._ordinal_into, *self._fields.values()]
        rows: list[dict[str, Any]] = []
        for ids, blob in _walk(
            frame,
            column=self._column,
            id_vars=self._id_vars,
            transform=type(self).__name__,
            expected=list,
        ):
            for ordinal, element in enumerate(blob or []):
                out = dict(ids)
                out[self._ordinal_into] = ordinal
                out.update(_lifted(self._fields, element))
                rows.append(out)
        exploded = pd.DataFrame(rows, columns=columns)
        # An empty frame types every column `object`. The ordinal is the one
        # column whose type this transform knows regardless of the data, so it
        # is the one worth pinning: it stays an integer whether or not this run
        # exploded anything, and the affinity it is written under does not move
        # between runs. The id_vars and field columns carry whatever the feed
        # gave them, so there is nothing to pin them to.
        exploded[self._ordinal_into] = exploded[self._ordinal_into].astype("int64")
        return Dataset.from_pandas(exploded)

    def describe(self) -> str:
        return render(
            self,
            column=self._column,
            ordinal_into=self._ordinal_into,
            id_vars=self._id_vars,
            fields=self._fields,
        )


class FlattenJsonObject:
    """Flatten a 0-or-1 JSON-object column into columns on the same row.

    ``column`` names a JSON-object column that holds at most one object per row
    — an amendment, a resolution — and ``fields`` maps a subfield path to its
    output column, dotted paths reaching into a 1:1 nest exactly as in
    :class:`ExplodeJsonMap`. Row count is unchanged: an absent, null or blank
    object leaves its declared columns null rather than dropping the row.

    ``drop`` (the default) consumes the source column once it has been read;
    pass ``drop=False`` to keep the blob alongside the columns lifted out of it.
    A field target may name the source column — the lifted value replaces the
    blob in place, exactly as ``JoinColumns`` writes into one of the columns it
    consumes. A target naming *another* existing column overwrites it, which is
    how a flatten refreshes a column it has landed before.
    Text that is not JSON, or JSON that is not an object, raises
    :class:`JsonShapeError` naming the column and the row's position.
    """

    def __init__(
        self,
        *,
        column: str,
        fields: Mapping[str, str],
        drop: bool = True,
    ) -> None:
        self._column = column
        self._fields = dict(fields)
        self._drop = drop
        _require_distinct(list(self._fields.values()), transform=type(self).__name__)

    def __call__(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        _require_present(frame, [self._column], transform=type(self).__name__)
        _require_unambiguous(
            frame,
            [self._column, *self._fields.values()],
            transform=type(self).__name__,
        )
        lifted = [
            _lifted(self._fields, blob)
            for _, blob in _walk(
                frame,
                column=self._column,
                id_vars=[],
                transform=type(self).__name__,
                expected=dict,
            )
        ]
        for into in self._fields.values():
            frame[into] = [row[into] for row in lifted]
        # Never drop a column just written into: the lift replaces the blob.
        if self._drop and self._column not in self._fields.values():
            frame = frame.drop(columns=[self._column])
        return Dataset.from_pandas(frame)

    def describe(self) -> str:
        return render(
            self,
            column=self._column,
            fields=self._fields,
            drop=self._drop,
        )
