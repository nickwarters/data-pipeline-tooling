"""Guard the real ``migrations/`` tree: unique versions, well-formed filenames,
every directory a recognised scope. ``discover_migrations`` already enforces
all three at read time (a malformed or colliding file fails any command that
reads the tree); this test exists so the enforcement runs on every ``pytest``,
not only when someone happens to run a migrations command.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from tools.migrations.discovery import discover_migrations
from tools.migrations.scope import MigrationTreeError

MIGRATIONS_ROOT = Path(__file__).resolve().parents[3] / "migrations"


def _copy_of_the_real_tree(tmp_path: Path) -> Path:
    root = tmp_path / "migrations"
    shutil.copytree(MIGRATIONS_ROOT, root)
    return root


def test_the_real_tree_discovers_cleanly():
    # discover_migrations itself raises MigrationTreeError on any violation
    # (duplicate version, malformed filename, unrecognised scope directory);
    # simply calling it against the real tree is the guard.
    migrations = discover_migrations(MIGRATIONS_ROOT)
    assert len(migrations) > 0


def test_every_version_is_unique_and_globally_ordered():
    migrations = discover_migrations(MIGRATIONS_ROOT)
    versions = [m.version for m in migrations]
    assert len(versions) == len(set(versions))
    assert versions == sorted(versions, key=int)


def test_every_directory_in_the_real_tree_is_a_recognised_scope():
    # Every .sql file's directory is classified by parse_scope_dir or discovery
    # raises; assert the classification actually reached every file, and that
    # the kinds it found are the recognised set (never an "other" bucket).
    migrations = discover_migrations(MIGRATIONS_ROOT)
    assert len(migrations) == len(list(MIGRATIONS_ROOT.rglob("*.sql")))
    assert {m.scope.kind for m in migrations} <= {
        "shared",
        "layer",
        "phase",
        "subject_layer",
        "platform",
    }


def test_the_real_tree_still_covers_the_two_scope_kinds_it_uses():
    # Today the committed tree holds per-feed generated migrations plus the
    # platform registry's DDL; the _shared / layer / phase scope directories
    # are empty on purpose (see migrations/README.md -- an illustrative
    # migration would be applied to every real database).
    kinds = {m.scope.kind for m in discover_migrations(MIGRATIONS_ROOT)}
    assert kinds == {"subject_layer", "platform"}


def test_a_planted_duplicate_version_fails_against_the_real_tree(tmp_path):
    root = _copy_of_the_real_tree(tmp_path)
    existing = sorted(root.rglob("*.sql"))[0]
    planted = root / "_shared" / existing.name
    planted.parent.mkdir(parents=True, exist_ok=True)
    planted.write_text("CREATE TABLE planted (a TEXT);\n", encoding="utf-8")

    with pytest.raises(MigrationTreeError, match="duplicate migration version"):
        discover_migrations(root)


def test_a_planted_malformed_filename_fails_against_the_real_tree(tmp_path):
    root = _copy_of_the_real_tree(tmp_path)
    planted = root / "_shared" / "Not-A-Version.sql"
    planted.parent.mkdir(parents=True, exist_ok=True)
    planted.write_text("CREATE TABLE planted (a TEXT);\n", encoding="utf-8")

    with pytest.raises(MigrationTreeError, match="<version>_<slug>.sql"):
        discover_migrations(root)


def test_a_planted_unrecognised_scope_directory_fails_against_the_real_tree(tmp_path):
    root = _copy_of_the_real_tree(tmp_path)
    planted = root / "subject" / "only_a_subject" / "0999_a.sql"
    planted.parent.mkdir(parents=True, exist_ok=True)
    planted.write_text("CREATE TABLE planted (a TEXT);\n", encoding="utf-8")

    with pytest.raises(MigrationTreeError, match="not a recognised migration scope"):
        discover_migrations(root)
