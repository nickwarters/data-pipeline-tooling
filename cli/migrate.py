"""``python -m cli migrations make`` / ``migrate`` -- author, apply schema migrations.

``migrations make`` turns a declared table's drift (against what the
migrations tree itself already committed to, not any live environment) into
the next migration file, in the finest-grained scope
(``migrations/subject/<subject>/<layer>/``). The baseline it diffs against is
read by *applying* that scope's committed migrations to a throwaway in-memory
database -- see ``tools/schema/emit.py``.

``migrate`` applies (or, with ``--plan``/``--status``, previews) every pending
migration the medallion resolves for a base directory. ``--env`` resolves the
base directory (``tools.environments``); ``--database``/``--scope`` bypasses
that resolution entirely for an ad hoc single database. ``--subject``/
``--layer`` narrow which databases are touched, by inspecting each database's
*composed* migrations for a matching scope; they intersect, and any
combination narrows further. ``--to VERSION`` truncates every selected
database's migrations to that version (inclusive) -- covers staging and
bisecting, since migrations are forward-only.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from cli.operator import add_base_dir_args, base_dir_or_report
from tools.migrations.discovery import discover_migrations
from tools.migrations.runner import (
    ChecksumMismatchError,
    MigrationApplyError,
    PlanResult,
    apply_database,
    plan_database,
)
from tools.migrations.scope import MigrationTreeError, scope_from_label
from tools.migrations.topology import (
    Database,
    compose_for_subject_layer,
    resolve_databases,
)
from tools.schema import collect_declared_tables, generate_migration_sql, slug_for
from tools.schema.declaration import resolved_namespace
from tools.schema.emit import MigrationReplayError, replay_tracked_shapes
from tools.schema.live import LiveTable, diff_tables

#: The migrations tree's root, relative to the repository root -- the same
#: convention as ``pipelines/`` and ``docs/``: run from the repo root.
DEFAULT_MIGRATIONS_ROOT = Path("migrations")


def _make(args: argparse.Namespace) -> int:
    root = DEFAULT_MIGRATIONS_ROOT
    try:
        existing = discover_migrations(root)
    except MigrationTreeError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    next_version = max((int(m.version) for m in existing), default=0) + 1

    declared = collect_declared_tables()
    if args.feed is not None:
        if args.feed not in declared:
            print(
                f"unknown feed {args.feed!r} (no pipelines/{args.feed})",
                file=sys.stderr,
            )
            return 1
        declared = {args.feed: declared[args.feed]}

    written: list[Path] = []
    # One replay per (subject, layer) scope rather than one per table: the
    # scope's whole composed set has to be applied either way, and a scope
    # with several declared tables is the common case.
    tracked_by_scope: dict[tuple[str, str], dict[str, tuple]] = {}
    for feed in sorted(declared):
        for table in declared[feed]:
            namespace = resolved_namespace(table, feed)
            subject, layer = namespace.split("/", 1)
            if (subject, layer) not in tracked_by_scope:
                try:
                    tracked_by_scope[(subject, layer)] = replay_tracked_shapes(
                        compose_for_subject_layer(existing, subject, layer)
                    )
                except MigrationReplayError as exc:
                    print(str(exc), file=sys.stderr)
                    return 1
            tracked = tracked_by_scope[(subject, layer)].get(table.name)
            live = (
                None if tracked is None else LiveTable(namespace, table.name, tracked)
            )
            diff = diff_tables(table, live)
            if diff.landed and not diff.drifted:
                continue  # already tracked and matching -- nothing to do

            version = f"{next_version:04d}"
            sql = generate_migration_sql(
                table, feed, diff, version=version, namespace=namespace
            )
            if sql is None:
                continue  # a type change or an undeclared extra column -- see emit.py
            slug = slug_for(table, diff)
            path = root / "subject" / subject / layer / f"{version}_{slug}.sql"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(sql, encoding="utf-8")
            written.append(path)
            next_version += 1

    if not written:
        print("no declared table has drifted from the migrations tree; nothing to do")
        return 0
    for path in written:
        print(f"wrote {path}")
    return 0


def _matches_subject(database: Database, subject: str) -> bool:
    # Composed scope first, as ``docs/migrations.md`` states the rule; the path
    # check then also reaches a database no subject scope composes into -- the
    # fixed ``_registry/runs.db``, selectable as ``--subject _registry``.
    return (
        any(
            m.scope.kind == "subject_layer" and m.scope.subject == subject
            for m in database.migrations
        )
        or database.relative_path.parts[0] == subject
    )


def _matches_layer(database: Database, layer: str) -> bool:
    # Composed scope only: a ``<subject>/<layer>.db`` always composes at least
    # one migration of that layer (it is resolved from one), so its filename
    # says nothing its scopes do not, and no other database has a layer at all.
    return any(
        m.scope.layer == layer
        for m in database.migrations
        if m.scope.kind in ("layer", "subject_layer")
    )


def _filtered(
    databases: tuple[Database, ...],
    *,
    subjects: list[str],
    layers: list[str],
) -> tuple[Database, ...]:
    result = databases
    if subjects:
        result = tuple(
            d for d in result if any(_matches_subject(d, s) for s in subjects)
        )
    if layers:
        result = tuple(
            d for d in result if any(_matches_layer(d, layer) for layer in layers)
        )
    return result


def _resolve_databases(
    args: argparse.Namespace,
) -> tuple[Path | None, tuple[Database, ...]] | None:
    """The base directory and the databases to act on, or ``None`` if reported.

    ``--database`` names one physical file outright, so that mode has no base
    directory at all and resolves to ``None`` -- the database carries its own
    whole path, and the caller joins nothing onto it.
    """
    try:
        migrations = discover_migrations(DEFAULT_MIGRATIONS_ROOT)
    except MigrationTreeError as exc:
        print(str(exc), file=sys.stderr)
        return None

    if args.database:
        if not args.scope:
            print("--database requires at least one --scope", file=sys.stderr)
            return None
        try:
            scopes = [scope_from_label(label) for label in args.scope]
        except MigrationTreeError as exc:
            print(str(exc), file=sys.stderr)
            return None
        selected = tuple(
            sorted(
                (m for m in migrations if m.scope in scopes),
                key=lambda m: int(m.version),
            )
        )
        database = Database(Path(args.database), selected)
        return None, (database,)

    base_dir = base_dir_or_report(args)
    if base_dir is None:
        return None
    databases = resolve_databases(migrations)
    databases = _filtered(databases, subjects=args.subject, layers=args.layer)
    return base_dir, databases


def _heading(command: str, base_dir: Path | None) -> str:
    """The report's first line: the command, and the root it resolved against.

    ``--database`` mode has no base directory to name (see
    :func:`_resolve_databases`), and every line below already carries that one
    database's whole path, so the heading says only which command ran.
    """
    return command if base_dir is None else f"{command} · base-dir {base_dir}"


#: Width of the database-name column both reports start their lines with.
_LABEL_WIDTH = 28


def _label_column(label: str) -> str:
    """``label`` padded to :data:`_LABEL_WIDTH`, never flush against the next column.

    An explicit ``--database`` path is routinely longer than the column, and a
    label that fills it exactly would otherwise run straight into the version
    or the counts beside it.
    """
    return f"{label:<{_LABEL_WIDTH}}" if len(label) < _LABEL_WIDTH else f"{label} "


def _render_plan(base_dir: Path | None, plans: list[PlanResult]) -> str:
    lines = [_heading("plan", base_dir), ""]
    pending_total = 0
    out_of_order_total = 0
    for plan in plans:
        db_label = str(plan.database.relative_path)
        pending_total += len(plan.pending)
        out_of_order_total += plan.out_of_order_count
        if not plan.lines:
            lines.append(f"{db_label}  (no migrations)")
            continue
        for line in plan.lines:
            m = line.migration
            if line.applied:
                # The ledger stores the full UTC instant; a plan reads better
                # with the calendar date, which is the question an operator is
                # actually asking ("did this go out before or after Tuesday?").
                status = f"applied {(line.applied_at or '')[:10]}"
                indent = ""
            else:
                status = "out of order, pending" if line.out_of_order else "pending"
                indent = "     "
            lines.append(
                f"{_label_column(db_label)}{indent}{m.version} {m.name:<24} {status}"
            )
            db_label = ""  # only the first line of a database names it
    lines.append("")
    lines.append(
        f"{len(plans)} database(s) · {pending_total} pending · "
        f"{out_of_order_total} out of order"
    )
    return "\n".join(lines)


def _render_status(base_dir: Path | None, plans: list[PlanResult]) -> str:
    lines = [_heading("status", base_dir), ""]
    for plan in plans:
        applied = len(plan.lines) - len(plan.pending)
        label = str(plan.database.relative_path)
        lines.append(
            f"{_label_column(label)}{applied} applied · "
            f"{len(plan.pending)} pending · "
            f"{plan.out_of_order_count} out of order"
        )
    return "\n".join(lines)


def _migrate(args: argparse.Namespace) -> int:
    if args.to is not None and not args.to.isdigit():
        print(
            f"--to takes a migration version (digits, e.g. 0031), not {args.to!r}",
            file=sys.stderr,
        )
        return 1
    resolved = _resolve_databases(args)
    if resolved is None:
        return 1
    base_dir, databases = resolved
    # ``--database`` mode resolves no base directory: each database's own path
    # is already the whole path, so there is nothing to join it onto.
    root = Path() if base_dir is None else base_dir

    try:
        plans = [
            plan_database(db, root / db.relative_path, to=args.to) for db in databases
        ]
    except ChecksumMismatchError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if args.plan:
        print(_render_plan(base_dir, plans))
        return 0
    if args.status:
        print(_render_status(base_dir, plans))
        return 0

    failed = False
    for db in databases:
        try:
            apply_database(db, root / db.relative_path, to=args.to)
        except (ChecksumMismatchError, MigrationApplyError) as exc:
            # One database's refusal is reported and the rest still attempted:
            # each database's ledger is independent, so stopping the whole
            # command would leave healthy databases needlessly behind.
            print(str(exc), file=sys.stderr)
            failed = True
    return 1 if failed else 0


def register(sub) -> None:
    """Add ``migrations`` and ``migrate`` to the unified ``python -m cli`` CLI."""
    migrations = sub.add_parser(
        "migrations", help="author migrations from declared schema drift"
    )
    migrations_sub = migrations.add_subparsers(dest="migrations_command", required=True)
    make = migrations_sub.add_parser(
        "make", help="emit the next migration file for every drifted declared table"
    )
    make.add_argument("--feed", help="limit to one pipelines/<feed>'s declared TABLES")
    make.set_defaults(func=_make)

    migrate = sub.add_parser("migrate", help="apply (or preview) schema migrations")
    add_base_dir_args(migrate)
    mode = migrate.add_mutually_exclusive_group()
    mode.add_argument(
        "--plan", action="store_true", help="show what would apply; touch nothing"
    )
    mode.add_argument(
        "--status", action="store_true", help="summarise applied/pending per database"
    )
    migrate.add_argument(
        "--subject",
        action="append",
        default=[],
        help="narrow to one subject (repeatable)",
    )
    migrate.add_argument(
        "--layer", action="append", default=[], help="narrow to one layer (repeatable)"
    )
    migrate.add_argument(
        "--to", help="truncate to this version (inclusive); forward-only"
    )
    migrate.add_argument(
        "--database", help="an explicit database file, bypassing --env/--base-dir"
    )
    migrate.add_argument(
        "--scope",
        action="append",
        default=[],
        help="a scope label (e.g. layer/silver, _shared) to compose into "
        "--database (repeatable)",
    )
    migrate.set_defaults(func=_migrate)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m cli")
    register(parser.add_subparsers(dest="command", required=True))
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main())
