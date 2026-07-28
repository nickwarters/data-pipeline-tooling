"""Discovery/ordering: the tree's rules, enforced against a synthetic tmp tree."""

from __future__ import annotations

import pytest

from tools.migrations.discovery import discover_migrations
from tools.migrations.scope import MigrationTreeError


def _write(root, relative_path, text="CREATE TABLE t (a TEXT);\n"):
    path = root / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def test_empty_tree_discovers_nothing(tmp_path):
    assert discover_migrations(tmp_path / "does-not-exist") == ()


def test_discovers_and_globally_orders_by_version(tmp_path):
    _write(tmp_path, "layer/silver/0003_second.sql")
    _write(tmp_path, "_shared/0001_first.sql")
    _write(tmp_path, "subject/x/raw/0002_middle.sql")

    migrations = discover_migrations(tmp_path)

    assert [m.version for m in migrations] == ["0001", "0002", "0003"]
    assert [m.slug for m in migrations] == ["first", "middle", "second"]


def test_checksum_reflects_exact_file_bytes(tmp_path):
    _write(tmp_path, "_shared/0001_a.sql", "CREATE TABLE t (a TEXT);\n")
    first = discover_migrations(tmp_path)[0].checksum

    _write(tmp_path, "_shared/0001_a.sql", "CREATE TABLE t (a TEXT, b TEXT);\n")
    second = discover_migrations(tmp_path)[0].checksum

    assert first != second


def test_duplicate_version_anywhere_in_the_tree_fails_the_build(tmp_path):
    _write(tmp_path, "_shared/0001_a.sql")
    _write(tmp_path, "layer/raw/0001_b.sql")

    with pytest.raises(MigrationTreeError, match="duplicate migration version"):
        discover_migrations(tmp_path)


@pytest.mark.parametrize(
    "filename",
    [
        "1_a.sql",  # too few digits
        "0001-a.sql",  # wrong separator
        "0001_A.sql",  # uppercase slug
        "0001_a b.sql",  # space in slug
        "create.sql",  # no version at all
    ],
)
def test_malformed_filename_fails_the_build(tmp_path, filename):
    _write(tmp_path, f"_shared/{filename}")

    with pytest.raises(MigrationTreeError):
        discover_migrations(tmp_path)


def test_unrecognised_scope_directory_fails_the_build(tmp_path):
    _write(tmp_path, "not_a_scope/0001_a.sql")

    with pytest.raises(MigrationTreeError):
        discover_migrations(tmp_path)
