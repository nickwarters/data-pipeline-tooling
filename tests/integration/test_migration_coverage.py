"""Every subject that lands in a real environment is under migration control.

The self-declaring rule (decision 2 on #685) is what makes converting subjects
one at a time possible: a database carrying the ``schema_migrations`` ledger is
strict, one without it behaves as it always has. The cost of that cheapness is
that **forgetting is silent** — a new deployed feed with no migrations directory
does not fail, it just quietly keeps creating its tables on first write with
whatever dtypes the frame happened to carry and no keys at all. Nothing else in
the system would notice.

So this is the thing that notices. Every subject a pipeline writes must either
have a ``migrations/<subject>/`` directory or appear below with a reason.

**A pipeline declares the subject it writes** as a module-level ``SUBJECT`` /
``FEED_NAME`` / ``NAMESPACE``. A subject it only *reads* — ``SYNC_SUBJECT`` — is
another pipeline's to own, and is covered where that pipeline is.

Like ``tests/integration/test_public_api.py``, the check self-tests: it asserts
it can still find the subjects it is supposed to be guarding, and that a
fabricated unmigrated subject is actually caught. A guard that has quietly
stopped guarding passes every test it has unless one of them is about the guard.
"""

from __future__ import annotations

import importlib
from pathlib import Path

import pytest

from tools.migrations import MIGRATIONS_ROOT, discover_targets

ROOT = Path(__file__).resolve().parents[2]
PIPELINES = ROOT / "pipelines"

# The module-level names a pipeline declares the subject it *writes* under.
# Not ``SYNC_SUBJECT``: that is a subject this pipeline only reads, owned and
# covered by the pipeline that writes it.
DECLARATIONS = ("SUBJECT", "FEED_NAME", "NAMESPACE")

# Subjects that are deliberately not under migration control, and why. Each of
# these is written only into a ``tmp_path`` inside tests and is not deployed
# state; none of them has a database anybody would have to migrate.
#
# Keyed by *subject* rather than by pipeline because a subject is what a
# migrations directory is named after — and two pipelines can share one, as
# ``ingest`` and ``selection`` share ``cases``.
EXCLUDED_SUBJECTS = {
    "cases": (
        "demonstration pipelines (ingest, selection); the walking-skeleton "
        "subject, written only into tmp_path by tests"
    ),
    "case_selection": (
        "demonstration pipeline; the person-targeted selection example, not "
        "deployed state"
    ),
    "complaints_a": "example Case Type feed; no deployed database",
    "complaints_b": "example Case Type feed; no deployed database",
    "complaints_c": "example Case Type feed; no deployed database",
    "ref_lookup": "example reference-table feed; no deployed database",
    "retail_analytics": "example analytics feed; no deployed database",
    "wide_cases": "demonstration fan-out (demo_fan_out); no deployed database",
}

# Pipelines that declare no subject at all: they build their store names inline
# because they exist to demonstrate a mechanism rather than to land a feed.
# Listed so that a *deployed* pipeline which simply forgot to declare one cannot
# slip past the check by declaring nothing.
UNDECLARED_PIPELINES = {
    "pipelines.comprehensive_examples.pipeline": (
        "a tour of every primitive, wiring stores inline under tmp_path"
    ),
    **{
        f"pipelines.demo_{name}.pipeline": (
            "orchestration schedule demonstration; writes nothing deployed"
        )
        for name in (
            "later",
            "overdue",
            "report",
            "steady",
            "tomorrow",
            "urgent",
            "very_overdue",
        )
    },
}


def pipeline_modules() -> list[str]:
    """Every runnable pipeline module under ``pipelines/``.

    Both shapes the tree holds: a ``pipelines/<feed>/pipeline.py`` subpackage
    (what ``scaffold`` renders) and a bare ``pipelines/<name>.py`` module.
    """
    modules = []
    for path in sorted(PIPELINES.iterdir()):
        if path.is_dir() and (path / "pipeline.py").exists():
            modules.append(f"pipelines.{path.name}.pipeline")
        elif path.suffix == ".py" and path.name != "__init__.py":
            modules.append(f"pipelines.{path.stem}")
    return modules


def declared_subjects() -> dict[str, set[str]]:
    """Subject -> the pipeline module(s) that declare they write it."""
    subjects: dict[str, set[str]] = {}
    for name in pipeline_modules():
        module = importlib.import_module(name)
        for declaration in DECLARATIONS:
            value = getattr(module, declaration, None)
            if isinstance(value, str) and value:
                subjects.setdefault(value, set()).add(name)
    return subjects


def migrated_subjects() -> set[str]:
    return {target.subject for target in discover_targets(MIGRATIONS_ROOT)}


def test_every_subject_a_pipeline_writes_is_migrated_or_excluded():
    # The guard itself. A new deployed feed with no migrations directory does
    # not fail on its own — it quietly keeps creating its tables — so this is
    # what makes the omission visible.
    migrated = migrated_subjects()
    unaccounted = {
        subject: sorted(writers)
        for subject, writers in declared_subjects().items()
        if subject not in migrated and subject not in EXCLUDED_SUBJECTS
    }

    assert not unaccounted, (
        "these subjects are written by a pipeline but are neither under "
        "migration control nor excluded:\n"
        + "\n".join(
            f"  {subject} (written by {', '.join(writers)}) — add "
            f"migrations/{subject}/, or add it to EXCLUDED_SUBJECTS with a reason"
            for subject, writers in sorted(unaccounted.items())
        )
    )


def test_every_pipeline_either_declares_its_subject_or_says_why_it_does_not():
    # The other half: declaring nothing must not be a way past the check.
    declared = {
        module for writers in declared_subjects().values() for module in writers
    }
    silent = [
        module
        for module in pipeline_modules()
        if module not in declared and module not in UNDECLARED_PIPELINES
    ]

    assert not silent, (
        "these pipelines declare no SUBJECT / FEED_NAME / NAMESPACE, so the "
        "coverage check cannot see what they write:\n"
        + "\n".join(f"  {module}" for module in silent)
    )


def test_the_three_deployed_subjects_are_the_ones_under_migration_control():
    # What "deployed" means today: the two subjects case_review/schedules.py
    # orchestrates, and the ledger subject notifications writes. Stated as an
    # equality so that adding a migrations directory for something else, or
    # dropping one of these, is a decision someone has to make here.
    assert migrated_subjects() == {
        "sharepoint_cases",
        "reviewer_activity",
        "notifications",
    }


# --- the check checks itself -------------------------------------------------


def test_the_enumeration_still_finds_the_subjects_it_is_guarding():
    # A guard that has quietly stopped finding anything passes every assertion
    # above. So: the enumeration must still see the deployed subjects, and see
    # them attributed to the pipelines that actually write them.
    subjects = declared_subjects()

    assert subjects["sharepoint_cases"] == {"pipelines.sharepoint_cases.pipeline"}
    assert subjects["reviewer_activity"] == {"pipelines.reviewer_activity.pipeline"}
    assert subjects["notifications"] == {"pipelines.notifications.pipeline"}
    assert len(subjects) >= 9


def test_a_subject_only_read_is_not_treated_as_one_this_pipeline_writes():
    # reviewer_activity and notifications both read Sync's gold. Attributing
    # sharepoint_cases to them would be harmless today (it is migrated) and
    # wrong the moment a pipeline reads an excluded subject.
    subjects = declared_subjects()

    assert "pipelines.reviewer_activity.pipeline" not in subjects["sharepoint_cases"]
    assert "pipelines.notifications.pipeline" not in subjects["sharepoint_cases"]


def test_an_unmigrated_unexcluded_subject_would_be_caught():
    # The failure the guard exists for, driven directly: a new deployed feed
    # whose author did not add a migrations directory.
    fabricated = {**declared_subjects(), "brand_new_feed": {"pipelines.new.pipeline"}}
    migrated = migrated_subjects()

    unaccounted = [
        subject
        for subject in fabricated
        if subject not in migrated and subject not in EXCLUDED_SUBJECTS
    ]

    assert unaccounted == ["brand_new_feed"]


def test_no_exclusion_is_stale():
    # An exclusion for a subject nothing writes any more is dead weight that
    # would silently cover a future feed that happened to reuse the name.
    declared = set(declared_subjects())
    orphaned = sorted(set(EXCLUDED_SUBJECTS) - declared)

    assert not orphaned, (
        f"no pipeline writes these excluded subjects any more: {orphaned}. "
        "Remove them from EXCLUDED_SUBJECTS."
    )


def test_nothing_is_both_excluded_and_migrated():
    # If one of these gains a baseline, its exclusion is obsolete and the reason
    # attached to it has stopped being true.
    both = sorted(set(EXCLUDED_SUBJECTS) & migrated_subjects())

    assert not both, (
        f"these subjects are excluded but also have migrations: {both}. "
        "Remove the exclusion — it is now saying something untrue."
    )


def test_every_exclusion_carries_a_reason():
    blank = sorted(
        subject
        for subject, reason in {**EXCLUDED_SUBJECTS, **UNDECLARED_PIPELINES}.items()
        if not reason.strip()
    )

    assert not blank, f"these exclusions carry no reason: {blank}"


@pytest.mark.parametrize("module", sorted(UNDECLARED_PIPELINES))
def test_a_pipeline_excused_from_declaring_still_exists(module):
    # The other kind of stale entry: an excuse for a module that has since been
    # renamed or deleted would quietly excuse nothing.
    assert module in pipeline_modules()
