```python
"""Build a test's databases from the declared migrations.

A database carrying a ``schema_migrations`` ledger behaves differently at the
write: no Writer creates a missing table, and ``Refresh`` preserves the DDL
rather than dropping it. A test of a feed that writes such a database has to run
against one that has actually been built, or it is testing a different write
path from production.

    from tests.framework_testing import build_databases

    def test_the_feed_lands_its_rows(tmp_path):
        base_dir = build_databases(tmp_path, "sharepoint_cases")
        feed.run(RunContext(base_dir=base_dir), client=FakeClient())

**What you get is databases, named by the migrations tree.** A spec is either a
whole subject (``"sharepoint_cases"`` — every database it declares) or one
database of one (``"sharepoint_cases/silver"``). Nothing here knows or cares
whether those are called raw, silver and gold: that is one application's profile
over the store, and a subject whose databases are named something else builds the
same way.

Ask for the database a test actually writes. Building a subject's whole set is
the convenient default, not the cheap one: a test that only exercises one
database otherwise pays to build unrelated databases.

**It applies the real ``migrations/`` tree.** A test-only DDL path would defeat
the point: the thing worth testing is that the declared SQL and the code agree,
so a test that invented its own tables would pass while production failed. That
also means a table a migration forgot fails these tests exactly as it fails a
run.

Only what the tree declares can be built. Asking for a subject or a database
with no directory is an error naming it, rather than a base directory that
silently behaves like the old implicit-creation world and a test that proves
nothing.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from tools.migrations import MIGRATIONS_ROOT, MigrationRunner, discover_targets
from tools.store import StoreRegistry

__all__ = [
    "build_databases",
    "database_registry",
]


def _targets_for(spec: str, migrations_root: str | os.PathLike[str]):
    """The migration targets one spec names: a whole subject, or one database."""
    available = discover_targets(migrations_root)
    if "/" in spec:
        matched = [target for target in available if target.namespace == spec]
    else:
        matched = [target for target in available if target.subject == spec]
    if not matched:
        raise LookupError(
            f"nothing to build for {spec!r} under {migrations_root}. Known: "
            f"{sorted(target.namespace for target in available)}. Only a database "
            "with a declared baseline can be built; one without still creates "
            "its tables on first write, so its tests need no fixture."
        )
    return matched


def build_databases(
    base_dir: str | os.PathLike[str],
    *specs: str,
    migrations_root: str | os.PathLike[str] | None = None,
) -> Path:
    """Apply the declared migrations each spec names, under ``base_dir``.

    Each spec is a subject (``"reviewer_activity"``) or one of its databases
    (``"reviewer_activity/gold"``). Returns the base directory, so a caller can
    wrap a ``tmp_path`` in one expression.

    Several specs because a pipeline commonly reads one subject and writes
    another — ``reviewer_activity`` reads the sync subject's silver and writes
    its own gold — and both ends have to exist before it runs. Naming them
    separately is what lets that test build two databases instead of seven.
    """
    # Resolved at call time, not bound as a default, so a test of this helper can
    # substitute a throwaway tree by patching the module constant.
    migrations_root = MIGRATIONS_ROOT if migrations_root is None else migrations_root
    registry = StoreRegistry(base_dir)
    for spec in specs:
        for target in _targets_for(spec, migrations_root):
            db_path = registry.db_file(target.namespace)
            MigrationRunner(db_path, target.directory).apply()
    return Path(base_dir)


def database_registry(
    base_dir: str | os.PathLike[str],
    *specs: str,
    migrations_root: str | os.PathLike[str] | None = None,
) -> StoreRegistry:
    """A :class:`~tools.store.StoreRegistry` over the databases those specs build."""
    return StoreRegistry(
        build_databases(base_dir, *specs, migrations_root=migrations_root)
    )


@pytest.fixture
def databases(tmp_path):
    """Build databases into ``tmp_path`` on demand; yields the building callable.

    The fixture form of :func:`build_databases` for the common case, where the
    test knows what it writes but wants pytest's ``tmp_path``::

        def test_a_run_lands(databases):
            base_dir = databases("sharepoint_cases/silver")

    A callable rather than a fixed base directory because what a test needs is
    the test's business, and parameterising a fixture per subject would put that
    knowledge in a conftest instead.
    """

    def build(*specs: str) -> Path:
        return build_databases(tmp_path, *specs)

    return build

```
