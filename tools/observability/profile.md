```python
"""Per-column data profiling: the *statistical* sibling of the run log.

Where the validators only *gate* a feed (raise or quarantine) and
``VolumeAnomalyValidator`` watches a single run-over-run number (the row count),
a **profile** captures a feed's *shape* — null rate, distinct count, min/max, and
a bounded top-N value distribution per column — and records it on the run log so
it can be **trended across runs**. That turns "the data looks weird this run"
(a column that quietly slides 5% → 60% null; a categorical that gains junk
values) from an undetectable problem into a trendable one.

The pieces here sit beside the operational metadata on the same
``tools.observability`` surface (#284 is the statistical sibling of #89):

- :func:`profile_dataset` computes a :class:`DatasetProfile` from a ``Dataset``.
  Cost is bounded by ``top_n`` (the distribution is capped) and by an optional
  ``columns`` allow-list, and the whole task is opt-in — a pipeline only profiles
  when a profile node is wired in, so profiling never dominates a large-feed run.
- :class:`DatasetProfile` / :class:`ColumnProfile` serialise to a plain JSON
  record (:meth:`DatasetProfile.to_record`) that the ``RunLog`` writes and the
  ``RunRegistry`` stores in a queryable column, and round-trip back
  (:meth:`DatasetProfile.from_record`) for comparison.
- :class:`ProfileDriftCheck` is the baseline comparison — the statistical analogue
  of ``VolumeAnomalyValidator``. Given a :class:`ProfileBaseline` (the
  ``RunRegistry`` in production) it derives a per-column null-rate baseline from
  recent run history and reports the columns whose null rate has deviated beyond a
  configured tolerance. The wiring (``Pipeline.profile``) decides whether a
  deviation *warns* (logged, run continues) or *fails* (raises
  :class:`ProfileError`, an :class:`~framework.core.errors.ErrorCategory.DATA`
  abort), so the check itself only knows how to compare, not what to do about it —
  exactly like a Validator.

This module computes over the pandas frame behind the ``Dataset`` seam (a
transform-like computation); the ``RunRegistry`` that stores the result stays
stdlib-only and never touches pandas — it just persists the JSON.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import Iterable, Protocol

import pandas as pd

from framework._internal.describe import render
from framework.core.dataset import Dataset
from framework.core.errors import ErrorCategory, PipelineError

# The default cap on a column's value distribution. Bounds the cost (and the
# recorded size) of a profile so it stays cheap on a wide/large feed; raise it
# per-column only when a fuller distribution is worth the bytes.
DEFAULT_TOP_N = 10


class ProfileError(PipelineError):
    """Raised when a profile deviates from its baseline beyond tolerance.

    A *data* failure (the feed's shape regressed), so it carries
    :data:`~framework.core.errors.ErrorCategory.DATA` like a Validator breach.
    Raised only in the profile node's ``fail`` mode; ``warn`` mode records the
    same message as a tolerated ``warn_hit`` instead.
    """

    category = ErrorCategory.DATA


@dataclass(frozen=True)
class ColumnProfile:
    """The profiled shape of one column: completeness, cardinality, range, top-N.

    Every field is JSON-scalar (or a list of them) so the whole profile serialises
    to the run log without a custom encoder. ``minimum`` / ``maximum`` are filled
    only for ordered (numeric / datetime) columns and are ``None`` otherwise;
    ``top_values`` is the bounded ``[value, count]`` distribution, most-frequent
    first.
    """

    name: str
    dtype: str
    null_count: int
    null_rate: float
    distinct_count: int
    minimum: float | str | None = None
    maximum: float | str | None = None
    top_values: list[list[object]] = field(default_factory=list)

    def to_record(self) -> dict:
        return {
            "name": self.name,
            "dtype": self.dtype,
            "null_count": self.null_count,
            "null_rate": self.null_rate,
            "distinct_count": self.distinct_count,
            "minimum": self.minimum,
            "maximum": self.maximum,
            "top_values": [list(pair) for pair in self.top_values],
        }

    @classmethod
    def from_record(cls, record: dict) -> "ColumnProfile":
        return cls(
            name=record["name"],
            dtype=record["dtype"],
            null_count=record["null_count"],
            null_rate=record["null_rate"],
            distinct_count=record["distinct_count"],
            minimum=record.get("minimum"),
            maximum=record.get("maximum"),
            top_values=[list(pair) for pair in record.get("top_values", [])],
        )


@dataclass(frozen=True)
class DatasetProfile:
    """A run's per-column profile: ``row_count`` plus one :class:`ColumnProfile` each.

    The unit the run log records and the registry trends. ``to_record`` /
    ``from_record`` are the JSON round-trip across that seam; :meth:`column` looks
    one column up by name (``None`` if it was not profiled this run).
    """

    row_count: int
    columns: list[ColumnProfile] = field(default_factory=list)

    def column(self, name: str) -> ColumnProfile | None:
        for col in self.columns:
            if col.name == name:
                return col
        return None

    def to_record(self) -> dict:
        return {
            "row_count": self.row_count,
            "columns": [col.to_record() for col in self.columns],
        }

    @classmethod
    def from_record(cls, record: dict) -> "DatasetProfile":
        return cls(
            row_count=record["row_count"],
            columns=[
                ColumnProfile.from_record(col) for col in record.get("columns", [])
            ],
        )


def profile_dataset(
    dataset: Dataset,
    *,
    columns: Iterable[str] | None = None,
    top_n: int = DEFAULT_TOP_N,
) -> DatasetProfile:
    """Compute a :class:`DatasetProfile` over (a subset of) a ``Dataset``'s columns.

    ``columns`` restricts profiling to a named allow-list (unknown names are
    skipped) — left as ``None`` every column is profiled. ``top_n`` caps each
    column's value distribution. Both bound the cost so profiling stays cheap on a
    wide/large feed; the task is opt-in besides, so a pipeline pays nothing unless
    it wires a profile node in.
    """
    frame = dataset.to_pandas(copy=False)
    row_count = len(frame)
    if columns is None:
        selected = list(frame.columns)
    else:
        present = set(frame.columns)
        selected = [name for name in columns if name in present]
    return DatasetProfile(
        row_count=row_count,
        columns=[
            _profile_column(name, frame[name], row_count, top_n) for name in selected
        ],
    )


def _profile_column(
    name: str, series: pd.Series, row_count: int, top_n: int
) -> ColumnProfile:
    null_count = int(series.isna().sum())
    null_rate = (null_count / row_count) if row_count else 0.0
    distinct_count = int(series.nunique(dropna=True))

    minimum = maximum = None
    if pd.api.types.is_numeric_dtype(series) or pd.api.types.is_datetime64_any_dtype(
        series
    ):
        non_null = series.dropna()
        if not non_null.empty:
            minimum = _json_scalar(non_null.min())
            maximum = _json_scalar(non_null.max())

    counts = series.value_counts(dropna=True).head(max(top_n, 0))
    top_values = [[_json_scalar(value), int(count)] for value, count in counts.items()]

    return ColumnProfile(
        name=name,
        dtype=str(series.dtype),
        null_count=null_count,
        null_rate=null_rate,
        distinct_count=distinct_count,
        minimum=minimum,
        maximum=maximum,
        top_values=top_values,
    )


def _json_scalar(value: object) -> object:
    """Coerce a pandas/numpy scalar to a JSON-serialisable Python value.

    Numbers become ``int``/``float``; datetimes and everything else become their
    string form, so a profile record never carries a pandas/numpy object across
    the run-log seam.
    """
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    item = getattr(value, "item", None)
    if callable(item):
        try:
            value = item()
        except (ValueError, TypeError):
            return str(value)
    if isinstance(value, (int, float)):
        return value
    return str(value)


class ProfileBaseline(Protocol):
    """The slice of the run registry a profile baseline needs.

    Anything that can answer "what were the recent profiles recorded at this
    address?" is a baseline source; ``RunRegistry.recent_profiles`` is the
    production one. Stated as a Protocol so the drift logic stays behind a narrow
    seam and is exercised in isolation — mirrors ``RunHistory`` for volume.
    """

    def recent_profiles(self, address: str, limit: int = ...) -> list[dict]: ...


class ProfileDriftCheck:
    """Report columns whose null rate has drifted from recent run history.

    The statistical analogue of ``VolumeAnomalyValidator``: where that watches one
    number (row count) against a median baseline, this watches each column's
    **null rate** against the median null rate of the same column over the feed's
    recent profiled runs, and reports every column whose rate moved by more than
    ``null_rate_tolerance`` (an absolute change in the 0–1 rate, so ``0.2`` is a
    twenty-point swing). That catches the silent regression a row-count check
    misses — a column sliding 5% → 60% null while every row stays individually
    valid.

    The baseline is sourced from run history (:class:`ProfileBaseline`,
    ``RunRegistry`` in production) keyed by the profile node's stable
    ``step_address``, never a hand-set per-column threshold. With fewer than
    ``min_history`` prior profiled runs the band is skipped so a feed's first
    nights don't trip spuriously. ``columns`` optionally narrows the check to a
    watch-list. :meth:`check` only *reports* — the profile node owns whether a
    report warns or fails, like any Validator's severity.
    """

    def __init__(
        self,
        baseline: ProfileBaseline,
        address: str,
        *,
        null_rate_tolerance: float = 0.2,
        min_history: int = 3,
        lookback: int = 10,
        columns: Iterable[str] | None = None,
    ) -> None:
        self._baseline = baseline
        self._address = address
        self._null_rate_tolerance = null_rate_tolerance
        self._min_history = min_history
        self._lookback = lookback
        self._columns = tuple(columns) if columns is not None else None

    def check(self, profile: DatasetProfile) -> list[str]:
        """Return one message per column whose null rate breached tolerance.

        Empty when nothing drifted, when history is too short for a baseline, or
        when no prior run profiled a given column.
        """
        records = self._baseline.recent_profiles(self._address, limit=self._lookback)
        if len(records) < self._min_history:
            return []
        priors = [DatasetProfile.from_record(rec) for rec in records]

        messages: list[str] = []
        for col in profile.columns:
            if self._columns is not None and col.name not in self._columns:
                continue
            history = [
                prior_col.null_rate
                for prior in priors
                if (prior_col := prior.column(col.name)) is not None
            ]
            if len(history) < self._min_history:
                continue
            baseline = statistics.median(history)
            delta = abs(col.null_rate - baseline)
            if delta > self._null_rate_tolerance:
                messages.append(
                    f"{col.name}: null rate {col.null_rate:.1%} deviates from "
                    f"recent baseline {baseline:.1%} "
                    f"(tolerance ±{self._null_rate_tolerance:.0%} over "
                    f"{len(history)} runs)"
                )
        return messages

    def describe(self) -> str:
        return render(
            self,
            address=self._address,
            null_rate_tolerance=self._null_rate_tolerance,
            min_history=self._min_history,
            lookback=self._lookback,
            columns=list(self._columns) if self._columns is not None else None,
        )


class DataProfiler:
    """The injected profiler ``Pipeline.profile`` drives — the application-layer
    statistical computation behind the framework's
    :class:`~framework.core.protocols.DatasetProfiler` port.

    It bundles the cost-bounding knobs (``columns`` allow-list, ``top_n``) and the
    optional run-over-run drift check into one component the pipeline wires in, so
    the framework stays free of any profiling logic — it only calls
    :meth:`profile` and records what it returns. When a ``baseline`` is given an
    ``address`` must be too (the stable ``step_address`` to trend against); a
    drift beyond tolerance either *warns* (returned as messages the node logs) or,
    in ``"fail"`` severity, raises :class:`ProfileError` — the same warn/fail
    escape hatch a Validator gets.
    """

    def __init__(
        self,
        *,
        columns: Iterable[str] | None = None,
        top_n: int = DEFAULT_TOP_N,
        baseline: ProfileBaseline | None = None,
        address: str | None = None,
        null_rate_tolerance: float = 0.2,
        min_history: int = 3,
        lookback: int = 10,
        severity: str = "warn",
    ) -> None:
        self._columns = tuple(columns) if columns is not None else None
        self._top_n = top_n
        self._severity = severity
        if baseline is not None:
            if address is None:
                raise ValueError("a baseline needs an address to trend against")
            self._drift: ProfileDriftCheck | None = ProfileDriftCheck(
                baseline,
                address,
                null_rate_tolerance=null_rate_tolerance,
                min_history=min_history,
                lookback=lookback,
                columns=columns,
            )
        else:
            self._drift = None

    def profile(self, dataset: Dataset) -> tuple[dict, list[str]]:
        """Return ``(profile_record, warnings)``; raise in ``fail`` mode on drift.

        Satisfies the framework's ``DatasetProfiler`` port: the record is the
        ``DatasetProfile`` the run log stores, and ``warnings`` are the drift
        messages the node surfaces as ``warn_hits`` (empty when there is no
        baseline or nothing drifted).
        """
        computed = profile_dataset(dataset, columns=self._columns, top_n=self._top_n)
        warnings: list[str] = []
        if self._drift is not None:
            messages = self._drift.check(computed)
            if messages and self._severity == "fail":
                raise ProfileError("; ".join(messages))
            warnings = messages
        return computed.to_record(), warnings

    def describe(self) -> str:
        return render(
            self,
            columns=list(self._columns) if self._columns is not None else None,
            top_n=self._top_n,
            severity=self._severity,
            drift=self._drift.describe() if self._drift is not None else None,
        )

```
