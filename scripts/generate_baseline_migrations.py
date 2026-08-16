"""Generate a subject's baseline ``0001_create_initial_tables.sql`` files.

A database's first migration has to describe the tables it already writes.
Those descriptions already exist, in the database itself: SQLite keeps the
verbatim ``CREATE`` statement of every table and index in ``sqlite_master``. So
this does not reconstruct a shape from the declared dataclasses and a model of
what ``pandas.to_sql`` would have done with them — it copies out what is
actually there, which is the same text ``sqlite3 <db> .schema`` prints.

That makes a baseline faithful by construction rather than by argument, and it
covers every table the same way: a gold aggregate whose columns are whatever its
transform computed, a quarantine reject table, and a raw landing table whose
shape is the source's all have a ``CREATE`` statement, and none of them has a
dataclass to be derived from.

Usage — produce a run first, then generate from it::

    python -m pipelines.sharepoint_cases.pipeline --base-dir /tmp/run --sample
    python scripts/generate_baseline_migrations.py sharepoint_cases \\
        --base-dir /tmp/run --stdout        # review before writing anything
    python scripts/generate_baseline_migrations.py sharepoint_cases \\
        --base-dir /tmp/run

**Baselines are generated once, checked in, and maintained by hand from then
on.** A change to a checked-in migration is refused by the runner's checksum, so
re-running this over an existing baseline is for comparison, never for editing:
a shape change after the baseline is a new numbered migration.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:  # pragma: no cover - import bootstrap
    sys.path.insert(0, str(REPO_ROOT))

from framework._internal.connection import connect  # noqa: E402
from tools.migrations import MIGRATIONS_ROOT, create_statements  # noqa: E402

BASELINE_FILENAME = "0001_create_initial_tables.sql"


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


def _header(subject: str, database: str) -> str:
    lines = (
        f"Baseline for {subject}/{database}.",
        "",
        "Copied by scripts/generate_baseline_migrations.py out of a real run's",
        "database: these are that database's own CREATE statements, not a",
        "reconstruction of them. Maintained by hand from here — this file's",
        "checksum is recorded when it is applied, so a shape change is a new",
        "numbered migration rather than an edit to this one.",
    )
    return "\n".join(f"-- {line}".rstrip() for line in lines)


def _baseline_of(subject: str, db_path: Path) -> str:
    """One database's baseline, or ``""`` if it holds nothing worth declaring."""
    con = connect(db_path)
    try:
        statements = create_statements(con)
    finally:
        con.close()
    if not statements:
        return ""
    return "\n\n".join((_header(subject, db_path.stem), *statements)) + "\n"


def generate(
    subject: str,
    *,
    base_dir: Path,
    out_root: Path,
    to_stdout: bool,
) -> int:
    """Write (or print) one subject's baselines. Returns a process exit code."""
    databases = _databases_of(base_dir, subject)
    if not databases:
        print(f"no databases for {subject!r} under {base_dir}", file=sys.stderr)
        return 1

    wrote = 0
    for db_path in databases:
        sql = _baseline_of(subject, db_path)
        if not sql:
            print(f"note: {db_path.name} holds no tables — skipped", file=sys.stderr)
            continue
        if to_stdout:
            print(f"-- ==== {subject}/{db_path.stem} ====")
            print(sql)
            wrote += 1
            continue
        directory = out_root / subject / db_path.stem
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / BASELINE_FILENAME
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
        required=True,
        help="a base directory a real run wrote; every database it holds for the "
        "subject has its CREATE statements copied out",
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
        base_dir=Path(args.base_dir),
        out_root=Path(args.out),
        to_stdout=args.stdout,
    )


if __name__ == "__main__":  # pragma: no cover - thin script entry
    raise SystemExit(main())
