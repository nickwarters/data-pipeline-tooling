"""Selection explainability — a per-Case trace accumulated as stages run (#53).

Selection narrows the CasePool into the SelectionPool through a *sequence* of
processors (``Filter``/``Score``/``Sort``/``JoinWith`` — see
:mod:`framework.processors`). Each gate **silently drops** the Cases it excludes
(ADR-0002), so the selection decision — itself a governed act on this review
platform — leaves no trace of *why* a given adviser's Case was or wasn't picked
up. That is the gap #53 closes.

``SelectionTrace`` is the ledger that watches Selection run. It is the
eligibility-stage twin of row-level quarantine (#50,
:mod:`framework.quarantine`): where quarantine partitions *once* on validity,
the trace follows each Case across *every* stage, recording the gate that
excluded it, the score it carried, and — for survivors — where it ranked. The
pipeline seeds it with the considered population, lets it ``observe`` each
stage, then ``finalize``s it against the surviving SelectionPool into a sibling
trace ``Dataset`` the explain Writer lands stamped by ``run_id`` (ADR-0007
amendment 02).

The ledger holds only plain-Python bookkeeping; it reaches the engine through
the ``Dataset`` seam (``to_pandas``/``from_pandas``) exactly as a processor does
(ADR-0002).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pandas as pd

from framework.dataset import Dataset


@dataclass
class _CaseTrace:
    """The running verdict for one considered Case, mutated as stages observe it."""

    passed: list[str] = field(default_factory=list)
    score: Any = None
    verdict: str = "selected"
    reason: str | None = None


class SelectionTrace:
    """Accumulate a per-Case verdict as Selection's stages run.

    Keyed by the Case identity column (``id_column``). A Case starts ``selected``
    and is demoted to ``excluded`` the first time a stage drops it; the stage's
    located label becomes the reason. Survivors record the gates they passed and
    their rank in the final SelectionPool order. ``score_column``, when given,
    is snapshotted for every Case still present when it is computed — so a Case
    excluded later still carries the score it earned (#53 AC2).
    """

    def __init__(self, id_column: str, *, score_column: str | None = None) -> None:
        self._id_column = id_column
        self._score_column = score_column
        self._cases: dict[Any, _CaseTrace] = {}
        self._considered = 0

    def consider(self, dataset: Dataset) -> None:
        """Seed the ledger with the population entering Selection."""
        ids = dataset.to_pandas()[self._id_column]
        for case_id in ids:
            self._cases.setdefault(case_id, _CaseTrace())
        self._considered = len(self._cases)

    def observe(self, role: str | None, name: str, before: Dataset, after: Dataset) -> None:
        """Record what one stage did to each Case.

        Any id present *before* and absent *after* was dropped by this stage:
        the first such drop excludes the Case, located by the stage's label. A
        ``"score"`` stage instead snapshots the score column for the ids that
        survived it. Gate stages (``"filter"``/``"join"``) that a Case survives
        are appended to its passed list, so a survivor reads "passed A, B".
        """
        after_frame = after.to_pandas()
        before_ids = list(before.to_pandas()[self._id_column])
        after_ids = set(after_frame[self._id_column])

        if role == "score" and self._score_column in after_frame.columns:
            for case_id, value in zip(
                after_frame[self._id_column], after_frame[self._score_column]
            ):
                if case_id in self._cases:
                    self._cases[case_id].score = value
            return

        for case_id in before_ids:
            case = self._cases.get(case_id)
            if case is None or case.verdict == "excluded":
                continue
            if case_id in after_ids:
                if role in ("filter", "join"):
                    case.passed.append(name)
            else:
                case.verdict = "excluded"
                case.reason = f"excluded by {role or 'stage'} {name!r}"

    def finalize(self, selection_pool: Dataset) -> Dataset:
        """Stamp ranks on the survivors and emit the trace as a ``Dataset``.

        The SelectionPool's row order *is* the ranking (a ``Sort`` upstream made
        it meaningful), so each surviving Case's rank is its 1-based position.
        Excluded Cases keep their drop reason and last-seen score with no rank.
        Survivors' reason summarises the gates they passed.
        """
        ranks = {
            case_id: position
            for position, case_id in enumerate(
                selection_pool.to_pandas()[self._id_column], start=1
            )
        }

        rows = []
        for case_id, case in self._cases.items():
            if case.verdict == "selected":
                passed = ", ".join(case.passed) if case.passed else "no eligibility gates"
                reason = f"passed {passed}"
                rank = ranks.get(case_id)
            else:
                reason = case.reason
                rank = None
            row = {
                self._id_column: case_id,
                "verdict": case.verdict,
                "reason": reason,
                "rank": rank,
            }
            if self._score_column is not None:
                row["score"] = case.score
            rows.append(row)

        return Dataset.from_pandas(pd.DataFrame(rows))

    @property
    def considered(self) -> int:
        """How many Cases entered Selection."""
        return self._considered

    @property
    def excluded(self) -> int:
        """How many considered Cases a gate excluded."""
        return sum(1 for c in self._cases.values() if c.verdict == "excluded")

    @property
    def selected(self) -> int:
        """How many Cases survived to the SelectionPool."""
        return sum(1 for c in self._cases.values() if c.verdict == "selected")
