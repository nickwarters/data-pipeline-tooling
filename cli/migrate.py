"""``python -m cli migrations make`` / ``migrate`` -- author, apply schema migrations.

``migrations make`` turns a declared table's drift (against what the
migrations tree itself already committed to, not any live environment) into
the next migration file, in the finest-grained scope
(``migrations/subject/<subject>/<layer>/``). The baseline it diffs against is
read by *applying* that scope's committed migrations to a throwaway in-memory
database -- see ``tools/schema/emit.py``.

``migrate`` applies (or, with ``--plan``/``--status``, previews) every pending
migration a topology profile resolves for a base directory. ``--env`` resolves
both the base directory and the profile from one place
(``tools.environments``); ``--database``/``--scope`` bypasses a profile
entirely for an ad hoc single database. ``--subject``/``--layer``/``--phase``
narrow which of the profile's databases are touched, by inspecting each
database's *composed* migrations for a matching scope; they intersect, and any
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
    PHASE_BY_LAYER,
    Database,
    compose_for_subject_layer,
    known_profiles,
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
    return (
        any(
            m.scope.kind == "subject_layer" and m.scope.subject == subject
            for m in database.migrations
        )
        or database.relative_path.parts[0] == subject
    )


def _matches_layer(database: Database, layer: str) -> bool:
    return (
        any(
            m.scope.layer == layer
            for m in database.migrations
            if m.scope.kind in ("layer", "subject_layer")
        )
        or database.relative_path.name == f"{layer}.db"
    )


def _matches_phase(database: Database, phase: str) -> bool:
    """Whether ``database`` holds anything belonging to ``phase``.

    Three ways it can: it composes a ``phase/<phase>`` migration; it *is* that
    phase's database (``by_phase``); or -- the case that matters under every
    other profile -- it holds a layer that maps to the phase. A subject's
    ``silver.db`` carries no ``phase`` scope of its own, but silver is an Ingest
    layer (``PHASE_BY_LAYER``), so ``--phase ingest`` must select it.
    """
    layers_in_phase = {
        layer for layer, mapped in PHASE_BY_LAYER.items() if mapped == phase
    }
    return (
        any(
            m.scope.phase == phase
            for m in database.migrations
            if m.scope.kind == "phase"
        )
        or database.relative_path.name == f"{phase}.db"
        or any(
            m.scope.layer in layers_in_phase
            for m in database.migrations
            if m.scope.kind in ("layer", "subject_layer")
        )
    )


def _filtered(
    databases: tuple[Database, ...],
    *,
    subjects: list[str],
    layers: list[str],
    phases: list[str],
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
    if phases:
        result = tuple(
            d for d in result if any(_matches_phase(d, phase) for phase in phases)
        )
    return result


def _resolve_databases(
    args: argparse.Namespace,
) -> tuple[Path, str, tuple[Database, ...]] | None:
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
        return Path("."), "custom", (database,)

    base_dir = base_dir_or_report(args)
    if base_dir is None:
        return None
    if args.profile is not None:
        profile = args.profile
    else:
        from tools.environments import resolve_topology

        profile = resolve_topology(getattr(args, "env", None))
    try:
        databases = resolve_databases(profile, migrations)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return None
    databases = _filtered(
        databases, subjects=args.subject, layers=args.layer, phases=args.phase
    )
    return base_dir, profile, databases


def _render_plan(base_dir: Path, profile: str, plans: list[PlanResult]) -> str:
    lines = [f"plan · base-dir {base_dir} · profile {profile}", ""]
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
            lines.append(f"{db_label:<28}{indent}{m.version} {m.name:<24} {status}")
            db_label = ""  # only the first line of a database names it
    lines.append("")
    lines.append(
        f"{len(plans)} database(s) · {pending_total} pending · "
        f"{out_of_order_total} out of order"
    )
    return "\n".join(lines)


def _render_status(base_dir: Path, profile: str, plans: list[PlanResult]) -> str:
    lines = [f"status · base-dir {base_dir} · profile {profile}", ""]
    for plan in plans:
        applied = len(plan.lines) - len(plan.pending)
        label = str(plan.database.relative_path)
        lines.append(
            f"{label:<28}{applied} applied · {len(plan.pending)} pending · "
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
    base_dir, profile, databases = resolved

    try:
        plans = [
            plan_database(db, base_dir / db.relative_path, to=args.to)
            for db in databases
        ]
    except ChecksumMismatchError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if args.plan:
        print(_render_plan(base_dir, profile, plans))
        return 0
    if args.status:
        print(_render_status(base_dir, profile, plans))
        return 0

    failed = False
    for db in databases:
        try:
            apply_database(db, base_dir / db.relative_path, to=args.to)
        except (ChecksumMismatchError, MigrationApplyError) as exc:
            # One database's refusal is reported and the rest still attempted:
            # each database's ledger is independent, so stopping the whole
            # command would leave healthy databases needlessly behind.
            print(f"{exc}\n(profile {profile})", file=sys.stderr)
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
    migrate.add_argument(
        "--profile",
        choices=known_profiles(),
        help="topology profile; defaults to the resolved --env's profile "
        "(or 'medallion' when only --base-dir is given)",
    )
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
        "--phase", action="append", default=[], help="narrow to one phase (repeatable)"
    )
    migrate.add_argument(
        "--to", help="truncate to this version (inclusive); forward-only"
    )
    migrate.add_argument(
        "--database", help="an explicit database file, bypassing --env/--profile"
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
