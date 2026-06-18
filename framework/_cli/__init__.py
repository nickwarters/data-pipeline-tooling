"""The framework's command-line entry point: ``python -m framework <command>``.

The framework is import-only (on ``sys.path``, never installed), but it can also
be *run* as a tool. ``python -m framework`` dispatches to the subcommands the
framework owns -- ``scaffold`` (generate a feed) and the operator commands
``run`` / ``orchestrate`` / ``runs`` / ``status`` / ``log``. This is an entry
point, not part of the importable public surface (the six facades); the modules
behind it live in this private ``framework._cli`` package.
"""

from __future__ import annotations

import argparse

from framework._cli import operator, scaffold


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m framework",
        description="Run the data pipeline framework as a tool.",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    scaffold.register(sub)
    operator.register(sub)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)
