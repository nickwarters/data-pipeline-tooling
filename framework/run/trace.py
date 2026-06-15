"""Generic row-level trace accumulated as pipeline stages run.

``RowTrace`` records how a population changes as processors run: which rows
were considered, which stage first excluded a row, optional scores computed
mid-pipeline, and each survivor's final rank. The framework owns these mechanics
because they are generic pipeline behavior; application code chooses the writer,
identity column, stage labels, and table names that give the trace its domain
meaning.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pandas as pd

from framework.io.dataset import Dataset


@dataclass
class _RowVerdict:
    """The running verdict for one considered row, mutated as stages observe it."""

    passed: list[str] = field(default_factory=list)
    score: Any = None
    verdict: str = "selected"
    reason: str | None = None


class RowTrace:
    """Accumulate a per-row verdict as a pipeline's stages run."""

    def __init__(self, id_column: str, *, score_column: str | None = None) -> None:
        self._id_column = id_column
        self._score_column = score_column
        self._rows: dict[Any, _RowVerdict] = {}
        self._considered = 0

    def consider(self, dataset: Dataset) -> None:
        """Seed the ledger with the population entering the traced stages."""
        ids = dataset.to_pandas()[self._id_column]
        for row_id in ids:
            self._rows.setdefault(row_id, _RowVerdict())
        self._considered = len(self._rows)

    def observe(
        self, role: str | None, name: str, before: Dataset, after: Dataset
    ) -> None:
        """Record what one stage did to each row."""
        after_frame = after.to_pandas()
        before_ids = list(before.to_pandas()[self._id_column])
        after_ids = set(after_frame[self._id_column])

        if role == "score" and self._score_column in after_frame.columns:
            for row_id, value in zip(
                after_frame[self._id_column], after_frame[self._score_column]
            ):
                if row_id in self._rows:
                    self._rows[row_id].score = value
            return

        for row_id in before_ids:
            row = self._rows.get(row_id)
            if row is None or row.verdict == "excluded":
                continue
            if row_id in after_ids:
                if role in ("filter", "join"):
                    row.passed.append(name)
            else:
                row.verdict = "excluded"
                row.reason = f"excluded by {role or 'stage'} {name!r}"

    def finalize(self, survivors: Dataset) -> Dataset:
        """Stamp ranks on survivors and emit the trace as a ``Dataset``."""
        ranks = {
            row_id: position
            for position, row_id in enumerate(
                survivors.to_pandas()[self._id_column], start=1
            )
        }

        rows = []
        for row_id, verdict in self._rows.items():
            if verdict.verdict == "selected":
                passed = (
                    ", ".join(verdict.passed)
                    if verdict.passed
                    else "no eligibility gates"
                )
                reason = f"passed {passed}"
                rank = ranks.get(row_id)
            else:
                reason = verdict.reason
                rank = None
            row = {
                self._id_column: row_id,
                "verdict": verdict.verdict,
                "reason": reason,
                "rank": rank,
            }
            if self._score_column is not None:
                row["score"] = verdict.score
            rows.append(row)

        return Dataset.from_pandas(pd.DataFrame(rows))

    @property
    def considered(self) -> int:
        """How many rows entered the traced stages."""
        return self._considered

    @property
    def excluded(self) -> int:
        """How many considered rows a stage excluded."""
        return sum(1 for row in self._rows.values() if row.verdict == "excluded")

    @property
    def selected(self) -> int:
        """How many rows survived."""
        return sum(1 for row in self._rows.values() if row.verdict == "selected")
