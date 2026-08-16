"""Every scheduled pipeline's subject is under migration control.

The self-declaring rule (decision 2 on #685) is what makes converting subjects
one at a time possible: a database carrying the ``schema_migrations`` ledger is
strict, one without it behaves as it always has. The cost of that cheapness is
that **forgetting is silent** — a deployed feed with no migrations directory does
not fail, it just quietly keeps creating its tables on first write with whatever
dtypes the frame happened to carry and no keys at all. Nothing else in the system
would notice.

So this is the thing that notices, and it works out what to guard rather than
being told:

* **What is deployed** is what an application schedules. A pipeline reaches a
  real environment by being named in an app's ``schedules.py`` — that is what
  ``python -m cli orchestrate --app`` runs, night after night — so appearing
  there *is* being deployed. Every ``<app>/schedules.py`` in the tree is read;
  nothing lists which apps exist.
* **What it writes** is the subject it declares (``SUBJECT`` / ``FEED_NAME`` /
  ``NAMESPACE``). A scheduled pipeline declaring none is itself the failure,
  because then nothing can tell what it writes.
* **What is covered** is the ``migrations/`` tree, which is already the only
  registry of which databases are under migration control.

All three are read from the repository. There is no list here to maintain when a
pipeline is added, renamed or deleted: a pipeline that is not deployed is not
mentioned, and one that becomes deployed is picked up by the act of scheduling
it. The converse — an orphaned migrations directory left behind by a pipeline
that has gone — is caught the same way, from the same two sources.

Like ``tests/integration/test_public_api.py``, the check self-tests: a guard
that has quietly stopped finding anything passes every assertion it makes.
"""

from __future__ import annotations

import importlib
from pathlib import Path

from tools.migrations import MIGRATIONS_ROOT, discover_targets

ROOT = Path(__file__).resolve().parents[2]
PIPELINES = ROOT / "pipelines"

# The module-level names a pipeline declares the subject it *writes* under.
# Not ``SYNC_SUBJECT``: that is a subject this pipeline only reads, owned and
# covered by the pipeline that writes it.
DECLARATIONS = ("SUBJECT", "FEED_NAME", "NAMESPACE")


def schedule_modules() -> list[str]:
    """Every application schedules module in the tree.

    An application exposes ``build_pipeline_sets()`` from ``<app>/schedules.py``
    and an operator names it with ``orchestrate --app``. Found by looking rather
    than by being listed, so a second application is covered the day it appears.
    """
    return [
        f"{path.parent.name}.schedules"
        for path in sorted(ROOT.glob("*/schedules.py"))
        if (path.parent / "__init__.py").exists()
    ]


def scheduled_pipelines() -> dict[str, set[str]]:
    """Pipeline module -> the schedules module(s) that deploy it.

    A ``ScheduledPipeline`` addresses its pipeline by path — ``pipelines/<name>``,
    the same address ``python -m cli run`` takes — which maps to the module the
    runner imports.
    """
    deployed: dict[str, set[str]] = {}
    for name in schedule_modules():
        module = importlib.import_module(name)
        for pipeline_set in module.build_pipeline_sets():
            for scheduled in pipeline_set.pipelines:
                leaf = Path(scheduled.path).name
                deployed.setdefault(f"pipelines.{leaf}.pipeline", set()).add(name)
    return deployed


def declared_subject(module_name: str) -> str | None:
    """The subject a pipeline module says it writes, or ``None`` if it says none."""
    module = importlib.import_module(module_name)
    for declaration in DECLARATIONS:
        value = getattr(module, declaration, None)
        if isinstance(value, str) and value:
            return value
    return None


def writing_pipelines() -> dict[str, set[str]]:
    """Subject -> every pipeline module in the tree that declares it writes it.

    Both shapes the tree holds: a ``pipelines/<feed>/pipeline.py`` subpackage
    (what ``scaffold`` renders) and a bare ``pipelines/<name>.py`` module.
    """
    modules = []
    for path in sorted(PIPELINES.iterdir()):
        if path.is_dir() and (path / "pipeline.py").exists():
            modules.append(f"pipelines.{path.name}.pipeline")
        elif path.suffix == ".py" and path.name != "__init__.py":
            modules.append(f"pipelines.{path.stem}")

    subjects: dict[str, set[str]] = {}
    for name in modules:
        subject = declared_subject(name)
        if subject is not None:
            subjects.setdefault(subject, set()).add(name)
    return subjects


def migrated_subjects() -> set[str]:
    return {target.subject for target in discover_targets(MIGRATIONS_ROOT)}


def test_every_scheduled_pipeline_writes_a_subject_under_migration_control():
    # The guard itself. A deployed feed with no migrations directory does not
    # fail on its own — it quietly keeps creating its tables — so this is what
    # makes the omission visible, on the day the pipeline is scheduled.
    migrated = migrated_subjects()
    unaccounted = []
    for module, schedules in sorted(scheduled_pipelines().items()):
        subject = declared_subject(module)
        where = ", ".join(sorted(schedules))
        if subject is None:
            unaccounted.append(
                f"  {module} (scheduled by {where}) declares no "
                f"{' / '.join(DECLARATIONS)}, so nothing can tell what it writes"
            )
        elif subject not in migrated:
            unaccounted.append(
                f"  {module} (scheduled by {where}) writes {subject!r}, which has "
                f"no migrations/{subject}/ directory"
            )

    assert not unaccounted, (
        "these pipelines are scheduled to run in a real environment but their "
        "tables are not declared by any migration:\n" + "\n".join(unaccounted)
    )


def test_no_migrations_directory_is_orphaned():
    # The other direction, and the "existing pipeline deleted or renamed" case: a
    # migrations directory for a subject nothing writes any more is dead weight
    # that would silently apply itself to a future feed reusing the name.
    written = set(writing_pipelines())
    orphaned = sorted(migrated_subjects() - written)

    assert not orphaned, (
        f"no pipeline declares it writes these migrated subjects: {orphaned}. "
        "Either the pipeline was renamed or deleted and its migrations should "
        "go with it, or it no longer declares the subject it writes."
    )


# --- the check checks itself -------------------------------------------------


def test_the_schedules_are_still_being_found_and_read():
    # Every assertion above passes vacuously if this enumeration returns nothing,
    # which is exactly how a guard stops guarding without anyone noticing.
    modules = schedule_modules()
    deployed = scheduled_pipelines()

    assert "case_review.schedules" in modules
    assert "pipelines.sharepoint_cases.pipeline" in deployed
    assert "pipelines.reviewer_activity.pipeline" in deployed


def test_a_scheduled_pipeline_with_no_migrations_would_be_caught():
    # The failure the guard exists for, driven directly: a feed added to an
    # application's schedules whose author did not add a migrations directory.
    migrated = migrated_subjects()
    fabricated = {"pipelines.sharepoint_cases.pipeline": "sharepoint_cases"}
    fabricated["pipelines.brand_new_feed.pipeline"] = "brand_new_feed"

    caught = [
        module for module, subject in fabricated.items() if subject not in migrated
    ]

    assert caught == ["pipelines.brand_new_feed.pipeline"]


def test_a_scheduled_pipeline_declaring_no_subject_would_be_caught():
    # Declaring nothing must not be a way past the check: it is the failure, not
    # an omission the check shrugs at.
    assert declared_subject("pipelines.comprehensive_examples.pipeline") is None
    assert declared_subject("pipelines.sharepoint_cases.pipeline") == "sharepoint_cases"


def test_an_orphaned_migrations_directory_would_be_caught():
    written = set(writing_pipelines())

    assert sorted({"sharepoint_cases", "deleted_feed"} - written) == ["deleted_feed"]


def test_a_subject_only_read_is_not_treated_as_one_this_pipeline_writes():
    # reviewer_activity and notifications both read Sync's gold. Attributing
    # sharepoint_cases to them would make the orphan check pass for a directory
    # whose own pipeline had gone.
    assert declared_subject("pipelines.reviewer_activity.pipeline") == (
        "reviewer_activity"
    )
    assert declared_subject("pipelines.notifications.pipeline") == "notifications"


def test_the_pipeline_tree_is_still_being_walked():
    subjects = writing_pipelines()

    assert subjects["sharepoint_cases"] == {"pipelines.sharepoint_cases.pipeline"}
    assert len(subjects) >= 9
