"""Give a test a base directory whose databases are under migration control.

A subject that has opted in to migrations behaves differently at the write: no
Writer creates a missing table, and ``Refresh`` preserves the DDL rather than
dropping it. A test of such a subject has to run against a migrated base
directory or it is testing the *other* branch — the one the subject no longer
takes in production.

    from tests.framework_testing import migrated_base_dir

    def test_the_feed_lands_its_rows(tmp_path):
        base_dir = migrated_base_dir(tmp_path, "sharepoint_cases")
        feed.run(RunContext(base_dir=base_dir), client=FakeClient())

**It applies the real ``migrations/`` tree.** A test-only DDL path would defeat
the point: the thing worth testing is that the checked-in SQL and the code agree,
so a test that invented its own tables would pass while production failed. That
also means a table a migration forgot fails these tests exactly as it fails a
run — which is the coverage the conversion tickets are buying.

Only subjects that have baselines can be migrated. Asking for one that has no
directory in the tree is an error naming it, rather than a base directory that
silently behaves like the old implicit-creation world and a test that proves
nothing.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from tools.medallion import Medallion, medallion
from tools.migrations import MIGRATIONS_ROOT, MigrationRunner, discover_targets
from tools.store import StoreRegistry

__all__ = [
    "migrated_base_dir",
    "migrated_medallion",
    "migrated_registry",
    "migrate_subject",
]


def migrate_subject(
    base_dir: str | os.PathLike[str],
    subject: str,
    *,
    migrations_root: str | os.PathLike[str] | None = None,
) -> Path:
    """Apply every checked-in migration of ``subject`` under ``base_dir``.

    Returns the base directory, so a caller can wrap a ``tmp_path`` in one
    expression. Every database the subject has a directory for is migrated —
    raw, silver, gold, quarantine, whatever the tree names — because a test that
    migrated only some of them would fail at the first write into one it missed.
    """
    base_dir = Path(base_dir)
    # Resolved at call time, not bound as a default, so a test of this helper can
    # substitute a throwaway tree by patching the module constant.
    migrations_root = MIGRATIONS_ROOT if migrations_root is None else migrations_root
    targets = [
        target
        for target in discover_targets(migrations_root)
        if target.subject == subject
    ]
    if not targets:
        raise LookupError(
            f"no migrations for subject {subject!r} under {migrations_root}. "
            "Only a subject with checked-in baselines can be migrated; a subject "
            "without them still creates its tables on first write, so its tests "
            "need no fixture."
        )
    registry = StoreRegistry(base_dir)
    for target in targets:
        db_path = registry.db_file(target.namespace)
        MigrationRunner(db_path, target.directory).apply()
    return base_dir


def migrated_base_dir(
    tmp_path: str | os.PathLike[str],
    *subjects: str,
    migrations_root: str | os.PathLike[str] | None = None,
) -> Path:
    """A base directory with every named subject migrated into it.

    Several subjects because a pipeline commonly reads one and writes another —
    ``reviewer_activity`` reads the sync subject and writes its own — and both
    ends need to exist before it runs.
    """
    for subject in subjects:
        migrate_subject(tmp_path, subject, migrations_root=migrations_root)
    return Path(tmp_path)


def migrated_registry(
    tmp_path: str | os.PathLike[str],
    *subjects: str,
    migrations_root: str | os.PathLike[str] | None = None,
) -> StoreRegistry:
    """A :class:`~tools.store.StoreRegistry` over a migrated base directory."""
    return StoreRegistry(
        migrated_base_dir(tmp_path, *subjects, migrations_root=migrations_root)
    )


def migrated_medallion(
    tmp_path: str | os.PathLike[str],
    subject: str,
    *,
    migrations_root: str | os.PathLike[str] | None = None,
) -> Medallion:
    """The subject's raw/silver/gold Stores over a migrated base directory."""
    return medallion(
        migrated_registry(tmp_path, subject, migrations_root=migrations_root), subject
    )


@pytest.fixture
def migrated(tmp_path):
    """Migrate subjects into ``tmp_path`` on demand; yields the applying callable.

    The fixture form of :func:`migrated_base_dir` for the common case, where the
    test knows its subject but wants pytest's ``tmp_path``::

        def test_a_run_lands(migrated):
            base_dir = migrated("sharepoint_cases")

    A callable rather than a fixed base directory because which subject(s) a test
    needs is the test's business, and parameterising a fixture per subject would
    put that knowledge in a conftest instead.
    """

    def apply(*subjects: str) -> Path:
        return migrated_base_dir(tmp_path, *subjects)

    return apply
