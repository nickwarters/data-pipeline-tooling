"""``python -m cli schema diff`` -- report every feed's live-table drift.

Read-only: it only ever issues ``PRAGMA`` reads (via :mod:`tools.schema.live`),
never writes to a database or touches a pipeline. Collects every feed's
``TABLES`` (:func:`tools.schema.collect_declared_tables`), reads each declared
table's live shape under one environment's ``base_dir``, and prints the
column-level drift -- grouped by database, one line per disagreement -- so an
operator can see how far an environment has drifted from what the pipelines
declare before anything is wired to enforce it.
"""

from __future__ import annotations

import argparse

from cli.operator import add_base_dir_args, base_dir_or_report
from tools.schema import Table, collect_declared_tables, diff_tables, read_live_table
from tools.schema.declaration import resolved_namespace


def _declared_by_database() -> dict[str, list[Table]]:
    """Every declared ``Table``, grouped by the database it lands in.

    Grouped across *all* feeds, not per feed: two feeds can declare tables in
    one namespace (``pipelines/ingest`` and ``pipelines/selection`` both land in
    ``cases/gold``), and a database counts once in the summary however many
    feeds contribute tables to it.
    """
    by_db: dict[str, list[Table]] = {}
    for feed, tables in collect_declared_tables().items():
        for table in tables:
            by_db.setdefault(resolved_namespace(table, feed), []).append(table)
    return by_db


def _diff(args: argparse.Namespace) -> int:
    base_dir = base_dir_or_report(args)
    if base_dir is None:
        return 1

    clean = drifted = pending = 0
    blocks: list[str] = []
    for namespace, tables in sorted(_declared_by_database().items()):
        drift_lines: list[str] = []
        not_landed: list[str] = []
        for table in sorted(tables, key=lambda t: t.name):
            live = read_live_table(base_dir, namespace, table.name)
            diff = diff_tables(table, live)
            if not diff.landed:
                not_landed.append(table.name)
            elif diff.drifted:
                drift_lines.append(f"{namespace}.db  {table.name}")
                drift_lines.extend(diff.render())

        if drift_lines:
            drifted += 1
            blocks.append("\n".join(drift_lines))
        elif not_landed:
            pending += 1
        else:
            clean += 1
        if not_landed:
            # One line per database rather than a block per table: a fresh
            # environment has every table pending, and that is a footnote to
            # the drift report, not the report.
            blocks.append(f"{namespace}.db  not yet landed: {', '.join(not_landed)}")

    if blocks:
        print()
        print("\n\n".join(blocks))
        print()

    summary = f"{clean} database(s) clean, {drifted} drifted"
    if pending:
        summary += f", {pending} pending (not yet landed)"
    print(summary)
    return 1 if drifted else 0


def register(sub) -> None:
    """Add the ``schema`` command to the unified ``python -m cli`` CLI."""
    parser = sub.add_parser("schema", help="declared table-shape tools")
    schema_sub = parser.add_subparsers(dest="schema_command", required=True)

    diff = schema_sub.add_parser(
        "diff", help="diff every feed's declared TABLES against a live environment"
    )
    add_base_dir_args(diff)
    diff.set_defaults(func=_diff)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m cli")
    register(parser.add_subparsers(dest="command", required=True))
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main())
