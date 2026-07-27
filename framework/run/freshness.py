"""The one rule that decides whether a declared upstream is fresh enough.

Two callers ask this question and they must never disagree: the runner's
:class:`~framework.run.runner.FreshnessGuard`, which blocks a run that starts
too early, and the orchestration plan preview, which promises an operator *this
is what will happen*. A preview maintained by a parallel copy of the rule keeps
that promise by discipline; stating the rule once keeps it by construction.

The rule is a pure predicate — it reads run history and returns a
:class:`FreshnessVerdict`. Nothing here logs, raises, or writes: the guard is
the side-effecting wrapper (record to the run log, raise) and the plan is the
read-only caller, so each presents the same verdict in its own idiom.

The comparison itself mixes two clocks, and the conversion is the whole reason
this is delicate: a stored run timestamp is a UTC instant, a run date is a local
calendar date, so the instant is moved into the local zone before its date is
taken. See ``tools.observability.timestamps`` for why.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Protocol

from framework.run.address import RunAddress
from tools.observability.timestamps import local_date


@dataclass(frozen=True)
class FreshnessRequirement:
    """The upstream domain Pipeline a run requires to be current."""

    upstream_pipeline: str
    upstream_subject: str | None = None
    max_age_days: int = 0

    def as_requirement(self, default_subject: str | None = None) -> "Requirement":
        """Return the equivalent public requirement predicate."""

        return Requirement.succeeded(
            RunAddress.for_pipeline(
                self.upstream_pipeline,
                subject=self.upstream_subject or default_subject,
            )
        ).within_days(self.max_age_days)


@dataclass(frozen=True)
class Requirement:
    """A run-history predicate that must pass before a downstream run starts."""

    address: RunAddress
    max_age_days: int | None = None
    require_same_day: bool = False
    first_run_policy: str = "warn"

    @classmethod
    def succeeded(cls, address: RunAddress | str) -> "Requirement":
        """Require a successful run record for a pipeline or task address."""

        target = RunAddress.parse(address) if isinstance(address, str) else address
        return cls(target)

    def within_days(self, days: int) -> "Requirement":
        """Require the latest success to be on or after run date minus ``days``."""

        if days < 0:
            raise ValueError("days must be zero or greater")
        return Requirement(
            self.address,
            max_age_days=days,
            require_same_day=False,
            first_run_policy=self.first_run_policy,
        )

    def same_day(self) -> "Requirement":
        """Require a success on the downstream run date."""

        return Requirement(
            self.address,
            max_age_days=self.max_age_days,
            require_same_day=True,
            first_run_policy=self.first_run_policy,
        )

    def on_first_run(self, policy: str) -> "Requirement":
        """Set the no-history policy: ``allow``, ``warn``, or ``block``."""

        if policy not in {"allow", "warn", "block"}:
            raise ValueError("first-run policy must be 'allow', 'warn', or 'block'")
        return Requirement(
            self.address,
            max_age_days=self.max_age_days,
            require_same_day=self.require_same_day,
            first_run_policy=policy,
        )


@dataclass(frozen=True)
class FreshnessVerdict:
    """What the freshness rule decided, with the sentence explaining it.

    ``reason`` is prose for a human — an error message when unsatisfied, the
    first-run warning when satisfied without history, empty otherwise. No caller
    should branch on its text; ``satisfied`` and ``first_run`` carry the decision.
    """

    satisfied: bool
    reason: str = ""
    first_run: bool = False


class RunHistory(Protocol):
    """The slice of the run registry the freshness rule reads."""

    def latest_success(self, address: RunAddress) -> dict | None: ...


def as_requirement(
    requirement: FreshnessRequirement | Requirement,
    default_subject: str | None = None,
) -> Requirement:
    """Normalise either requirement flavour to the one predicate type.

    ``default_subject`` is the caller's context: a subject-qualified run supplies
    its own subject so a bare upstream name resolves within it, while a
    path-addressed one has no subject and passes ``None``.
    """
    if isinstance(requirement, FreshnessRequirement):
        return requirement.as_requirement(default_subject=default_subject)
    if isinstance(requirement, Requirement):
        return requirement
    raise TypeError(f"unsupported requirement type {requirement!r}")


def evaluate_requirement(
    requirement: FreshnessRequirement | Requirement,
    run_history: RunHistory,
    *,
    run_date: dt.date,
    label: str,
    freshness_days: int = 0,
    default_subject: str | None = None,
) -> FreshnessVerdict:
    """Decide whether ``requirement`` is satisfied for a run on ``run_date``.

    ``label`` names the downstream the requirement is being checked *for*, so the
    sentence an operator reads identifies both ends of the dependency.
    ``freshness_days`` is the run-wide floor: a requirement's own ``max_age_days``
    only ever tightens or matches it, never loosens it.
    """
    predicate = as_requirement(requirement, default_subject)
    latest = run_history.latest_success(predicate.address)

    if latest is None:
        message = f"no successful run history for upstream {predicate.address.label}"
        if predicate.first_run_policy == "block":
            return FreshnessVerdict(
                satisfied=False,
                reason=f"{message}; blocking first run",
                first_run=True,
            )
        warning = f"{message}; allowing first run"
        return FreshnessVerdict(
            satisfied=True,
            reason=warning if predicate.first_run_policy == "warn" else "",
            first_run=True,
        )

    # The stored instant is UTC and the run date is a local calendar date, so the
    # instant is converted before its date is taken. Comparing the raw UTC date
    # would call an upstream that landed just after local midnight "yesterday"
    # and block a perfectly fresh downstream.
    latest_date = local_date(latest["timestamp"])

    if predicate.require_same_day:
        if latest_date == run_date:
            return FreshnessVerdict(satisfied=True)
        return FreshnessVerdict(
            satisfied=False,
            reason=(
                f"upstream {predicate.address.label} is stale: latest successful "
                f"run was {latest_date.isoformat()}, required on "
                f"{run_date.isoformat()} for {label}"
            ),
        )

    max_age_days = (
        freshness_days
        if predicate.max_age_days is None
        else max(predicate.max_age_days, freshness_days)
    )
    oldest_allowed = run_date - dt.timedelta(days=max_age_days)
    if latest_date >= oldest_allowed:
        return FreshnessVerdict(satisfied=True)

    return FreshnessVerdict(
        satisfied=False,
        reason=(
            f"upstream {predicate.address.label} is stale: latest successful run "
            f"was {latest_date.isoformat()}, required on or after "
            f"{oldest_allowed.isoformat()} for {label}"
        ),
    )
