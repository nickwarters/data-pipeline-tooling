"""Back-compat shortcut for running a registered pipeline.

The full operator surface lives in :mod:`pipelines.cli`
(``run`` / ``status`` / ``runs`` / ``log``); this module is the historical
``run``-only entry point, kept working and delegating to the same shared logic:

    python -m pipelines.run cases ingest /tmp/demo
    python -m pipelines.run cases selection /tmp/demo --run-date 2026-05-29

Equivalent to ``python -m pipelines.cli run cases ingest /tmp/demo``. Run from the
repository root so the import-only ``framework`` package resolves.
"""

from __future__ import annotations

import argparse
import datetime as dt

from pipelines.cli import _date, _run


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m pipelines.run")
    parser.add_argument("case_type")
    parser.add_argument("pipeline")
    parser.add_argument("base_dir")
    parser.add_argument("--run-date", type=_date, default=dt.date.today())
    parser.add_argument(
        "--logical-run-id",
        help="re-drive this business run: a re-run with the same id replaces its rows",
    )
    parser.add_argument("--freshness-days", type=int, default=0)
    args = parser.parse_args(argv)
    return _run(args)


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main())
