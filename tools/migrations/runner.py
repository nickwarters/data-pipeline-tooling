"""Plan and apply one physical database's composed migrations.

A migration file is split on ``sqlite3.complete_statement`` (never
``executescript``, which commits implicitly and would leave a crash mid-file
half-applied and unrecorded -- see the ``step_address`` backfill precedent in
``tools/observability/run_registry.py``) and applied together with its ledger
row inside one explicit transaction: every statement runs, then the ledger row
is inserted, then the whole thing commits once. A failing statement rolls the
entire file back -- none of its earlier statements, and no ledger row, survive.

An applied migration whose file has since changed on disk is a hard error
naming the file (:class:`ChecksumMismatchError`) -- never a silent re-apply or
skip. Re-running an already-applied file is a no-op.

A statement SQLite refuses is raised as :class:`MigrationApplyError` naming the
file, the database and the statement -- never a bare ``sqlite3`` traceback.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path

from framework._internal.connection import connect
from tools.migrations.discovery import Migration
from tools.migrations.ledger import applied_migrations, ensure_ledger, record_applied
from tools.migrations.topology import Database
from tools.observability.timestamps import utc_now_iso

__all__ = [
    "ChecksumMismatchError",
    "MigrationApplyError",
    "PlanLine",
    "PlanResult",
    "ApplyResult",
    "split_sql_statements",
    "plan_database",
    "apply_database",
]


class ChecksumMismatchError(Exception):
    """An applied migration's file has changed since it was applied."""


class MigrationApplyError(Exception):
    """A migration file failed to apply; the whole file was rolled back."""


# The runner owns the transaction boundary, so a file must not contain its own.
# A stray ``COMMIT;`` (SQLite's own 12-step rebuild recipe is written with one)
# would end the runner's transaction early, letting a later failing statement
# leave the file half-applied *and* unrecorded -- the exact failure avoiding
# ``executescript`` is meant to prevent. Refused up front, by name, rather than
# discovered as corruption afterwards.
_TRANSACTION_KEYWORDS = ("begin", "commit", "end", "rollback", "savepoint", "release")


def _leading_keyword(statement: str) -> str:
    for raw_line in statement.splitlines():
        line = raw_line.strip()
        if line and not line.startswith("--"):
            return line.split(maxsplit=1)[0].lower().rstrip(";")
    return ""


def _only_comments_or_blank(text: str) -> bool:
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if line and not line.startswith("--"):
            return False
    return True


def split_sql_statements(sql_text: str) -> list[str]:
    """Split ``sql_text`` into individually-executable statements.

    Accumulates lines until ``sqlite3.complete_statement`` reports a full
    statement (a leading run of comment-only lines rides along with whichever
    statement follows them, which SQLite accepts). A trailing fragment that is
    neither blank nor comment-only means the file is missing a closing ``;``,
    and that is a malformed migration, not a statement to silently drop.
    """
    statements: list[str] = []
    buffer = ""
    for line in sql_text.splitlines(keepends=True):
        buffer += line
        if sqlite3.complete_statement(buffer):
            statements.append(buffer)
            buffer = ""
    if not _only_comments_or_blank(buffer):
        raise ValueError(
            f"migration file ends with an incomplete SQL statement (missing ';'): "
            f"{buffer.strip()!r}"
        )
    for statement in statements:
        keyword = _leading_keyword(statement)
        if keyword in _TRANSACTION_KEYWORDS:
            raise ValueError(
                f"migration file contains its own {keyword.upper()} statement; "
                "the runner applies every file in one transaction of its own "
                "(together with the file's ledger row), so a migration must not "
                "open, commit or roll back a transaction itself -- delete the "
                f"{keyword.upper()} and let the runner own the boundary "
                "(see migrations/README.md)"
            )
    return statements


@dataclass(frozen=True)
class PlanLine:
    """One migration's state against one database, for ``--plan``/``--status``."""

    migration: Migration
    applied: bool
    applied_at: str | None = None
    out_of_order: bool = False


@dataclass(frozen=True)
class PlanResult:
    """The full plan for one database: every selected migration's state."""

    database: Database
    lines: tuple[PlanLine, ...]

    @property
    def pending(self) -> tuple[Migration, ...]:
        return tuple(line.migration for line in self.lines if not line.applied)

    @property
    def out_of_order_count(self) -> int:
        return sum(1 for line in self.lines if line.out_of_order)


def _selected(database: Database, to: str | None) -> tuple[Migration, ...]:
    if to is None:
        return database.migrations
    return tuple(m for m in database.migrations if int(m.version) <= int(to))


def _read_applied(db_path: Path) -> dict:
    if not db_path.exists():
        return {}
    con = connect(db_path)
    try:
        return applied_migrations(con)
    finally:
        con.close()


def plan_database(
    database: Database, db_path: Path, *, to: str | None = None
) -> PlanResult:
    """What applying ``database`` against ``db_path`` would do, without touching it.

    Raises :class:`ChecksumMismatchError` for any already-applied migration
    whose file has changed on disk -- a plan surfaces that the same way an
    apply would refuse it, rather than silently planning around it.
    """
    selected = _selected(database, to)
    applied = _read_applied(db_path)
    max_applied_version = max((int(v) for v in applied), default=-1)
    lines = []
    for migration in selected:
        row = applied.get(migration.version)
        if row is not None:
            if row.checksum != migration.checksum:
                raise ChecksumMismatchError(
                    f"{migration.path}: applied checksum in {db_path} no longer "
                    f"matches the file on disk (version {migration.version}) -- "
                    "a migration must never be edited after it is applied; add a "
                    "new one instead"
                )
            lines.append(PlanLine(migration, True, row.applied_at))
        else:
            out_of_order = int(migration.version) < max_applied_version
            lines.append(PlanLine(migration, False, out_of_order=out_of_order))
    return PlanResult(database, tuple(lines))


@dataclass(frozen=True)
class ApplyResult:
    """What one ``apply_database`` call actually did."""

    database: Database
    applied: tuple[Migration, ...]
    already_applied: tuple[Migration, ...]


def apply_database(
    database: Database,
    db_path: Path,
    *,
    to: str | None = None,
    busy_timeout_ms: int = 5000,
) -> ApplyResult:
    """Apply every pending migration ``database`` composes against ``db_path``.

    Idempotent: a migration already recorded in the ledger (with a matching
    checksum) is skipped. Each pending file runs in its own transaction --
    its statements plus the ledger row -- so a failure rolls back only that
    file and leaves every earlier one committed and every later one untried.
    """
    plan = plan_database(database, db_path, to=to)
    applied_now: list[Migration] = []
    already: list[Migration] = []
    for line in plan.lines:
        migration = line.migration
        if line.applied:
            already.append(migration)
            continue
        db_path.parent.mkdir(parents=True, exist_ok=True)
        con = connect(db_path, busy_timeout_ms)
        try:
            con.execute("BEGIN")
            ensure_ledger(con)
            try:
                statements = split_sql_statements(migration.sql_text())
            except ValueError as exc:
                raise MigrationApplyError(f"{migration.path}: {exc}") from exc
            for statement in statements:
                try:
                    con.execute(statement)
                except sqlite3.Error as exc:
                    raise _apply_error(migration, db_path, statement, exc) from exc
            record_applied(
                con,
                version=migration.version,
                name=migration.name,
                scope=migration.scope.label,
                checksum=migration.checksum,
                applied_at=utc_now_iso(),
            )
            con.commit()
        except Exception:
            con.rollback()
            raise
        finally:
            con.close()
        applied_now.append(migration)
    return ApplyResult(database, tuple(applied_now), tuple(already))


def _apply_error(
    migration: Migration,
    db_path: Path,
    statement: str,
    cause: Exception,
) -> MigrationApplyError:
    """A rolled-back file's failure, said in terms an operator can act on."""
    message = (
        f"{migration.path}: failed to apply against {db_path} -- {cause}. "
        "The whole file was rolled back (no statement of it, and no ledger row, "
        f"survives). Statement: {_without_leading_comments(statement)!r}"
    )
    return MigrationApplyError(message)


def _without_leading_comments(statement: str) -> str:
    """The statement's SQL, with the generated header comments dropped.

    A generated file's statement carries its whole comment header, which buries
    the one line an operator needs to read in an error message.
    """
    lines = statement.splitlines()
    while lines and (not lines[0].strip() or lines[0].strip().startswith("--")):
        lines.pop(0)
    return "\n".join(lines).strip() or statement.strip()
