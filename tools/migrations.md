```python
"""Ordered SQL files that own a database's shape, with a ledger inside it.

The physical shape of a database — its tables, primary keys, indexes and
``NOT NULL``s — is declared by numbered ``.sql`` files under
``migrations/<subject>/<database>/`` and applied by the runner here. Each
database carries its own ``schema_migrations`` ledger recording which files it
has seen, so a database is self-describing: what it has applied is stored in it,
not in a central register that could disagree with the file in front of you.

The tree names a *subject* and a *database within it*, matching the
``<subject>/<name>`` namespace ``tools.store`` maps to
``<base_dir>/<subject>/<name>.db``. Nothing here knows the medallion: raw,
silver and gold are three databases of one subject to this module, exactly as
they are to the namespace Store, and the raw/silver/gold reading of them is the
``tools.medallion`` profile's business alone.

**The ledger's presence is the opt-in.** A database carrying a
``schema_migrations`` table is under migration control and is expected to have
been shaped by SQL; one without it behaves exactly as it always has. That makes
every database's conversion additive and independent —
:func:`is_under_migration_control` is the cheap check the writers ask before
refusing to conjure a table.

Three properties the design turns on:

*One transaction per file.* A file's statements **and** its ledger row commit
together, so a crash part-way leaves no row and the file is simply retried. Each
file gets its own transaction rather than the whole batch sharing one, because
production is a UNC share under the rollback journal (WAL is unavailable there)
and a writer's lock is exclusive: a long batch holding one transaction locks
every reader out for its whole duration.

*A checksum per applied file.* An already-applied file whose contents no longer
match what was recorded is an **error**, not a silent skip — it means a
migration was edited after it was applied, so the database and the file that
claims to describe it have quietly diverged. The checksum is taken over the
file's text read with universal newlines, so a CRLF file on Windows and an LF
file on macOS agree; the framework runs on both. The converse — a ledger row
whose file has since been *deleted* — is deliberately not checked: a file can be
moved between directories for reasons that are not drift.

*Reading never writes.* :meth:`MigrationRunner.pending` answers "what would be
applied" without opening a transaction, creating the database file, or creating
the ledger, so the operator CLI can report on a share without taking the
exclusive write lock. Nothing here writes when the database is already current.

Run metadata is **out of scope**: ``_registry/runs.db`` and
``_orchestration/runs.db`` self-migrate from ``RUN_RECORD_FIELDS`` (see
:mod:`tools.observability.record_schema`) and stay that way. Two migration
mechanisms on one file would be worse than one.
"""

from __future__ import annotations

import hashlib
import os
import re
import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from framework._internal.connection import connect
from framework._internal.schema_control import LEDGER_TABLE, under_migration_control
from framework.core.errors import ErrorCategory, PipelineError
from tools.observability.timestamps import utc_now_iso

__all__ = [
    "LEDGER_TABLE",
    "MIGRATIONS_ROOT",
    "AppliedMigration",
    "Migration",
    "MigrationError",
    "MigrationFailed",
    "MigrationRunner",
    "MigrationTarget",
    "discover_targets",
    "is_under_migration_control",
    "migrations_directory",
]

# ``LEDGER_TABLE`` and the probe for it are re-exported from
# ``framework._internal.schema_control`` rather than restated here: the Writers
# read the same ledger to decide whether they may create a missing table, and
# they sit below this module, so the shared fact is settled down there and
# imported upward. Two definitions would be a silent disagreement between what
# this runner writes and what the Writers look for.

# The repository's migrations tree. ``tools`` is a top-level package of the
# import-only source tree, so its parent is the repository root.
MIGRATIONS_ROOT = Path(__file__).resolve().parent.parent / "migrations"

_CREATE_LEDGER = f"""
    CREATE TABLE IF NOT EXISTS {LEDGER_TABLE} (
        name       TEXT PRIMARY KEY,
        checksum   TEXT NOT NULL,
        applied_at TEXT NOT NULL
    )
"""

_INSERT_LEDGER_ROW = f"""
    INSERT INTO {LEDGER_TABLE} (name, checksum, applied_at) VALUES (?, ?, ?)
"""

# ``0001_create_initial_tables.sql``: a four-digit version, an underscore, a
# word description. The width is fixed so a directory listing, a shell glob and
# this runner all put the files in the same order.
_MIGRATION_FILENAME = re.compile(r"(\d{4})_(\w+)\.sql", re.ASCII | re.IGNORECASE)


class MigrationError(PipelineError):
    """A migration set that cannot be trusted, or a file that would not apply.

    ``CONFIG``, not ``DATA``: every case — a misnamed file, two files claiming
    one version, a file edited after it was applied, SQL that will not run — is
    a fault in what was declared, and the fix is in the migrations directory
    rather than in the feed.
    """

    category = ErrorCategory.CONFIG


class MigrationFailed(MigrationError):
    """One migration's SQL would not run.

    Carries the :class:`Migration` that failed and SQLite's own ``reason``
    separately from the message, so a report can put the reason beside the
    file's name rather than repeat its full path. The message still names the
    path in full — it is what an operator greps for.
    """

    def __init__(self, migration: Migration, reason: str) -> None:
        super().__init__(f"Migration failed: {migration.path}: {reason}")
        self.migration = migration
        self.reason = reason


@dataclass(frozen=True)
class Migration:
    """One migration file: its ledger key, its place in the order, its SQL."""

    name: str
    version: int
    path: Path
    sql: str
    checksum: str


@dataclass(frozen=True)
class AppliedMigration:
    """One ledger row — a migration this database has already applied."""

    name: str
    checksum: str
    applied_at: str


@dataclass(frozen=True)
class MigrationTarget:
    """One database with migrations, and the directory holding them."""

    subject: str
    database: str
    directory: Path

    @property
    def namespace(self) -> str:
        """The ``tools.store`` namespace whose file this target shapes."""
        return f"{self.subject}/{self.database}"


class MigrationRunner:
    """Applies one directory of migrations to one SQLite database.

    A runner is bound to one ``(database, directory)`` pair because that pairing
    is what the ledger records. It holds no connection; each call opens one,
    does its work, and closes.
    """

    def __init__(
        self,
        db_path: str | os.PathLike[str],
        directory: str | os.PathLike[str],
        *,
        busy_timeout_ms: int = 5000,
    ) -> None:
        self._db_path = Path(db_path)
        self._directory = Path(directory)
        self._busy_timeout_ms = busy_timeout_ms

    def discover(self) -> list[Migration]:
        """Every migration in the directory, in version order.

        A file whose name does not parse, or a version claimed by two files, is
        an error naming the file(s): ordering is the whole contract here, and a
        set that cannot be ordered unambiguously must not be half-applied.
        Non-``.sql`` entries are ignored rather than rejected — a directory on
        macOS acquires a ``.DS_Store`` without anyone asking it to.
        """
        if not self._directory.is_dir():
            raise MigrationError(f"No migrations directory: {self._directory}")
        by_version: dict[int, Migration] = {}
        for path in sorted(self._directory.iterdir()):
            if not path.is_file() or path.suffix.lower() != ".sql":
                continue
            match = _MIGRATION_FILENAME.fullmatch(path.name)
            if match is None:
                raise MigrationError(
                    f"Migration filename does not parse: {path} "
                    "(expected <0000>_<description>.sql)"
                )
            version = int(match.group(1))
            if version in by_version:
                raise MigrationError(
                    f"Duplicate migration version {match.group(1)} in "
                    f"{self._directory}: {by_version[version].name} and {path.name}"
                )
            by_version[version] = _read_migration(path, version)
        return [by_version[version] for version in sorted(by_version)]

    def applied(self) -> list[AppliedMigration]:
        """The ledger's contents, in version order; empty if there is no ledger.

        A database that does not exist, or that exists without a ledger, has
        applied nothing. Neither case is an error and neither creates anything:
        that is what makes converting a subject additive.
        """
        con = self._read_connection()
        if con is None:
            return []
        try:
            rows = con.execute(
                f"SELECT name, checksum, applied_at FROM {LEDGER_TABLE} ORDER BY name"
            ).fetchall()
            return [AppliedMigration(*row) for row in rows]
        finally:
            con.close()

    def pending(self) -> list[Migration]:
        """What :meth:`apply` would apply, in order — without writing anything.

        Every discovered file is checked, not just the ones before the first
        pending file, so an edited-after-applying migration is reported whether
        or not there is newer work behind it.
        """
        recorded = {row.name: row.checksum for row in self.applied()}
        outstanding: list[Migration] = []
        for migration in self.discover():
            if migration.name not in recorded:
                outstanding.append(migration)
            elif recorded[migration.name] != migration.checksum:
                raise MigrationError(
                    f"Migration was edited after it was applied: {migration.path} "
                    f"(recorded checksum {recorded[migration.name]}, "
                    f"file is {migration.checksum})"
                )
        return outstanding

    def apply(self) -> list[Migration]:
        """Apply every pending migration in order; return the ones applied.

        :meth:`apply_each` drained to a list — the same rules, minus the
        progress. A failure raises :class:`MigrationFailed` naming the file;
        the ones applied before it stay applied (see :meth:`apply_each`).
        """
        return list(self.apply_each())

    def apply_each(self) -> Iterator[Migration]:
        """Apply every pending migration in order, yielding each as it commits.

        Applying nothing writes nothing — no connection is opened, so a current
        database costs no write lock. Otherwise each file commits with its own
        ledger row and is yielded once it has, so a caller reporting progress
        prints a file only after it has landed. The first failure aborts with
        :class:`MigrationFailed`: the files before it stay applied and
        committed, the failing one leaves neither DDL nor a ledger row, and the
        ones after it are untouched.

        One connection serves the whole batch and is held open between yields,
        so drain the iterator rather than abandoning it part-way.
        """
        outstanding = self.pending()
        if not outstanding:
            return
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        con = connect(self._db_path, self._busy_timeout_ms)
        # PEP 249 transaction control: unlike the legacy default it holds DDL
        # inside the transaction too, which is the whole point here — a
        # half-applied file must roll back its CREATEs along with its ledger row.
        con.autocommit = False
        try:
            for migration in outstanding:
                _apply_one(con, migration)
                yield migration
        finally:
            con.close()

    def _read_connection(self) -> sqlite3.Connection | None:
        """A connection to an existing, ledger-carrying database, or ``None``.

        Guarded on the file existing because ``connect`` would otherwise create
        an empty database as a side effect of asking a question about it.
        """
        if not self._db_path.exists():
            return None
        con = connect(self._db_path, self._busy_timeout_ms)
        if under_migration_control(con):
            return con
        con.close()
        return None


def is_under_migration_control(
    db_path: str | os.PathLike[str], *, busy_timeout_ms: int = 5000
) -> bool:
    """Whether this database's shape is owned by SQL migrations.

    The single question the writers ask before deciding how strict to be: a
    database carrying the ledger has had its tables declared, so a missing table
    is a missing migration rather than something to create on the fly. Cheap (one
    ``sqlite_master`` lookup) and side-effect free — a database that does not
    exist yet is not created just to answer ``False``.
    """
    path = Path(db_path)
    if not path.exists():
        return False
    con = connect(path, busy_timeout_ms)
    try:
        return under_migration_control(con)
    finally:
        con.close()


def discover_targets(
    root: str | os.PathLike[str] = MIGRATIONS_ROOT,
) -> list[MigrationTarget]:
    """Every subject/database under the migrations tree, in subject then name order.

    **The tree is the registry.** There is no other list of which databases are
    under migration control: a database opts in by having a directory here, and
    an operator applying migrations walks this rather than a config file that
    could fall behind it. A missing tree is not an error — nothing has opted in
    yet.

    Only directories are considered at both levels, so a ``README.md`` beside
    the subjects is ignored rather than read as one.
    """
    root = Path(root)
    if not root.is_dir():
        return []
    return [
        MigrationTarget(
            subject=subject_dir.name, database=database_dir.name, directory=database_dir
        )
        for subject_dir in sorted(p for p in root.iterdir() if p.is_dir())
        for database_dir in sorted(p for p in subject_dir.iterdir() if p.is_dir())
    ]


def migrations_directory(
    subject: str,
    database: str,
    *,
    root: str | os.PathLike[str] = MIGRATIONS_ROOT,
) -> Path:
    """The directory holding one database's migrations.

    The ``migrations/<subject>/<database>/`` layout mirrors the on-disk
    ``<base_dir>/<subject>/<database>.db``, so a database and the files that
    shape it are found the same way. One function owns the layout so the CLI and
    the tests cannot spell it differently.
    """
    return Path(root) / subject / database


def _read_migration(path: Path, version: int) -> Migration:
    """Read one file into a :class:`Migration`, checksumming its text.

    Read as *text*: universal newlines collapse a CRLF file to ``\\n`` before the
    digest is taken, so the same migration checksums identically on Windows and
    macOS. Encoding is pinned to UTF-8 rather than left to the platform's locale
    for the same reason.
    """
    sql = path.read_text(encoding="utf-8")
    return Migration(
        name=path.name,
        version=version,
        path=path,
        sql=sql,
        checksum=hashlib.sha256(sql.encode("utf-8")).hexdigest(),
    )


def _apply_one(con: sqlite3.Connection, migration: Migration) -> None:
    """Run one migration and record it, as a single transaction.

    The ledger is created inside that same transaction rather than up front, so
    a database whose very first migration fails is left exactly as it was —
    including *not* being under migration control, which a bare ledger created
    ahead of time would have made it.
    """
    try:
        con.execute(_CREATE_LEDGER)
        con.executescript(migration.sql)
        con.execute(
            _INSERT_LEDGER_ROW,
            (migration.name, migration.checksum, utc_now_iso()),
        )
        con.commit()
    except sqlite3.Error as exc:
        con.rollback()
        raise MigrationFailed(migration, str(exc)) from exc

```
