"""Which Question Bank outcomes count as a pass, per Case Type, per report.

A ``PassRule`` names one way of drawing the pass/fail line over a bank's
**Outcome Options**. Different reports draw it differently -- one treats
"Good with process enhancement" as a pass, another as a fail -- so a rule is
named, and a report picks its rule by name. This is a *reporting* judgement
and lives only here: the review platform keeps its own idea of a failure
(``is_failure`` in ``platform_frontend/docs/reporting-data-contract.md``, which
calls every non-default outcome a fail) for its own UI, and nothing under
``platform_frontend/`` is consulted or changed.

Every rule must classify **every** outcome id the bank declares for a Case
Type it covers, once. That completeness is checked against the current bank
at run time by the reduction that applies the rule
(``pipelines/cora_platform_metric/metrics.answer_pass_rate``): a new outcome
added to a bank is a run failure naming the rule, the Case Type and the id,
not a silent pass or fail. That is the point.

A declaration, like ``pipelines/schedules.py``: plain dicts and tuples, read
by the reduction as its default and replaced by a test with its own.
"""

from __future__ import annotations

from dataclasses import dataclass

__all__ = ["PASS_RULES", "STANDARD", "STRICT", "PassRule"]

PASS = "pass"
FAIL = "fail"


@dataclass(frozen=True)
class PassRule:
    """One named way of classifying a bank's outcome ids as pass or fail."""

    name: str
    #: case_type -> the outcome ids that PASS under this rule.
    passing: dict[str, tuple[str, ...]]
    #: case_type -> the outcome ids that FAIL. Stated explicitly rather than
    #: implied as "everything else", so the completeness check can hold both
    #: sides against what the bank actually declares.
    failing: dict[str, tuple[str, ...]]

    @property
    def covers(self) -> tuple[str, ...]:
        """The Case Types this rule classifies outcomes for, sorted."""
        return tuple(sorted(set(self.passing) | set(self.failing)))

    def verdict(self, case_type: str, outcome_id: str) -> str:
        """``"pass"`` or ``"fail"``; an outcome the rule does not name is an error."""
        if outcome_id in self.passing.get(case_type, ()):
            return PASS
        if outcome_id in self.failing.get(case_type, ()):
            return FAIL
        raise ValueError(
            f"pass rule {self.name!r} does not classify outcome {outcome_id!r} "
            f"for case type {case_type!r}"
        )


#: The line the pass-rate report draws: a process enhancement is still a pass.
STANDARD = PassRule(
    name="standard",
    passing={"complaints": ("good", "good-with-process-enhancement")},
    failing={"complaints": ("poor", "poor-with-harm")},
)

#: A stricter line for a report that wants process enhancements surfaced.
STRICT = PassRule(
    name="strict",
    passing={"complaints": ("good",)},
    failing={"complaints": ("good-with-process-enhancement", "poor", "poor-with-harm")},
)

#: Every declared rule; ``answer_pass_rate_current`` carries one row family per rule.
PASS_RULES: tuple[PassRule, ...] = (STANDARD, STRICT)
