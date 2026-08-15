"""Generate a subject's baseline ``0001_create_initial_tables.sql`` files.

A database's first migration has to describe the tables it already writes. This
derives that from what the code produces rather than from someone writing it out
by hand, and it does so from a **database a real run made**: introspecting one is
the only source that covers every table a subject has, including the ones no
dataclass declares — a gold aggregate whose columns are whatever its transform
computed, a quarantine reject table, a raw landing table whose shape is the
source's.

Where a table *does* have a declared dataclass, the generator checks the live
table against it and reports any divergence rather than choosing one silently.
That check is the point: a baseline should be both faithful (it matches what runs
today) and intentional (it matches what the feed says it writes). Disagreement
means one of the two is wrong, and which one is a judgement for the person
running this.

Usage — produce a run first, then generate from it::

    python -m pytest tests/pipelines/test_sharepoint_cases.py   # or a real run
    python scripts/generate_baseline_migrations.py sharepoint_cases \\
        --base-dir /tmp/sharepoint_cases_run

    python scripts/generate_baseline_migrations.py sharepoint_cases \\
        --base-dir /tmp/run --stdout        # review before writing anything

Without ``--base-dir`` only the tables this module declares a schema for can be
generated, which is the path a scaffolded feed takes: there is no run to
introspect yet.

**Baselines are generated once, checked in, and maintained by hand from then
on.** A change to a checked-in migration is refused by the runner's checksum, so
re-running this over an existing baseline is for comparison, never for editing:
a shape change after the baseline is a new numbered migration.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:  # pragma: no cover - import bootstrap
    sys.path.insert(0, str(REPO_ROOT))

from framework._internal.connection import connect  # noqa: E402
from framework._internal.schema_control import LEDGER_TABLE  # noqa: E402
from tools.baseline_ddl import (  # noqa: E402
    Column,
    columns_of_schema,
    columns_of_table,
    render_migration,
)
from tools.migrations import MIGRATIONS_ROOT  # noqa: E402

# The declared row schema behind a table, keyed ``<subject>/<database>/<table>``.
#
# Only the tables a feed states up front appear here; a gold aggregate, a
# quarantine reject table and a raw landing table have no dataclass and are
# generated from the live table alone. Entries are added by the ticket that
# baselines each subject, so this map grows with the tree rather than ahead of it.
SCHEMAS: dict[str, type] = {}


def _load_schemas() -> None:
    """Populate :data:`SCHEMAS` from the feeds that declare their silver shape.

    Imported lazily inside a function so this script stays runnable — and its
    rendering testable — when a feed module is mid-edit or missing a dependency.
    A feed that cannot be imported costs its own cross-check, not the run.
    """
    try:
        from pipelines.sharepoint_cases import schema as sharepoint_schema
    except ImportError:  # pragma: no cover - a feed mid-edit
        return
    SCHEMAS.update(
        {
            "sharepoint_cases/silver/case_version": sharepoint_schema.CaseVersion,
            "sharepoint_cases/silver/answer": sharepoint_schema.AnswerRow,
            "sharepoint_cases/silver/answer_capture": (
                sharepoint_schema.AnswerCaptureRow
            ),
            "sharepoint_cases/silver/answer_action": sharepoint_schema.AnswerActionRow,
            "sharepoint_cases/silver/general_answer": (
                sharepoint_schema.GeneralAnswerRow
            ),
            "sharepoint_cases/silver/conversation_message": (
                sharepoint_schema.ConversationMessageRow
            ),
            "sharepoint_cases/silver/appeal": sharepoint_schema.AppealRow,
            "sharepoint_cases/silver/case_detail": sharepoint_schema.CaseDetailRow,
        }
    )


# Tables that are machinery rather than data, and never belong in a baseline.
def _is_generated(table: str) -> bool:
    return (
        table == LEDGER_TABLE
        or table.startswith("_stage_")
        or table.startswith("_upsert_stage_")
        or table.startswith("_insert_or_ignore_stage_")
        or table.startswith("sqlite_")
    )


def _databases_of(base_dir: Path, subject: str) -> list[Path]:
    """Every database file a subject has under ``base_dir``, in a stable order.

    Includes ``quarantine.db``: a quarantine reject table is a table in a
    database like any other, so it earns its own migrations directory rather
    than being smuggled into silver's.
    """
    subject_dir = base_dir / subject
    if not subject_dir.is_dir():
        return []
    return sorted(p for p in subject_dir.glob("*.db") if p.is_file())


def _tables_of(con: sqlite3.Connection) -> list[str]:
    return [
        row[0]
        for row in con.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
        )
        if not _is_generated(row[0])
    ]


def _cross_check(key: str, live: list[Column]) -> list[str]:
    """Report where a live table and the dataclass declaring it disagree.

    Both are meant to describe the same thing. A live column the schema does not
    declare is usually a framework-stamped one and is reported as informational;
    a declared column the table lacks, or a type mismatch, means the baseline
    about to be written is not what the feed says it writes.
    """
    schema = SCHEMAS.get(key)
    if schema is None:
        return []
    declared = {column.name: column.type for column in columns_of_schema(schema)}
    actual = {column.name: column.type for column in live}
    notes = []
    for name, declared_type in declared.items():
        if name not in actual:
            notes.append(f"{key}: declared column {name!r} is not in the live table")
        elif actual[name] != declared_type:
            notes.append(
                f"{key}: column {name!r} is {actual[name]} live but "
                f"{declared_type} by declaration"
            )
    for name in actual:
        if name not in declared:
            notes.append(f"{key}: live column {name!r} is not declared (stamped?)")
    return notes


def _baseline_from_database(subject: str, db_path: Path) -> tuple[str, list[str]]:
    """Render one database's baseline from the tables it actually holds."""
    database = db_path.stem
    con = connect(db_path)
    try:
        tables = _tables_of(con)
        columns = {table: columns_of_table(con, table) for table in tables}
    finally:
        con.close()
    if not tables:
        return "", []
    notes = []
    for table in tables:
        notes.extend(_cross_check(f"{subject}/{database}/{table}", columns[table]))
    header = (
        f"Baseline for {subject}/{database}.\n"
        "\n"
        "Generated once by scripts/generate_baseline_migrations.py from a real\n"
        "run's database, and maintained by hand from here: this file's checksum\n"
        "is recorded when it is applied, so a shape change is a new numbered\n"
        "migration rather than an edit to this one."
    )
    return render_migration(columns, header=header), notes


def _baseline_from_schemas(subject: str, database: str) -> tuple[str, list[str]]:
    """Render a baseline from the declared schemas alone, with no run to read."""
    prefix = f"{subject}/{database}/"
    declared = {
        key[len(prefix) :]: columns_of_schema(schema)
        for key, schema in sorted(SCHEMAS.items())
        if key.startswith(prefix)
    }
    if not declared:
        return "", [f"no declared schemas for {subject}/{database}"]
    header = (
        f"Baseline for {subject}/{database}, from the declared row schemas.\n"
        "\n"
        "Generated by scripts/generate_baseline_migrations.py. Tables with no\n"
        "declared dataclass are absent — generate from a real run's database to\n"
        "cover those."
    )
    return render_migration(declared, header=header), []


def generate(
    subject: str,
    *,
    base_dir: Path | None,
    databases: list[str],
    out_root: Path,
    to_stdout: bool,
) -> int:
    """Write (or print) one subject's baselines. Returns a process exit code."""
    _load_schemas()
    if base_dir is not None:
        sources = [
            (db_path.stem, _baseline_from_database(subject, db_path))
            for db_path in _databases_of(base_dir, subject)
        ]
        if not sources:
            print(f"no databases for {subject!r} under {base_dir}", file=sys.stderr)
            return 1
    else:
        sources = [
            (database, _baseline_from_schemas(subject, database))
            for database in databases
        ]

    wrote = 0
    for database, (sql, notes) in sources:
        for note in notes:
            print(f"note: {note}", file=sys.stderr)
        if not sql:
            continue
        if to_stdout:
            print(f"-- ==== {subject}/{database} ====")
            print(sql)
            wrote += 1
            continue
        directory = out_root / subject / database
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / "0001_create_initial_tables.sql"
        if path.exists():
            print(
                f"refusing to overwrite {path} — a checked-in baseline is "
                "maintained by hand; a shape change is a new numbered migration",
                file=sys.stderr,
            )
            return 1
        path.write_text(sql, encoding="utf-8")
        print(f"wrote {path}")
        wrote += 1
    return 0 if wrote else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python scripts/generate_baseline_migrations.py",
        description="Generate a subject's baseline migrations.",
    )
    parser.add_argument(
        "subject", help="the subject to generate, e.g. sharepoint_cases"
    )
    parser.add_argument(
        "--base-dir",
        default=None,
        help="a base directory a real run wrote; every database it holds for the "
        "subject is introspected (the faithful source, and the only one that "
        "covers tables with no declared dataclass)",
    )
    parser.add_argument(
        "--database",
        dest="databases",
        action="append",
        default=None,
        metavar="NAME",
        help="without --base-dir, which database(s) to render from the declared "
        "schemas alone (default: silver)",
    )
    parser.add_argument(
        "--out",
        default=str(MIGRATIONS_ROOT),
        metavar="DIR",
        help=f"the migrations tree to write into (default: {MIGRATIONS_ROOT})",
    )
    parser.add_argument(
        "--stdout",
        action="store_true",
        help="print the SQL instead of writing it, to review before checking in",
    )
    args = parser.parse_args(argv)
    return generate(
        args.subject,
        base_dir=Path(args.base_dir) if args.base_dir else None,
        databases=args.databases or ["silver"],
        out_root=Path(args.out),
        to_stdout=args.stdout,
    )


if __name__ == "__main__":  # pragma: no cover - thin script entry
    raise SystemExit(main())
