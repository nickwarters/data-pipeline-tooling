"""Discover every migration file under ``migrations/`` and enforce the tree's rules.

Directory path = scope, filename = globally ordered version + slug, and
nothing else carries meaning -- there is no manifest to keep in step with the
filesystem. :func:`discover_migrations` is the one place that walks the tree,
so ``migrations make``, ``migrate``, and the tree-hygiene test all see the same
rules enforced the same way: every file's directory must be a recognised
:class:`~tools.migrations.scope.Scope`, every filename must be
``<version>_<slug>.sql``, and no version may repeat anywhere in the tree (a
version is a repo-wide sequence, never reused, so several scopes landing in one
physical database can be interleaved by version with no possibility of a
collision).
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from tools.migrations.scope import MigrationTreeError, Scope, parse_scope_dir

__all__ = ["Migration", "discover_migrations"]

# <digits>_<lowercase snake-case slug>.sql -- deliberately no uppercase, space,
# or "*" (illegal on Windows) so a filename is portable and shell-glob-safe.
_FILENAME_RE = re.compile(r"^(?P<version>\d{4,})_(?P<slug>[a-z][a-z0-9_]*)\.sql$")


@dataclass(frozen=True)
class Migration:
    """One discovered migration file: its identity, scope, and content hash."""

    version: str  # zero-padded, e.g. "0031"; compare numerically via int(version)
    slug: str
    scope: Scope
    path: Path
    checksum: str  # sha256 hex digest of the file's exact bytes

    @property
    def name(self) -> str:
        """The human name recorded in the ledger and shown in ``--plan`` output."""
        return self.slug

    def sql_text(self) -> str:
        return self.path.read_text(encoding="utf-8")


def _relative_posix(path: Path, root: Path) -> PurePosixPath:
    return PurePosixPath(*path.relative_to(root).parts)


def discover_migrations(root: str | Path) -> tuple[Migration, ...]:
    """Every migration file under ``root``, in one global version order.

    Returns ``()`` when ``root`` doesn't exist yet (a fresh clone before any
    migration has been authored) rather than raising -- an empty tree is a
    valid, if uninteresting, state.
    """
    root = Path(root)
    if not root.exists():
        return ()
    migrations: list[Migration] = []
    seen_versions: dict[str, Path] = {}
    for sql_path in sorted(root.rglob("*.sql")):
        relative_dir = _relative_posix(sql_path.parent, root)
        scope = parse_scope_dir(relative_dir)
        match = _FILENAME_RE.match(sql_path.name)
        if not match:
            raise MigrationTreeError(
                f"{sql_path}: filename must be <version>_<slug>.sql -- digits, "
                "an underscore, then a lowercase snake_case slug"
            )
        version = match["version"]
        if version in seen_versions:
            raise MigrationTreeError(
                f"duplicate migration version {version!r}: "
                f"{seen_versions[version]} and {sql_path} -- versions are one "
                "sequence repo-wide and must never repeat"
            )
        seen_versions[version] = sql_path
        migrations.append(
            Migration(
                version=version,
                slug=match["slug"],
                scope=scope,
                path=sql_path,
                checksum=hashlib.sha256(sql_path.read_bytes()).hexdigest(),
            )
        )
    return tuple(sorted(migrations, key=lambda m: int(m.version)))
